"""App settings router.

Key-value store per le preferenze condivise tra dispositivi (vedi
`models/app_settings.py`). App single-user: nessuno scoping per utente.

- `GET  /api/v1/settings`        → tutte le impostazioni come dict {key: value}
- `GET  /api/v1/settings/{key}`  → {key, value} (value=null se non esiste)
- `PUT  /api/v1/settings/{key}`  → upsert, body {value: <any JSON>}
"""
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AppSetting

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class SettingValue(BaseModel):
    value: Any


class SettingOut(BaseModel):
    key: str
    value: Any


@router.get("")
async def list_settings(db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    rows = (await db.execute(select(AppSetting))).scalars().all()
    return {r.key: r.value for r in rows}


@router.get("/{key}", response_model=SettingOut)
async def get_setting(key: str, db: AsyncSession = Depends(get_db)) -> SettingOut:
    row = await db.get(AppSetting, key)
    return SettingOut(key=key, value=row.value if row else None)


@router.put("/{key}", response_model=SettingOut)
async def put_setting(
    key: str, payload: SettingValue, db: AsyncSession = Depends(get_db)
) -> SettingOut:
    stmt = (
        pg_insert(AppSetting)
        .values(key=key, value=payload.value)
        .on_conflict_do_update(index_elements=["key"], set_={"value": payload.value})
    )
    await db.execute(stmt)
    await db.commit()
    return SettingOut(key=key, value=payload.value)
