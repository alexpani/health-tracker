"""Tool analitici — primitive componibili per qualunque domanda di correlazione.

Le metriche sono identificate da slug (vedi mcp/metrics.yaml). I parametri utente
sono validati prima di entrare nell'SQL — niente injection possibile perche'
non concateniamo MAI stringhe utente nel SQL, solo identifier whitelisted.

Tutto gira sull'utente Postgres `health_ro` con statement_timeout 10s.
"""
from __future__ import annotations

import json
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

import asyncpg

from ..db import get_pool
from ..metrics import get as get_metric
from ..metrics import load_catalog


# ─── Whitelist parametri ──────────────────────────────────────────────────────

_BUCKETS = {
    "day": "day",
    "week": "week",
    "month": "month",
    "quarter": "quarter",
    "year": "year",
}

# Aggregazioni: name -> SQL expression che opera su `v` della CTE bucketed.
_AGGS_BASE = {
    "avg": "AVG(v)::float",
    "sum": "SUM(v)::float",
    "min": "MIN(v)::float",
    "max": "MAX(v)::float",
    "median": "percentile_cont(0.5) WITHIN GROUP (ORDER BY v)::float",
    "count": "COUNT(*)::float",
    "stddev": "STDDEV_SAMP(v)::float",
    # slope: pendenza regressione lineare di v vs epoch secondi, in unita'/giorno
    "slope_per_day": "(regr_slope(v, EXTRACT(EPOCH FROM t)) * 86400.0)::float",
}


def _check_bucket(bucket: str) -> str:
    if bucket not in _BUCKETS:
        raise ValueError(f"bucket invalido: {bucket!r}. Valori: {sorted(_BUCKETS)}")
    return _BUCKETS[bucket]


def _check_agg(agg: str) -> str:
    if agg not in _AGGS_BASE:
        raise ValueError(f"agg invalida: {agg!r}. Valori: {sorted(_AGGS_BASE)}")
    return _AGGS_BASE[agg]


def _to_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        # Accetta YYYY-MM-DD o full ISO
        if len(s) == 10:
            return datetime.fromisoformat(s + "T00:00:00+00:00")
        return datetime.fromisoformat(s)
    except ValueError:
        raise ValueError(f"Data ISO invalida: {s!r}")


