"""App settings router.

Key-value store per le preferenze condivise tra dispositivi (vedi
`models/app_settings.py`). App single-user: nessuno scoping per utente.

- `GET  /api/v1/settings`        → tutte le impostazioni come dict {key: value}
- `GET  /api/v1/settings/{key}`  → {key, value} (value=null se non esiste)
- `PUT  /api/v1/settings/{key}`  → upsert, body {value: <any JSON>}
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AppSetting

# Chiavi gestite da router dedicati che contengono segreti (es. la API key
# dell'IA, vedi `routers/ai_settings.py`): mai esposte ne' scrivibili qui.
RESERVED_KEYS = {"ai_config"}


def _guard(key: str) -> None:
    if key in RESERVED_KEYS:
        raise HTTPException(403, f"La chiave '{key}' si gestisce dal suo endpoint dedicato")

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class SettingValue(BaseModel):
    value: Any


class SettingOut(BaseModel):
    key: str
    value: Any


@router.get("")
async def list_settings(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    rows = (await db.execute(select(AppSetting))).scalars().all()
    return {r.key: r.value for r in rows if r.key not in RESERVED_KEYS}


@router.get("/{key}", response_model=SettingOut)
async def get_setting(key: str, db: AsyncSession = Depends(get_db)) -> SettingOut:
    _guard(key)
    row = await db.get(AppSetting, key)
    return SettingOut(key=key, value=row.value if row else None)


@router.put("/{key}", response_model=SettingOut)
async def put_setting(
    key: str, payload: SettingValue, db: AsyncSession = Depends(get_db)
) -> SettingOut:
    _guard(key)
    stmt = (
        pg_insert(AppSetting)
        .values(key=key, value=payload.value)
        .on_conflict_do_update(index_elements=["key"], set_={"value": payload.value})
    )
    await db.execute(stmt)
    await db.commit()
    return SettingOut(key=key, value=payload.value)
