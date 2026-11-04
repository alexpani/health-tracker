"""Impostazioni IA (provider Anthropic): modello + API key.

La configurazione vive solo in `app_settings` chiave `ai_config` (nessun
fallback a env) — vedi `services/ai_config.py`. La chiave API
e' **write-only**: nessun endpoint la restituisce in chiaro (solo un hint
mascherato), e la chiave `ai_config` e' nascosta dal router generico
`/api/v1/settings`.

- `GET  /api/v1/ai/config`  → modello + hint mascherato della chiave
- `PUT  /api/v1/ai/config`  → body `{model?, api_key?}`; campo assente = invariato,
                              `null`/"" = cancella il valore
- `GET  /api/v1/ai/models`  → modelli disponibili per la chiave corrente
- `POST /api/v1/ai/test`    → chiamata minima di prova; body `{model?, api_key?}`
                              opzionale per provare valori non ancora salvati
"""
from __future__ import annotations

import time
from typing import Any

import anyio
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AppSetting
from app.services import ai_config

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])


class AIConfigOut(BaseModel):
    provider: str
    model: str | None
    has_key: bool
    key_hint: str | None


class AIConfigIn(BaseModel):
    model: str | None = None
    api_key: str | None = None


class AITestIn(BaseModel):
    model: str | None = None
    api_key: str | None = None


def _out(cfg: ai_config.AIConfig) -> AIConfigOut:
    return AIConfigOut(
        provider=ai_config.PROVIDER,
        model=cfg.model,
        has_key=bool(cfg.api_key),
        key_hint=ai_config.key_hint(cfg.api_key),
    )


@router.get("/config", response_model=AIConfigOut)
async def get_config(db: AsyncSession = Depends(get_db)) -> AIConfigOut:
    return _out(await ai_config.refresh(db))


@router.put("/config", response_model=AIConfigOut)
async def put_config(payload: AIConfigIn, db: AsyncSession = Depends(get_db)) -> AIConfigOut:
    override = await ai_config.load_override(db)
    for field in payload.model_fields_set:
        val = getattr(payload, field)
        val = (val or "").strip() or None
        if val is None:
            override.pop(field, None)
        else:
            override[field] = val
    stmt = (
        pg_insert(AppSetting)
        .values(key=ai_config.AI_CONFIG_KEY, value=override)
        .on_conflict_do_update(index_elements=["key"], set_={"value": override})
    )
    await db.execute(stmt)
    await db.commit()
    return _out(await ai_config.refresh(db))


def _list_models(api_key: str | None) -> list[dict[str, Any]]:
    client = ai_config.make_client(api_key)
    out = []
    for m in client.models.list(limit=100):
        created = getattr(m, "created_at", None)
        out.append({
            "id": m.id,
            "display_name": getattr(m, "display_name", None) or m.id,
            "created_at": created.isoformat() if created else None,
        })
    return out


@router.get("/models")
async def list_models(db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    cfg = await ai_config.refresh(db)
    if not cfg.api_key:
        raise HTTPException(400, "API key non configurata")
    try:
        return await anyio.to_thread.run_sync(_list_models, None)
    except Exception as exc:  # errori di rete / chiave non valida
        raise HTTPException(502, f"Impossibile leggere i modelli: {exc}") from exc


def _test_call(api_key: str | None, model: str) -> str:
    client = ai_config.make_client(api_key)
    resp = client.messages.create(
        model=model,
        max_tokens=16,
        messages=[{"role": "user", "content": "Rispondi solo con: ok"}],
    )
    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()


@router.post("/test")
async def test_config(payload: AITestIn | None = None, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    cfg = await ai_config.refresh(db)
    api_key = ((payload.api_key if payload else None) or "").strip() or None
    model = ((payload.model if payload else None) or "").strip() or cfg.model
    if not model:
        return {"ok": False, "model": None, "error": "Modello non configurato"}
    if not (api_key or cfg.api_key):
        return {"ok": False, "model": model, "error": "API key non configurata"}
    t0 = time.monotonic()
    try:
        reply = await anyio.to_thread.run_sync(_test_call, api_key, model)
    except Exception as exc:
        return {"ok": False, "model": model, "error": str(exc)}
    return {
        "ok": True,
        "model": model,
        "reply": reply[:100],
        "latency_ms": int((time.monotonic() - t0) * 1000),
    }
