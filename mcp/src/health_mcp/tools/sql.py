"""SQL read-only tools.

La sicurezza non si basa sul parsing della query (fragile), ma su:
- utente Postgres health_ro con solo SELECT (vedi scripts/grant_readonly.sql)
- statement_timeout sul ruolo
- LIMIT automatico se non presente
- rifiuto di query con piu' statement (split su `;` non-quoted)
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import asyncpg

from ..config import settings
from ..db import get_pool

# Match `;` non dentro string literals. Approssimazione semplice: dropping comments,
# poi check di `;` superstiti (escluso eventuale `;` finale).
_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_STRING_LITERAL = re.compile(r"'(?:''|[^'])*'", re.DOTALL)
_HAS_LIMIT = re.compile(r"\blimit\s+\d+\b", re.IGNORECASE)
_STARTS_WITH = re.compile(r"^\s*(with|select)\b", re.IGNORECASE)


class SqlError(Exception):
    pass


def _validate_sql(sql: str) -> str:
    """Restituisce la sql normalizzata o solleva SqlError."""
    if not sql or not sql.strip():
        raise SqlError("SQL vuota")

    # Rimuove commenti + string literals per il check semicolons.
    cleaned = _LINE_COMMENT.sub("", sql)
    cleaned = _BLOCK_COMMENT.sub("", cleaned)
    no_strings = _STRING_LITERAL.sub("''", cleaned)
    # Tollera al massimo un `;` finale.
    no_strings = no_strings.rstrip().rstrip(";")
    if ";" in no_strings:
        raise SqlError(
            "Multiple statements non ammesse. Una sola SELECT/WITH per query."
        )

    if not _STARTS_WITH.match(sql):
        raise SqlError("Solo SELECT/WITH ammesse.")

    # Auto-LIMIT se assente
    if not _HAS_LIMIT.search(sql):
        sql = f"{sql.rstrip().rstrip(';')} LIMIT {settings.sql_max_rows}"

    return sql


def _json_default(o: Any) -> Any:
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, Decimal):
        # Decimal -> float per JSON-friendly; lascia che il client decida la precisione.
        return float(o)
    if isinstance(o, (bytes, memoryview)):
        return bytes(o).hex()
    raise TypeError(f"non serializable: {type(o).__name__}")


def _row_to_dict(row: asyncpg.Record) -> dict[str, Any]:
    return {k: v for k, v in row.items()}


async def query_sql(sql: str) -> dict[str, Any]:
    """Esegue una SELECT/WITH read-only.

    Args:
        sql: la query. Una sola statement. Se manca LIMIT viene aggiunto.

    Returns:
        {"columns": [...], "rows": [{...}, ...], "row_count": N, "truncated": bool, "sql_executed": "..."}
    """
    try:
        normalized = _validate_sql(sql)
    except SqlError as e:
        return {"error": str(e), "rows": [], "row_count": 0}

    pool = await get_pool()
    async with pool.acquire() as con:
        try:
            records = await con.fetch(normalized)
        except asyncpg.PostgresError as e:
            return {
                "error": f"{type(e).__name__}: {e}",
                "sql_executed": normalized,
                "rows": [],
                "row_count": 0,
            }

    rows = [_row_to_dict(r) for r in records]
    columns = list(rows[0].keys()) if rows else []
    truncated = len(rows) >= settings.sql_max_rows

    # Round-trip via json.dumps con default custom per garantire serializzabilita'.
    serialized = json.loads(json.dumps(rows, default=_json_default))

    return {
        "columns": columns,
        "rows": serialized,
        "row_count": len(serialized),
        "truncated": truncated,
        "sql_executed": normalized,
    }


async def describe_schema() -> str:
    """Restituisce uno schema markdown delle tabelle del progetto.

    Una sezione per tabella con colonne + tipi + nullability + comment.
    """
    pool = await get_pool()
    async with pool.acquire() as con:
        tables = await con.fetch(
            """
            SELECT c.relname AS table_name,
                   obj_description(c.oid, 'pg_class') AS table_comment
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','m','v')
            ORDER BY c.relname
            """
        )
        cols = await con.fetch(
            """
            SELECT table_name, column_name, data_type, is_nullable,
                   col_description(format('public.%I', table_name)::regclass::oid,
                                   ordinal_position) AS column_comment,
                   ordinal_position
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
            """
        )

    by_table: dict[str, list[asyncpg.Record]] = {}
    for c in cols:
        by_table.setdefault(c["table_name"], []).append(c)

    lines: list[str] = ["# Schema Postgres (health_tracker)\n"]
    for t in tables:
        name = t["table_name"]
        if name not in by_table:
            continue
        lines.append(f"## `{name}`")
        if t["table_comment"]:
            lines.append(f"_{t['table_comment']}_\n")
        lines.append("| colonna | tipo | null | descrizione |")
        lines.append("|---|---|---|---|")
        for c in by_table[name]:
            null = "✓" if c["is_nullable"] == "YES" else ""
            comment = (c["column_comment"] or "").replace("\n", " ")
            lines.append(f"| `{c['column_name']}` | {c['data_type']} | {null} | {comment} |")
        lines.append("")

    return "\n".join(lines)


async def describe_table(name: str) -> dict[str, Any]:
    """Dettaglio singola tabella: colonne, indici, 3 row sample, valori distinti per colonne small-cardinality."""
    pool = await get_pool()
    async with pool.acquire() as con:
        # Colonne
        cols = await con.fetch(
            """
            SELECT column_name, data_type, is_nullable, column_default,
                   col_description(format('public.%I', table_name)::regclass::oid,
                                   ordinal_position) AS column_comment
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1
            ORDER BY ordinal_position
            """,
            name,
        )
        if not cols:
            return {"error": f"tabella '{name}' non esiste in schema public"}

        # Indici
        indexes = await con.fetch(
            """
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname='public' AND tablename=$1
            ORDER BY indexname
            """,
            name,
        )

        # 3 row sample (LIMIT esplicito, niente ORDER BY: vogliamo qualunque sample)
        try:
            sample = await con.fetch(f'SELECT * FROM "{name}" LIMIT 3')
        except asyncpg.PostgresError:
            sample = []

        # Per ogni colonna text/varchar con cardinalita' bassa, lista i valori distinti.
        # Limita il check a colonne potenzialmente "enum-like" per evitare full-scan su colonne grosse.
        distinct_values: dict[str, list[Any]] = {}
        for c in cols:
            if c["data_type"] not in ("text", "character varying", "varchar"):
                continue
            try:
                vals = await con.fetch(
                    f'SELECT DISTINCT "{c["column_name"]}" AS v '
                    f'FROM "{name}" '
                    f'WHERE "{c["column_name"]}" IS NOT NULL '
                    f'LIMIT 20'
                )
                if 0 < len(vals) < 20:
                    distinct_values[c["column_name"]] = [v["v"] for v in vals]
            except asyncpg.PostgresError:
                continue

    return {
        "table": name,
        "columns": [
            {
                "name": c["column_name"],
                "type": c["data_type"],
                "nullable": c["is_nullable"] == "YES",
                "default": c["column_default"],
                "comment": c["column_comment"],
            }
            for c in cols
        ],
        "indexes": [{"name": i["indexname"], "def": i["indexdef"]} for i in indexes],
        "sample_rows": json.loads(
            json.dumps([dict(r) for r in sample], default=_json_default)
        ),
        "distinct_values_by_column": distinct_values,
    }
