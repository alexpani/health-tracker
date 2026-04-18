from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CategorySample, HealthSample, SyncLog, Workout
from app.schemas import (
    AggregatedPoint,
    CategorySampleOut,
    SamplesQueryResponse,
    SyncStatus,
    TypeCount,
    WorkoutOut,
)

router = APIRouter(prefix="/api/v1", tags=["query"])


@router.get("/samples")
async def query_samples(
    type: str,
    start: datetime | None = None,
    end: datetime | None = None,
    aggregation: str = Query("none", pattern="^(none|hourly|daily|weekly|monthly)$"),
    sources: list[str] | None = Query(None),
    devices: list[str] | None = Query(None),
    value_min: float | None = None,
    value_max: float | None = None,
    limit: int = Query(1000, le=10000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    def apply_filters(stmt):
        if sources:
            stmt = stmt.where(HealthSample.source_name.in_(sources))
        if devices:
            stmt = stmt.where(HealthSample.device.in_(devices))
        if value_min is not None:
            stmt = stmt.where(HealthSample.value >= value_min)
        if value_max is not None:
            stmt = stmt.where(HealthSample.value <= value_max)
        return stmt

    if aggregation == "none":
        stmt = select(HealthSample).where(HealthSample.type == type)
        if start:
            stmt = stmt.where(HealthSample.start_date >= start)
        if end:
            stmt = stmt.where(HealthSample.start_date <= end)
        stmt = apply_filters(stmt)
        stmt = stmt.order_by(HealthSample.start_date.desc()).offset(offset).limit(limit)

        result = await db.execute(stmt)
        rows = result.scalars().all()

        # Get total count
        count_stmt = select(func.count()).select_from(HealthSample).where(HealthSample.type == type)
        if start:
            count_stmt = count_stmt.where(HealthSample.start_date >= start)
        if end:
            count_stmt = count_stmt.where(HealthSample.start_date <= end)
        count_stmt = apply_filters(count_stmt)
        total = (await db.execute(count_stmt)).scalar() or 0

        # Get unit from first sample
        unit = rows[0].unit if rows else None

        return SamplesQueryResponse(
            type=type,
            unit=unit,
            aggregation="none",
            data=[
                {
                    "id": r.id,
                    "uuid": r.uuid,
                    "type": r.type,
                    "value": r.value,
                    "unit": r.unit,
                    "start_date": r.start_date,
                    "end_date": r.end_date,
                    "source_name": r.source_name,
                    "device": r.device,
                }
                for r in rows
            ],
            total_count=total,
        )
    else:
        # Aggregated query using date_trunc
        trunc_map = {"hourly": "hour", "daily": "day", "weekly": "week", "monthly": "month"}
        trunc = trunc_map[aggregation]
        period = func.date_trunc(trunc, HealthSample.start_date).label("period_start")

        stmt = (
            select(
                period,
                func.avg(HealthSample.value).label("avg"),
                func.min(HealthSample.value).label("min"),
                func.max(HealthSample.value).label("max"),
                func.count().label("count"),
            )
            .where(HealthSample.type == type)
            .group_by(period)
            .order_by(period.desc())
        )
        if start:
            stmt = stmt.where(HealthSample.start_date >= start)
        if end:
            stmt = stmt.where(HealthSample.start_date <= end)
        stmt = apply_filters(stmt)
        stmt = stmt.offset(offset).limit(limit)

        result = await db.execute(stmt)
        rows = result.all()

        # Get unit
        unit_stmt = (
            select(HealthSample.unit)
            .where(HealthSample.type == type)
            .limit(1)
        )
        unit = (await db.execute(unit_stmt)).scalar()

        return SamplesQueryResponse(
            type=type,
            unit=unit,
            aggregation=aggregation,
            data=[
                AggregatedPoint(
                    period_start=r.period_start,
                    avg=round(r.avg, 2),
                    min=round(r.min, 2),
                    max=round(r.max, 2),
                    count=r.count,
                )
                for r in rows
            ],
            total_count=len(rows),
        )


@router.get("/samples/facets")
async def sample_facets(type: str, db: AsyncSession = Depends(get_db)):
    """
    Returns distinct source_name, device values and min/max for a type.
    Used by the dashboard to populate filter selects.
    """
    sources_stmt = (
        select(HealthSample.source_name)
        .where(HealthSample.type == type)
        .distinct()
    )
    devices_stmt = (
        select(HealthSample.device)
        .where(HealthSample.type == type)
        .distinct()
    )
    range_stmt = (
        select(
            func.min(HealthSample.value).label("min"),
            func.max(HealthSample.value).label("max"),
        )
        .where(HealthSample.type == type)
    )

    sources = [r[0] for r in (await db.execute(sources_stmt)).all() if r[0] is not None]
    devices = [r[0] for r in (await db.execute(devices_stmt)).all() if r[0] is not None]
    rng_row = (await db.execute(range_stmt)).first()

    return {
        "sources": sorted(sources),
        "devices": sorted(devices),
        "value_min": float(rng_row.min) if rng_row and rng_row.min is not None else None,
        "value_max": float(rng_row.max) if rng_row and rng_row.max is not None else None,
    }


@router.get("/samples/types", response_model=list[TypeCount])
async def list_sample_types(db: AsyncSession = Depends(get_db)):
    stmt = select(
        HealthSample.type,
        func.count().label("count"),
        func.max(HealthSample.start_date).label("latest"),
    ).group_by(HealthSample.type)

    result = await db.execute(stmt)
    return [TypeCount(type=r.type, count=r.count, latest=r.latest) for r in result.all()]


@router.get("/samples/latest")
async def latest_sample(type: str, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(HealthSample)
        .where(HealthSample.type == type)
        .order_by(HealthSample.start_date.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if not row:
        return {"type": type, "data": None}
    return {
        "type": type,
        "data": {
            "uuid": str(row.uuid),
            "value": row.value,
            "unit": row.unit,
            "start_date": row.start_date.isoformat(),
            "end_date": row.end_date.isoformat(),
            "source_name": row.source_name,
            "device": row.device,
        },
    }


@router.get("/categories", response_model=list[CategorySampleOut])
async def query_categories(
    type: str,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(1000, le=10000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(CategorySample).where(CategorySample.type == type)
    if start:
        stmt = stmt.where(CategorySample.start_date >= start)
    if end:
        stmt = stmt.where(CategorySample.start_date <= end)
    stmt = stmt.order_by(CategorySample.start_date.desc()).offset(offset).limit(limit)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/workouts", response_model=list[WorkoutOut])
async def query_workouts(
    activity_type: int | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(1000, le=10000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Workout)
    if activity_type is not None:
        stmt = stmt.where(Workout.activity_type == activity_type)
    if start:
        stmt = stmt.where(Workout.start_date >= start)
    if end:
        stmt = stmt.where(Workout.start_date <= end)
    stmt = stmt.order_by(Workout.start_date.desc()).offset(offset).limit(limit)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/samples/{sample_id}/correlated")
async def correlated_samples(
    sample_id: int,
    types: list[str] = Query(...),
    minutes: float = Query(5.0, ge=0, le=60),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns samples of given types within +/- `minutes` of the target sample's start_date.
    Useful to find related measurements (BMI, body fat, lean mass) taken at the same
    instant as a weight sample.
    """
    base = await db.execute(select(HealthSample).where(HealthSample.id == sample_id))
    target = base.scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Sample not found")

    from datetime import timedelta
    window = timedelta(minutes=minutes)
    lower = target.start_date - window
    upper = target.start_date + window

    stmt = (
        select(HealthSample)
        .where(HealthSample.type.in_(types))
        .where(HealthSample.id != sample_id)
        .where(HealthSample.start_date >= lower)
        .where(HealthSample.start_date <= upper)
        .order_by(HealthSample.start_date)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": r.id,
            "uuid": str(r.uuid),
            "type": r.type,
            "value": r.value,
            "unit": r.unit,
            "start_date": r.start_date.isoformat(),
            "source_name": r.source_name,
        }
        for r in rows
    ]


class BulkDeleteIn(BaseModel):
    ids: list[int]


@router.post("/samples/bulk-delete")
async def bulk_delete_samples(body: BulkDeleteIn, db: AsyncSession = Depends(get_db)):
    """
    Deletes samples by id. The trg_blacklist_on_delete trigger automatically
    adds their UUIDs to ingest_blacklist so they won't re-appear on future syncs.
    """
    if not body.ids:
        return {"deleted": 0}
    from sqlalchemy import delete
    stmt = delete(HealthSample).where(HealthSample.id.in_(body.ids))
    result = await db.execute(stmt)
    await db.commit()
    return {"deleted": result.rowcount}


@router.get("/sync/sessions")
async def sync_sessions(limit: int = Query(10, le=100), db: AsyncSession = Depends(get_db)):
    """
    Groups sync_log entries into sessions: consecutive entries within 5 minutes
    of each other belong to the same session. Returns the most recent sessions.
    """
    stmt = text(
        """
        WITH ordered AS (
            SELECT id, device_id, sample_count, synced_at,
                   LAG(synced_at) OVER (ORDER BY synced_at) AS prev_at
            FROM sync_log
        ),
        flagged AS (
            SELECT *,
                   SUM(CASE WHEN prev_at IS NULL OR synced_at - prev_at > INTERVAL '5 minutes' THEN 1 ELSE 0 END)
                       OVER (ORDER BY synced_at) AS session_id
            FROM ordered
        )
        SELECT
            MIN(synced_at) AS started_at,
            MAX(synced_at) AS ended_at,
            EXTRACT(EPOCH FROM (MAX(synced_at) - MIN(synced_at))) AS duration_seconds,
            SUM(sample_count)::bigint AS total_samples,
            COUNT(*)::int AS batches,
            MAX(device_id) AS device_id
        FROM flagged
        GROUP BY session_id
        ORDER BY started_at DESC
        LIMIT :limit
        """
    )
    result = await db.execute(stmt, {"limit": limit})
    return [
        {
            "started_at": r.started_at.isoformat() if r.started_at else None,
            "ended_at": r.ended_at.isoformat() if r.ended_at else None,
            "duration_seconds": float(r.duration_seconds) if r.duration_seconds is not None else 0,
            "total_samples": int(r.total_samples) if r.total_samples is not None else 0,
            "batches": r.batches,
            "device_id": r.device_id,
        }
        for r in result.all()
    ]


@router.get("/sync/status", response_model=SyncStatus)
async def sync_status(
    include_types: bool = Query(False),
    db: AsyncSession = Depends(get_db),
):
    """
    Fast path uses pg_class.reltuples (instant, no table scan) for totals.
    include_types=true adds the per-type breakdown (slower, GROUP BY scan).
    """
    counts_stmt = text(
        """
        SELECT relname, reltuples::bigint AS approx
        FROM pg_class
        WHERE relname IN ('health_samples', 'category_samples', 'workouts')
        """
    )
    counts_result = await db.execute(counts_stmt)
    counts = {r.relname: r.approx for r in counts_result.all()}

    types: list[TypeCount] = []
    if include_types:
        types_stmt = text(
            """
            SELECT type, COUNT(*) AS count, MAX(start_date) AS latest
            FROM health_samples
            GROUP BY type
            """
        )
        types_result = await db.execute(types_stmt)
        types = [TypeCount(type=r.type, count=r.count, latest=r.latest) for r in types_result.all()]

    last_sync_stmt = select(func.max(SyncLog.synced_at))
    last_sync = (await db.execute(last_sync_stmt)).scalar()

    return SyncStatus(
        total_samples=max(counts.get("health_samples", 0), 0),
        total_categories=max(counts.get("category_samples", 0), 0),
        total_workouts=max(counts.get("workouts", 0), 0),
        types=types,
        last_sync=last_sync,
    )
