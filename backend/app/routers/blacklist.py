from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import HealthSample, IngestBlacklist

router = APIRouter(prefix="/api/v1/blacklist", tags=["blacklist"])


class BlacklistEntry(BaseModel):
    hk_uuid: UUID
    reason: str | None = None


class BlacklistBulkIn(BaseModel):
    entries: list[BlacklistEntry]


class PurgeAndBlacklistIn(BaseModel):
    """Delete matching samples from health_samples and add their UUIDs to the blacklist."""
    types: list[str] | None = None
    source_name: str | None = None
    value_min: float | None = None
    value_max: float | None = None
    reason: str | None = None


@router.get("")
async def list_blacklist(limit: int = Query(500, le=5000), db: AsyncSession = Depends(get_db)):
    stmt = select(IngestBlacklist).order_by(IngestBlacklist.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [
        {"id": r.id, "hk_uuid": str(r.hk_uuid), "reason": r.reason, "created_at": r.created_at.isoformat()}
        for r in rows
    ]


@router.post("/add")
async def add_to_blacklist(body: BlacklistBulkIn, db: AsyncSession = Depends(get_db)):
    if not body.entries:
        return {"added": 0}
    values = [{"hk_uuid": e.hk_uuid, "reason": e.reason} for e in body.entries]
    stmt = insert(IngestBlacklist).values(values).on_conflict_do_nothing(index_elements=["hk_uuid"])
    result = await db.execute(stmt)
    await db.commit()
    return {"added": result.rowcount}


@router.post("/purge-and-blacklist")
async def purge_and_blacklist(body: PurgeAndBlacklistIn, db: AsyncSession = Depends(get_db)):
    """Find matching samples, add their UUIDs to blacklist, then delete them from health_samples."""
    if not (body.types or body.source_name or body.value_min is not None or body.value_max is not None):
        raise HTTPException(400, "At least one filter is required")

    stmt = select(HealthSample.id, HealthSample.uuid, HealthSample.type)
    if body.types:
        stmt = stmt.where(HealthSample.type.in_(body.types))
    if body.source_name:
        stmt = stmt.where(HealthSample.source_name == body.source_name)
    if body.value_min is not None:
        stmt = stmt.where(HealthSample.value >= body.value_min)
    if body.value_max is not None:
        stmt = stmt.where(HealthSample.value < body.value_max)

    rows = (await db.execute(stmt)).all()
    if not rows:
        return {"blacklisted": 0, "deleted": 0}

    ids = [r.id for r in rows]
    uuids = [r.uuid for r in rows]

    # Add to blacklist
    bl_values = [{"hk_uuid": u, "reason": body.reason} for u in uuids]
    bl_stmt = insert(IngestBlacklist).values(bl_values).on_conflict_do_nothing(index_elements=["hk_uuid"])
    bl_result = await db.execute(bl_stmt)

    # Delete from samples
    del_stmt = delete(HealthSample).where(HealthSample.id.in_(ids))
    del_result = await db.execute(del_stmt)
    await db.commit()

    return {
        "blacklisted": bl_result.rowcount,
        "deleted": del_result.rowcount,
    }


@router.delete("/{blacklist_id}")
async def remove_from_blacklist(blacklist_id: int, db: AsyncSession = Depends(get_db)):
    stmt = delete(IngestBlacklist).where(IngestBlacklist.id == blacklist_id)
    result = await db.execute(stmt)
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Not found")
    return {"removed": True}
