"""Configurazione IA effettiva (modello + API key Anthropic).

Due livelli, il primo che c'e' vince:
1. override salvato dalla dashboard in `app_settings` chiave `ai_config`
   = `{"model": str|null, "api_key": str|null}`
2. variabili d'ambiente del container (`ANTHROPIC_MODEL`, `ANTHROPIC_API_KEY`)

Le `call_llm()` dei servizi sono sincrone e girano in thread (`anyio.to_thread`),
quindi non possono leggere il DB: leggono `current()`, una cache a livello di
modulo. I chiamanti async fanno `await refresh()` prima di lanciare l'IA, cosi'
la cache e' sempre allineata al DB anche con piu' worker uvicorn (ogni worker
ha la sua cache, la rilettura e' una lookup per PK, costo trascurabile).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

logger = logging.getLogger(__name__)

AI_CONFIG_KEY = "ai_config"
PROVIDER = "anthropic"


@dataclass(frozen=True)
class AIConfig:
    model: str
    api_key: str | None
    model_source: str  # "db" | "env"
    key_source: str  # "db" | "env" | "none"


def _merge(override: dict[str, Any] | None) -> AIConfig:
    override = override if isinstance(override, dict) else {}
    db_model = (override.get("model") or "").strip() or None
    db_key = (override.get("api_key") or "").strip() or None
    env_key = (settings.anthropic_api_key or "").strip() or None
    return AIConfig(
        model=db_model or settings.anthropic_model,
        api_key=db_key or env_key,
        model_source="db" if db_model else "env",
        key_source="db" if db_key else ("env" if env_key else "none"),
    )


_current: AIConfig = _merge(None)


def current() -> AIConfig:
    """Configurazione in cache (sincrona, sicura da chiamare dai thread)."""
    return _current


async def load_override(db: AsyncSession) -> dict[str, Any]:
    from app.models import AppSetting

    row = await db.get(AppSetting, AI_CONFIG_KEY)
    return dict(row.value) if row and isinstance(row.value, dict) else {}


async def refresh(db: AsyncSession | None = None) -> AIConfig:
    """Rilegge l'override dal DB e aggiorna la cache. Non solleva mai: in caso
    di errore DB tiene l'ultima configurazione nota."""
    global _current
    try:
        if db is None:
            from app.database import async_session

            async with async_session() as s:
                override = await load_override(s)
        else:
            override = await load_override(db)
        _current = _merge(override)
    except Exception:
        logger.exception("ai_config: refresh dal DB fallito, uso la cache")
    return _current


def key_hint(key: str | None) -> str | None:
    """Versione mascherata della chiave da mostrare in UI (mai la chiave intera)."""
    if not key:
        return None
    if len(key) <= 12:
        return "…" + key[-2:]
    return f"{key[:7]}…{key[-4:]}"


def make_client(api_key: str | None = None):
    """Client Anthropic con la chiave effettiva. Solleva RuntimeError se manca."""
    key = api_key or _current.api_key
    if not key:
        raise RuntimeError(
            "API key Anthropic non configurata (Impostazioni → Intelligenza artificiale)"
        )
    from anthropic import Anthropic

    return Anthropic(api_key=key)
