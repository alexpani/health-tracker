"""
Device registry endpoints per silent push APNs.

L'iOS chiama `POST /api/v1/devices/register` ogni volta che il sistema gli
notifica un nuovo APNs token (capita al primo launch dopo install, dopo
reset network settings, dopo TestFlight update, ecc). L'upsert su
`device_id` riusa la stessa row, aggiornando token + `last_seen_at`.

`POST /api/v1/devices/{device_id}/heartbeat` e' opzionale per ora — utile
in futuro se vogliamo monitorare devices "morti" che non aggiornano
last_seen_at.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.devices import Device

router = APIRouter(prefix="/api/v1/devices", tags=["devices"])


class DeviceRegisterIn(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=64)
    apns_token: str = Field(..., min_length=8, max_length=200)
    bundle_id: str | None = Field(default=None, max_length=200)
    apns_env: str = Field(default="sandbox", pattern=r"^(production|sandbox)$")


class DeviceOut(BaseModel):
    device_id: str
    apns_env: str | None
    bundle_id: str | None
    created_at: datetime
    last_seen_at: datetime
    last_push_at: datetime | None


@router.post("/register", response_model=DeviceOut)
async def register_device(payload: DeviceRegisterIn, db: AsyncSession = Depends(get_db)):
    """
    Upsert su `device_id`. Aggiorna sempre token + env + last_seen_at.
    Crea la row al primo invio.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        pg_insert(Device.__table__)
        .values(
            device_id=payload.device_id,
            apns_token=payload.apns_token,
            bundle_id=payload.bundle_id,
            apns_env=payload.apns_env,
            created_at=now,
            last_seen_at=now,
        )
        .on_conflict_do_update(
            index_elements=["device_id"],
            set_={
                "apns_token": payload.apns_token,
                "bundle_id": payload.bundle_id,
                "apns_env": payload.apns_env,
                "last_seen_at": now,
            },
        )
    )
    await db.execute(stmt)
    await db.commit()

    result = await db.execute(select(Device).where(Device.device_id == payload.device_id))
    device = result.scalar_one()
    return DeviceOut(
        device_id=device.device_id,
        apns_env=device.apns_env,
        bundle_id=device.bundle_id,
        created_at=device.created_at,
        last_seen_at=device.last_seen_at,
        last_push_at=device.last_push_at,
    )


@router.post("/{device_id}/heartbeat")
async def heartbeat(device_id: str, db: AsyncSession = Depends(get_db)):
    """
    Aggiorna solo `last_seen_at`. 404 se il device non e' registrato.
    """
    result = await db.execute(select(Device).where(Device.device_id == device_id))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="device not registered")
    device.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    return {"device_id": device_id, "last_seen_at": device.last_seen_at}


@router.get("/{device_id}", response_model=DeviceOut)
async def get_device(device_id: str, db: AsyncSession = Depends(get_db)):
    """Info di debug: stato registrazione + ultimo push inviato."""
    result = await db.execute(select(Device).where(Device.device_id == device_id))
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="device not registered")
    return DeviceOut(
        device_id=device.device_id,
        apns_env=device.apns_env,
        bundle_id=device.bundle_id,
        created_at=device.created_at,
        last_seen_at=device.last_seen_at,
        last_push_at=device.last_push_at,
    )
