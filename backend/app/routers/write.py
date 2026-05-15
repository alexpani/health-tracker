from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DiarioHkSync, PendingWrite
from app.routers.diario import auto_reconcile_if_due
from app.schemas import ConfirmIn, FailIn, PendingWriteOut, WriteIn
from app.services.apns import fire_and_forget_push_all

router = APIRouter(prefix="/api/v1/write", tags=["write"])

# Whitelist: HKQuantityType identifier -> set of allowed units
ALLOWED_WRITE_TYPES: dict[str, set[str]] = {
    # Body
    "HKQuantityTypeIdentifierBodyMass": {"kg", "g", "lb"},
    "HKQuantityTypeIdentifierHeight": {"m", "cm"},
    "HKQuantityTypeIdentifierBodyMassIndex": {"count", ""},
    "HKQuantityTypeIdentifierBodyFatPercentage": {"%"},
    "HKQuantityTypeIdentifierLeanBodyMass": {"kg", "g", "lb"},
    "HKQuantityTypeIdentifierWaistCircumference": {"m", "cm"},
    # Nutrition
    "HKQuantityTypeIdentifierDietaryEnergyConsumed": {"kcal"},
    "HKQuantityTypeIdentifierDietaryCarbohydrates": {"g"},
    "HKQuantityTypeIdentifierDietaryFatTotal": {"g"},
    "HKQuantityTypeIdentifierDietaryProtein": {"g"},
    "HKQuantityTypeIdentifierDietaryFiber": {"g"},
    "HKQuantityTypeIdentifierDietarySugar": {"g"},
    "HKQuantityTypeIdentifierDietaryWater": {"L", "mL"},
    "HKQuantityTypeIdentifierDietaryCaffeine": {"mg", "g"},
}


@router.post("", response_model=PendingWriteOut)
async def create_write(body: WriteIn, db: AsyncSession = Depends(get_db)):
    if body.type not in ALLOWED_WRITE_TYPES:
        raise HTTPException(400, f"Type '{body.type}' not allowed for writing")
    allowed_units = ALLOWED_WRITE_TYPES[body.type]
    if body.unit not in allowed_units:
        raise HTTPException(400, f"Unit '{body.unit}' not allowed for type '{body.type}'. Allowed: {sorted(allowed_units)}")
    if body.start_date > body.end_date:
        raise HTTPException(400, "start_date must be <= end_date")

    row = PendingWrite(
        type=body.type,
        value=body.value,
        unit=body.unit,
        start_date=body.start_date,
        end_date=body.end_date,
        source_name=body.source_name or "Web Dashboard",
        notes=body.notes,
        status="pending",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    # Trigger silent push: sveglia l'iPhone cosi' processa la coda subito
    # invece di aspettare il prossimo HKObserver/SLC/BG task. Fire-and-forget,
    # no-op se APNs non e' configurato o se nessun device e' registrato.
    fire_and_forget_push_all("pending_write")
    return row


@router.get("/pending", response_model=list[PendingWriteOut])
async def list_pending(
    limit: int = Query(100, le=1000),
    db: AsyncSession = Depends(get_db),
):
    # Auto-reconcile diario→HK before serving the queue, so iOS picks up
    # diary changes without a manual button press. Throttled to at most
    # once every 2 minutes; failures (diario down) are swallowed.
    await auto_reconcile_if_due(db)

    stmt = (
        select(PendingWrite)
        .where(PendingWrite.status == "pending")
        .order_by(PendingWrite.created_at.asc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/{write_id}/confirm", response_model=PendingWriteOut)
async def confirm_write(write_id: int, body: ConfirmIn, db: AsyncSession = Depends(get_db)):
    stmt = select(PendingWrite).where(PendingWrite.id == write_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Write not found")
    if row.status != "pending":
        raise HTTPException(409, f"Write already in status '{row.status}'")

    row.status = "written"
    row.written_at = datetime.now(timezone.utc)
    row.hk_uuid = body.hk_uuid

    # Backfill the diario→HK tracking row with the HK-assigned UUID so a
    # future sync-to-hk can delete this sample when the day's total changes.
    tracking_stmt = select(DiarioHkSync).where(DiarioHkSync.pending_write_id == row.id)
    tracking = (await db.execute(tracking_stmt)).scalar_one_or_none()
    if tracking is not None:
        tracking.hk_uuid = body.hk_uuid

    await db.commit()
    await db.refresh(row)
    return row


@router.post("/{write_id}/fail", response_model=PendingWriteOut)
async def fail_write(write_id: int, body: FailIn, db: AsyncSession = Depends(get_db)):
    stmt = select(PendingWrite).where(PendingWrite.id == write_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Write not found")

    row.status = "failed"
    row.error_message = body.error[:2000]
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/recent", response_model=list[PendingWriteOut])
async def recent_writes(
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(PendingWrite)
        .order_by(PendingWrite.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/allowed-types")
async def allowed_types():
    """Return the whitelist for the dashboard to build the form."""
    return {t: sorted(u) for t, u in ALLOWED_WRITE_TYPES.items()}
