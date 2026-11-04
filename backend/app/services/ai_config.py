"""Configurazione IA effettiva (modello + API key Anthropic).

Unica fonte: `app_settings` chiave `ai_config` = `{"model": str|null,
"api_key": str|null}`, scritta dalla dashboard (Impostazioni → Intelligenza
artificiale). Nessun fallback a variabili d'ambiente: se manca il modello o la
chiave, le chiamate IA falliscono con un messaggio esplicito.

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

logger = logging.getLogger(__name__)

AI_CONFIG_KEY = "ai_config"
PROVIDER = "anthropic"


@dataclass(frozen=True)
class AIConfig:
    model: str | None
    api_key: str | None


def _merge(override: dict[str, Any] | None) -> AIConfig:
    override = override if isinstance(override, dict) else {}
    return AIConfig(
        model=(override.get("model") or "").strip() or None,
        api_key=(override.get("api_key") or "").strip() or None,
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


def require_model() -> str:
    """Modello configurato. Solleva RuntimeError se manca."""
    if not _current.model:
        raise RuntimeError(
            "Modello IA non configurato (Impostazioni → Intelligenza artificiale)"
        )
    return _current.model


def make_client(api_key: str | None = None):
    """Client Anthropic con la chiave configurata. Solleva RuntimeError se manca."""
    key = api_key or _current.api_key
    if not key:
        raise RuntimeError(
            "API key Anthropic non configurata (Impostazioni → Intelligenza artificiale)"
        )
    from anthropic import Anthropic

    return Anthropic(api_key=key)
