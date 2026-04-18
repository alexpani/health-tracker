from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import IngestBlacklist, IngestRule

router = APIRouter(prefix="/api/v1/rules", tags=["rules"])


class RuleIn(BaseModel):
    rule_type: str  # 'value_range' | 'blocked_source'
    type_identifier: str | None = None
    source_name: str | None = None
    value_min: float | None = None
    value_max: float | None = None
    active: bool = True
    reason: str | None = None


class RuleUpdate(BaseModel):
    value_min: float | None = None
    value_max: float | None = None
    active: bool | None = None
    reason: str | None = None


class RuleOut(BaseModel):
    id: int
    rule_type: str
    type_identifier: str | None
    source_name: str | None
    value_min: float | None
    value_max: float | None
    active: bool
    reason: str | None
    hits_count: int
    last_hit_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[RuleOut])
async def list_rules(db: AsyncSession = Depends(get_db)):
    stmt = select(IngestRule).order_by(IngestRule.rule_type, IngestRule.type_identifier, IngestRule.source_name)
    return (await db.execute(stmt)).scalars().all()


@router.post("", response_model=RuleOut)
async def create_rule(body: RuleIn, db: AsyncSession = Depends(get_db)):
    if body.rule_type not in ("value_range", "blocked_source"):
        raise HTTPException(400, "rule_type must be 'value_range' or 'blocked_source'")
    if body.rule_type == "value_range":
        if not body.type_identifier:
            raise HTTPException(400, "value_range requires type_identifier")
        if body.value_min is None and body.value_max is None:
            raise HTTPException(400, "value_range requires value_min or value_max")
    if body.rule_type == "blocked_source" and not body.source_name:
        raise HTTPException(400, "blocked_source requires source_name")

    row = IngestRule(**body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.patch("/{rule_id}", response_model=RuleOut)
async def update_rule(rule_id: int, body: RuleUpdate, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(IngestRule).where(IngestRule.id == rule_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{rule_id}")
async def delete_rule(rule_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(delete(IngestRule).where(IngestRule.id == rule_id))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Not found")
    return {"deleted": True}


@router.post("/{rule_id}/reset-stats", response_model=RuleOut)
async def reset_stats(rule_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(IngestRule).where(IngestRule.id == rule_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Not found")
    row.hits_count = 0
    row.last_hit_at = None
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/summary")
async def rules_summary(db: AsyncSession = Depends(get_db)):
    """Overall counts (rules active, blacklist size, etc.)."""
    rules_active = (await db.execute(
        select(func.count()).select_from(IngestRule).where(IngestRule.active == True)
    )).scalar() or 0
    rules_total = (await db.execute(select(func.count()).select_from(IngestRule))).scalar() or 0
    bl_size = (await db.execute(select(func.count()).select_from(IngestBlacklist))).scalar() or 0

    # Hits in last 7 days (aggregated across all rules, using last_hit_at)
    recent_stmt = select(func.sum(IngestRule.hits_count)).where(
        IngestRule.last_hit_at >= datetime.now(timezone.utc) - timedelta(days=7)
    )
    recent_hits = (await db.execute(recent_stmt)).scalar() or 0

    total_hits = (await db.execute(select(func.sum(IngestRule.hits_count)))).scalar() or 0

    return {
        "rules_active": rules_active,
        "rules_total": rules_total,
        "blacklist_size": bl_size,
        "total_hits": total_hits,
        "recent_hits_7d": recent_hits,
    }
