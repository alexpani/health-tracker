"""Pool asyncpg per l'utente health_ro. Connessione lazy."""
from __future__ import annotations

import asyncpg

from .config import settings

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.pg_dsn,
            min_size=1,
            max_size=4,
            command_timeout=settings.sql_statement_timeout_ms / 1000.0,
            # Statement timeout e' gia' settato lato ruolo via ALTER ROLE,
            # ma ribadiamo a livello connessione come belt-and-braces.
            server_settings={
                "statement_timeout": str(settings.sql_statement_timeout_ms),
                "application_name": "health-mcp",
            },
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
