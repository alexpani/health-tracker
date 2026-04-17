from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import HealthSample, PendingDeletion
from app.schemas import (
    ConfirmIn,
    DeletionPlanIn,
    DeletionPlanOut,
    FailIn,
    PendingDeletionOut,
)

router = APIRouter(prefix="/api/v1/delete", tags=["delete"])


@router.post("/plan", response_model=DeletionPlanOut)
async def plan_deletion(body: DeletionPlanIn, db: AsyncSession = Depends(get_db)):
    """
    Create pending deletions for samples matching criteria.
    The iOS app will later process these and actually delete from Apple Health.
    """
    if not body.types:
        raise HTTPException(400, "Must specify at least one type")

    # 1. Find primary matches
    stmt = select(HealthSample.id, HealthSample.uuid, HealthSample.type, HealthSample.start_date).where(
        HealthSample.type.in_(body.types)
    )
    if body.source_name:
        stmt = stmt.where(HealthSample.source_name == body.source_name)
    if body.value_min is not None:
        stmt = stmt.where(HealthSample.value >= body.value_min)
    if body.value_max is not None:
        stmt = stmt.where(HealthSample.value < body.value_max)
    if body.start_after:
        stmt = stmt.where(HealthSample.start_date >= body.start_after)
    if body.start_before:
        stmt = stmt.where(HealthSample.start_date <= body.start_before)

    result = await db.execute(stmt)
    primary_rows = result.all()

    # 2. If correlated_at_same_instant, gather additional samples with same start_date
    correlated_rows: list = []
    if body.also_correlated_at_same_instant and body.correlated_types:
        start_dates = {r.start_date for r in primary_rows}
        if start_dates:
            cor_stmt = select(HealthSample.id, HealthSample.uuid, HealthSample.type, HealthSample.start_date).where(
                and_(
                    HealthSample.type.in_(body.correlated_types),
                    HealthSample.start_date.in_(start_dates),
                )
            )
            if body.source_name:
                cor_stmt = cor_stmt.where(HealthSample.source_name == body.source_name)
            cor_result = await db.execute(cor_stmt)
            correlated_rows = cor_result.all()

    all_rows = list(primary_rows) + list(correlated_rows)

    # Dedup by id
    seen_ids: set[int] = set()
    deduped: list = []
    for r in all_rows:
        if r.id not in seen_ids:
            seen_ids.add(r.id)
            deduped.append(r)

    by_type: dict[str, int] = {}
    for r in deduped:
        by_type[r.type] = by_type.get(r.type, 0) + 1

    # 3. Insert PendingDeletion rows
    for r in deduped:
        db.add(PendingDeletion(
            hk_uuid=r.uuid,
            type=r.type,
            source_sample_id=r.id,
            status="pending",
        ))
    await db.commit()

    return DeletionPlanOut(total=len(deduped), by_type=by_type)


@router.get("/pending", response_model=list[PendingDeletionOut])
async def list_pending(
    limit: int = Query(500, le=5000),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(PendingDeletion)
        .where(PendingDeletion.status == "pending")
        .order_by(PendingDeletion.created_at.asc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/{deletion_id}/confirm", response_model=PendingDeletionOut)
async def confirm_deletion(deletion_id: int, db: AsyncSession = Depends(get_db)):
    """iOS app confirmed it deleted the HKSample. Now remove from backend DB."""
    stmt = select(PendingDeletion).where(PendingDeletion.id == deletion_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Pending deletion not found")
    if row.status != "pending":
        raise HTTPException(409, f"Already in status '{row.status}'")

    # Delete from health_samples
    if row.source_sample_id is not None:
        await db.execute(delete(HealthSample).where(HealthSample.id == row.source_sample_id))

    row.status = "deleted"
    row.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    return row


@router.post("/{deletion_id}/fail", response_model=PendingDeletionOut)
async def fail_deletion(deletion_id: int, body: FailIn, db: AsyncSession = Depends(get_db)):
    stmt = select(PendingDeletion).where(PendingDeletion.id == deletion_id)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Pending deletion not found")

    row.status = "failed"
    row.error_message = body.error[:2000]
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/status")
async def status(db: AsyncSession = Depends(get_db)):
    """Summary counts per status."""
    from sqlalchemy import func
    stmt = select(PendingDeletion.status, func.count()).group_by(PendingDeletion.status)
    result = await db.execute(stmt)
    return {s: c for s, c in result.all()}