def _serialize(rows: list[asyncpg.Record]) -> list[dict[str, Any]]:
    def _default(o: Any) -> Any:
        if isinstance(o, (datetime, date_type)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return float(o)
        raise TypeError(f"non serializable: {type(o).__name__}")

    return json.loads(json.dumps([dict(r) for r in rows], default=_default))


# ─── aggregate ────────────────────────────────────────────────────────────────

async def aggregate(
    metric: str,
    bucket: str = "month",
    agg: str = "avg",
    start: str | None = None,
    end: str | None = None,
) -> dict[str, Any]:
    """Aggrega una metrica su bucket temporali.

    Args:
        metric: slug del catalogo (es. 'body.weight', 'workout.running.km').
        bucket: day/week/month/quarter/year.
        agg: avg/sum/min/max/median/count/stddev/slope_per_day.
        start, end: ISO date (YYYY-MM-DD) opzionali per filtrare il range.
    """
    try:
        m = get_metric(metric)
    except KeyError as e:
        return {"error": str(e)}

    try:
        b = _check_bucket(bucket)
        a = _check_agg(agg)
        start_dt = _to_dt(start)
        end_dt = _to_dt(end)
    except ValueError as e:
        return {"error": str(e)}

    where = []
    params: list[Any] = []
    if start_dt:
        params.append(start_dt)
        where.append(f"t >= ${len(params)}")
    if end_dt:
        params.append(end_dt)
        where.append(f"t <= ${len(params)}")
    where_clause = f"WHERE {' AND '.join(where)}" if where else ""

    sql = f"""
WITH base AS ({m.query})
SELECT
  date_trunc('{b}', t)::date AS bucket,
  {a} AS value,
  COUNT(*)::int AS n
FROM base
{where_clause}
GROUP BY 1
ORDER BY 1
"""

    pool = await get_pool()
    async with pool.acquire() as con:
        try:
            rows = await con.fetch(sql, *params)
        except asyncpg.PostgresError as e:
            return {"error": f"{type(e).__name__}: {e}", "sql": sql}

    return {
        "metric": metric,
        "unit": m.unit,
        "bucket": bucket,
        "agg": agg,
        "n_buckets": len(rows),
        "rows": _serialize(rows),
    }


# ─── compare_periods ──────────────────────────────────────────────────────────

async def compare_periods(
    periods: list[dict[str, Any]],
    metrics: list[str],
    aggs: list[str] | None = None,
) -> dict[str, Any]:
    """Confronta aggregati di N metriche su M periodi.

    Args:
        periods: lista di {label, ranges:[[start_iso, end_iso], ...]}.
                 Le ranges si uniscono (OR) per il singolo periodo.
        metrics: lista di slug.
        aggs: lista di funzioni di aggregazione (default ['avg','median','stddev','count','slope_per_day']).

    Returns: {results: [{period, metric, n, mean, median, stddev, min, max, slope_per_day, unit}]}
    """
    if not periods or not metrics:
        return {"error": "periods e metrics non possono essere vuoti"}

    agg_list = aggs or ["avg", "median", "stddev", "min", "max", "count", "slope_per_day"]
    for a in agg_list:
        if a not in _AGGS_BASE:
            return {"error": f"agg invalida: {a!r}. Valori: {sorted(_AGGS_BASE)}"}

    # Valida tutte le metriche prima
    try:
        ms = [(slug, get_metric(slug)) for slug in metrics]
    except KeyError as e:
        return {"error": str(e)}

    # Valida tutti i periodi
    parsed_periods = []
    for p in periods:
        label = p.get("label") or f"period_{len(parsed_periods)}"
        ranges = p.get("ranges") or []
        if not ranges:
            return {"error": f"period {label!r}: campo ranges mancante o vuoto"}
        parsed_ranges = []
        for r in ranges:
            if not isinstance(r, (list, tuple)) or len(r) != 2:
                return {"error": f"range malformato in {label!r}: {r!r}, atteso [start, end]"}
            try:
                a_dt = _to_dt(r[0])
                b_dt = _to_dt(r[1])
            except ValueError as e:
                return {"error": str(e)}
            if a_dt is None or b_dt is None:
                return {"error": f"range con None in {label!r}"}
            parsed_ranges.append((a_dt, b_dt))
        parsed_periods.append({"label": label, "ranges": parsed_ranges})

    agg_select = ", ".join(f"{_AGGS_BASE[a]} AS {a}" for a in agg_list)

    results: list[dict[str, Any]] = []
    pool = await get_pool()
    async with pool.acquire() as con:
        for period in parsed_periods:
            # Costruisco un OR di range con parametri positional
            params: list[Any] = []
            range_clauses = []
            for a_dt, b_dt in period["ranges"]:
                params.append(a_dt)
                p1 = len(params)
                params.append(b_dt)
                p2 = len(params)
                range_clauses.append(f"(t >= ${p1} AND t <= ${p2})")
            range_or = " OR ".join(range_clauses)

            for slug, m in ms:
                sql = f"""
WITH base AS ({m.query})
SELECT
  COUNT(*)::int AS n,
  {agg_select}
FROM base
WHERE {range_or}
"""
                try:
                    row = await con.fetchrow(sql, *params)
                except asyncpg.PostgresError as e:
                    results.append({
                        "period": period["label"],
                        "metric": slug,
                        "error": f"{type(e).__name__}: {e}",
                    })
                    continue
                results.append({
                    "period": period["label"],
                    "metric": slug,
                    "unit": m.unit,
                    **dict(row),
                })

    return {"results": results}


# ─── correlate ────────────────────────────────────────────────────────────────

async def correlate(
    metrics: list[str],
    bucket: str = "month",
    method: Literal["pearson", "spearman"] = "pearson",
    agg: str = "avg",
    start: str | None = None,
    end: str | None = None,
) -> dict[str, Any]:
    """Matrice di correlazione fra N metriche su bucket comuni.

    Bucketizza ogni metrica con `agg`, fa INNER JOIN sui bucket comuni
    (= settimane/mesi con almeno un sample di entrambe le metriche), poi
    calcola Pearson o Spearman.

    Args:
        metrics: 2+ slug del catalogo.
        bucket: granularita' temporale per allineare i bucket.
        method: 'pearson' (lineare) o 'spearman' (monotonica, sui rank).
        agg: come bucketizzare i valori prima della correlazione (default avg).
        start, end: filtra il range temporale.

    Returns: {pairs: [{a, b, n, corr}], buckets_used: int}
    """
    if len(metrics) < 2:
        return {"error": "servono almeno 2 metriche"}

    try:
        ms = [(slug, get_metric(slug)) for slug in metrics]
        b = _check_bucket(bucket)
        a = _check_agg(agg)
        start_dt = _to_dt(start)
        end_dt = _to_dt(end)
    except (KeyError, ValueError) as e:
        return {"error": str(e)}

    if method not in ("pearson", "spearman"):
        return {"error": f"method invalido: {method!r}"}

    # CTE per ogni metrica: bucket -> agg(v)
    range_clauses = []
    params: list[Any] = []
    if start_dt:
        params.append(start_dt)
        range_clauses.append(f"t >= ${len(params)}")
    if end_dt:
        params.append(end_dt)
        range_clauses.append(f"t <= ${len(params)}")
    range_filter = f"WHERE {' AND '.join(range_clauses)}" if range_clauses else ""

    ctes = []
    for i, (slug, m) in enumerate(ms):
        ctes.append(
            f"""m{i} AS (
  SELECT date_trunc('{b}', t)::date AS bucket, {a} AS v
  FROM ({m.query}) src
  {range_filter}
  GROUP BY 1
)"""
        )

    # JOIN tutte le ms su bucket comune
    base_join = "FROM m0\n"
    for i in range(1, len(ms)):
        base_join += f"JOIN m{i} USING (bucket)\n"

    # Calcola corr per ogni coppia
    pairs_sql_parts = []
    pair_meta = []
    for i in range(len(ms)):
        for j in range(i + 1, len(ms)):
            slug_a = ms[i][0]
            slug_b = ms[j][0]
            if method == "pearson":
                expr = f"corr(m{i}.v, m{j}.v)::float"
            else:
                # Spearman: corr su rank dei valori sui bucket comuni
                expr = (
                    f"corr(rank() OVER (ORDER BY m{i}.v), "
                    f"rank() OVER (ORDER BY m{j}.v))::float"
                )
            pairs_sql_parts.append(
                f"  '{slug_a}' AS a_{i}_{j}, '{slug_b}' AS b_{i}_{j}, "
                f"{expr} AS corr_{i}_{j}"
            )
            pair_meta.append((slug_a, slug_b, i, j))

    # Conta i bucket comuni (n)
    n_expr = "COUNT(*)::int AS n_total"

    if method == "pearson":
        # Una sola SELECT con tutte le corr
        sql = (
            "WITH " + ",\n".join(ctes) + "\n"
            + f"SELECT {n_expr}, "
            + ", ".join(
                f"corr(m{i}.v, m{j}.v)::float AS corr_{i}_{j}"
                for _, _, i, j in pair_meta
            )
            + f"\n{base_join}"
        )
        pool = await get_pool()
        async with pool.acquire() as con:
            try:
                row = await con.fetchrow(sql, *params)
            except asyncpg.PostgresError as e:
                return {"error": f"{type(e).__name__}: {e}", "sql": sql}
        if row is None:
            return {"pairs": [], "buckets_used": 0}
        n_total = row["n_total"]
        pairs = []
        for slug_a, slug_b, i, j in pair_meta:
            val = row[f"corr_{i}_{j}"]
            pairs.append({
                "a": slug_a,
                "b": slug_b,
                "n": n_total,
                "corr": val,
            })
    else:
        # Spearman: calcoliamo manualmente con rank() su CTE finale
        sql = (
            "WITH " + ",\n".join(ctes) + ",\n"
            + "joined AS (\n  SELECT "
            + ", ".join(f"m{i}.v AS v{i}" for i in range(len(ms)))
            + f"\n  {base_join}"
            + "),\n"
            + "ranked AS (\n  SELECT "
            + ", ".join(f"rank() OVER (ORDER BY v{i}) AS r{i}" for i in range(len(ms)))
            + "\n  FROM joined\n)\n"
            + "SELECT (SELECT COUNT(*) FROM joined)::int AS n_total, "
            + ", ".join(
                f"corr(r{i}, r{j})::float AS corr_{i}_{j}"
                for _, _, i, j in pair_meta
            )
            + "\nFROM ranked"
        )
        pool = await get_pool()
        async with pool.acquire() as con:
            try:
                row = await con.fetchrow(sql, *params)
            except asyncpg.PostgresError as e:
                return {"error": f"{type(e).__name__}: {e}", "sql": sql}
        if row is None:
            return {"pairs": [], "buckets_used": 0}
        n_total = row["n_total"]
        pairs = []
        for slug_a, slug_b, i, j in pair_meta:
            val = row[f"corr_{i}_{j}"]
            pairs.append({
                "a": slug_a,
                "b": slug_b,
                "n": n_total,
                "corr": val,
            })

    return {
        "method": method,
        "bucket": bucket,
        "agg": agg,
        "buckets_used": n_total,
        "pairs": pairs,
    }


# ─── find_periods ─────────────────────────────────────────────────────────────

async def find_periods(
    metric: str,
    condition: str,
    bucket: str = "week",
    agg: str = "avg",
    max_gap_buckets: int = 0,
    start: str | None = None,
    end: str | None = None,
) -> dict[str, Any]:
    """Trova periodi temporali in cui una metrica soddisfa una condizione.

    Args:
        metric: slug.
        condition: espressione SQL su `v` (aggregato del bucket). Es: '> 50', '< 1800',
                   'BETWEEN 60 AND 90', 'IS NULL'. Solo operatori safe whitelisted.
        bucket: granularita' (day/week/month/...).
        agg: come aggregare i valori dentro il bucket prima del confronto.
        max_gap_buckets: se >0, unisce range adiacenti separati da fino a N bucket
                         che non matchano (utile per "streak con qualche miss").
        start, end: filtra range globale.

    Returns: {periods: [{start, end, n_buckets}]}
    """
    try:
        m = get_metric(metric)
        b = _check_bucket(bucket)
        a = _check_agg(agg)
        start_dt = _to_dt(start)
        end_dt = _to_dt(end)
    except (KeyError, ValueError) as e:
        return {"error": str(e)}

    # Valido la condition: solo operatori e numeri/keyword safe.
    # Pattern accettati: confronti binari, BETWEEN, IS NULL/NOT NULL.
    import re
    cond_clean = condition.strip()
    safe = re.fullmatch(
        r"\s*(IS\s+(NOT\s+)?NULL|"
        r"(<|<=|>|>=|=|<>|!=)\s*-?\d+(\.\d+)?|"
        r"BETWEEN\s+-?\d+(\.\d+)?\s+AND\s+-?\d+(\.\d+)?)\s*",
        cond_clean,
        flags=re.IGNORECASE,
    )
    if not safe:
        return {
            "error": f"condition non valida: {cond_clean!r}. "
            "Accettati: '> N', '< N', '>= N', '<= N', '= N', '!= N', "
            "'BETWEEN A AND B', 'IS NULL', 'IS NOT NULL'."
        }

    range_clauses = []
    params: list[Any] = []
    if start_dt:
        params.append(start_dt)
        range_clauses.append(f"t >= ${len(params)}")
    if end_dt:
        params.append(end_dt)
        range_clauses.append(f"t <= ${len(params)}")
    range_filter = f"WHERE {' AND '.join(range_clauses)}" if range_clauses else ""

    # buckets di base
    sql = f"""
WITH bucketed AS (
  SELECT date_trunc('{b}', t)::date AS bucket, {a} AS v
  FROM ({m.query}) src
  {range_filter}
  GROUP BY 1
),
matched AS (
  SELECT bucket FROM bucketed WHERE v {cond_clean}
),
ordered AS (
  SELECT bucket,
         LAG(bucket) OVER (ORDER BY bucket) AS prev_bucket
  FROM matched
),
grouped AS (
  SELECT bucket,
         SUM(CASE
           WHEN prev_bucket IS NULL THEN 1
           WHEN bucket - prev_bucket > (INTERVAL '1 {b}') * ({max_gap_buckets} + 1) THEN 1
           ELSE 0
         END) OVER (ORDER BY bucket) AS grp
  FROM ordered
)
SELECT MIN(bucket) AS start, MAX(bucket) AS end, COUNT(*)::int AS n_buckets
FROM grouped
GROUP BY grp
ORDER BY start
"""

    pool = await get_pool()
    async with pool.acquire() as con:
        try:
            rows = await con.fetch(sql, *params)
        except asyncpg.PostgresError as e:
            return {"error": f"{type(e).__name__}: {e}", "sql": sql}

    return {
        "metric": metric,
        "bucket": bucket,
        "agg": agg,
        "condition": cond_clean,
        "periods": _serialize(rows),
    }


# ─── life_timeline ────────────────────────────────────────────────────────────

async def life_timeline(
    bucket: str = "month",
    start: str | None = None,
    end: str | None = None,
) -> dict[str, Any]:
    """Una riga per bucket con tutti i dati salienti.

    Riassunto compatto della "vita" su 10+ anni in poche righe (es. ~120 righe per
    10 anni di bucket=month). Include: regimi attivi, peso medio, RHR media, HRV
    media, sonno medio, km corsa, kcal medie, conteggio panel lab, conteggio
    out-of-range.

    Args:
        bucket: week / month / quarter / year. Default month.
        start, end: ISO date opzionali (default: dall'inizio dei dati a oggi).
    """
    try:
        b = _check_bucket(bucket)
        start_dt = _to_dt(start)
        end_dt = _to_dt(end)
    except ValueError as e:
        return {"error": str(e)}

    # Per i regimi: cerca i nomi attivi nel bucket (cross con start/end_date dei regimens)
    sql = f"""
WITH bounds AS (
  SELECT
    COALESCE($1::timestamptz, (SELECT MIN(start_date) FROM health_samples)) AS lo,
    COALESCE($2::timestamptz, NOW()) AS hi
),
series AS (
  SELECT generate_series(
    date_trunc('{b}', (SELECT lo FROM bounds)),
    date_trunc('{b}', (SELECT hi FROM bounds)),
    INTERVAL '1 {b}'
  )::date AS bucket
)
SELECT
  s.bucket,
  (s.bucket + INTERVAL '1 {b}' - INTERVAL '1 day')::date AS bucket_end,

  -- Regimi attivi nel bucket (uno per kind, array di nomi)
  (SELECT jsonb_object_agg(kind, names) FROM (
     SELECT r.kind, jsonb_agg(DISTINCT r.name ORDER BY r.name) AS names
     FROM regimens r
     WHERE (r.start_date IS NULL OR r.start_date <= (s.bucket + INTERVAL '1 {b}' - INTERVAL '1 day')::date)
       AND (r.end_date IS NULL OR r.end_date >= s.bucket)
     GROUP BY r.kind
   ) t) AS active_regimens,

  -- Body
  (SELECT AVG(value)::numeric(6,2) FROM health_samples
   WHERE type='HKQuantityTypeIdentifierBodyMass'
     AND start_date >= s.bucket
     AND start_date < (s.bucket + INTERVAL '1 {b}')) AS weight_avg_kg,

  -- RHR
  (SELECT AVG(value)::numeric(5,1) FROM health_samples
   WHERE type='HKQuantityTypeIdentifierRestingHeartRate'
     AND start_date >= s.bucket
     AND start_date < (s.bucket + INTERVAL '1 {b}')) AS rhr_avg,

  -- HRV
  (SELECT AVG(value)::numeric(6,1) FROM health_samples
   WHERE type='HKQuantityTypeIdentifierHeartRateVariabilitySDNN'
     AND start_date >= s.bucket
     AND start_date < (s.bucket + INTERVAL '1 {b}')) AS hrv_avg_ms,

  -- Sonno medio per notte (ore)
  (SELECT AVG(dur_h)::numeric(4,2) FROM (
     SELECT end_date::date AS d, SUM(EXTRACT(EPOCH FROM end_date - start_date) / 3600.0) AS dur_h
     FROM category_samples
     WHERE type='HKCategoryTypeIdentifierSleepAnalysis'
       AND value IN (3, 4, 5)
       AND end_date >= s.bucket
       AND end_date < (s.bucket + INTERVAL '1 {b}')
     GROUP BY end_date::date
   ) sl) AS sleep_avg_h_per_night,

  -- Corsa: km totali + count + ritmo medio (s/km)
  (SELECT SUM(total_distance/1000.0)::numeric(8,2) FROM workouts
   WHERE activity_type=37
     AND start_date >= s.bucket
     AND start_date < (s.bucket + INTERVAL '1 {b}')) AS running_km_total,

  (SELECT COUNT(*)::int FROM workouts
   WHERE activity_type=37
     AND start_date >= s.bucket
     AND start_date < (s.bucket + INTERVAL '1 {b}')) AS running_count,

  (SELECT (AVG(duration::float / NULLIF(total_distance::float/1000.0, 0)))::numeric(6,1) FROM workouts
   WHERE activity_type=37
     AND total_distance > 100
     AND start_date >= s.bucket
     AND start_date < (s.bucket + INTERVAL '1 {b}')) AS running_pace_avg_s_km,

  -- Calorie attive medie giornaliere
  (SELECT AVG(value)::numeric(6,1) FROM daily_stats
   WHERE type='HKQuantityTypeIdentifierActiveEnergyBurned' AND source IS NULL
     AND date >= s.bucket
     AND date < (s.bucket + INTERVAL '1 {b}')) AS active_kcal_avg,

  -- Passi medi giornalieri
  (SELECT AVG(value)::int FROM daily_stats
   WHERE type='HKQuantityTypeIdentifierStepCount' AND source IS NULL
     AND date >= s.bucket
     AND date < (s.bucket + INTERVAL '1 {b}')) AS steps_avg,

  -- Lab panels nel bucket
  (SELECT jsonb_agg(test_date ORDER BY test_date) FROM lab_panels
   WHERE status='confirmed'
     AND test_date >= s.bucket
     AND test_date < (s.bucket + INTERVAL '1 {b}')) AS lab_panel_dates,

  (SELECT COUNT(*)::int FROM lab_results r
   JOIN lab_panels p ON r.panel_id = p.id
   WHERE p.status='confirmed' AND r.out_of_range = true
     AND p.test_date >= s.bucket
     AND p.test_date < (s.bucket + INTERVAL '1 {b}')) AS lab_oor_count,

  -- Nutrizione: kcal medie giornaliere (somma per giorno → media)
  (SELECT AVG(kcal)::numeric(6,1) FROM (
     SELECT start_date::date AS d, SUM(value) AS kcal
     FROM health_samples
     WHERE type='HKQuantityTypeIdentifierDietaryEnergyConsumed'
       AND start_date >= s.bucket
       AND start_date < (s.bucket + INTERVAL '1 {b}')
     GROUP BY start_date::date
   ) n) AS nutrition_kcal_avg

FROM series s
ORDER BY s.bucket
"""

    pool = await get_pool()
    async with pool.acquire() as con:
        try:
            rows = await con.fetch(sql, start_dt, end_dt)
        except asyncpg.PostgresError as e:
            return {"error": f"{type(e).__name__}: {e}"}

    return {
        "bucket": bucket,
        "n_buckets": len(rows),
        "rows": _serialize(rows),
    }


# ─── reload metrics ───────────────────────────────────────────────────────────

async def reload_metrics_catalog() -> dict[str, Any]:
    """Ricarica metrics.yaml senza riavviare il servizio."""
    catalog = load_catalog(force=True)
    return {
        "reloaded": True,
        "n_metrics": len(catalog),
        "slugs": sorted(catalog.keys()),
    }
