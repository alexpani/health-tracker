from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CategorySample, HealthSample, PendingDeletion, SyncLog, Workout
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
    Returns distinct source_name, device values, min/max, and per-year
    counts for a type. Used by the dashboard to populate filter selects —
    deliberately NOT filtered by time so the chips always show the full
    historical span regardless of the current date-range filter.
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
    years_stmt = (
        select(
            func.extract("year", HealthSample.start_date).label("y"),
            func.count().label("c"),
        )
        .where(HealthSample.type == type)
        .group_by("y")
        .order_by("y")
    )

    sources = [r[0] for r in (await db.execute(sources_stmt)).all() if r[0] is not None]
    devices = [r[0] for r in (await db.execute(devices_stmt)).all() if r[0] is not None]
    rng_row = (await db.execute(range_stmt)).first()
    years = [{"year": int(r.y), "count": r.c} for r in (await db.execute(years_stmt)).all()]

    return {
        "sources": sorted(sources),
        "devices": sorted(devices),
        "value_min": float(rng_row.min) if rng_row and rng_row.min is not None else None,
        "value_max": float(rng_row.max) if rng_row and rng_row.max is not None else None,
        "years": years,
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
        .order_by(HealthSample.start_date.desc(), HealthSample.id.desc())
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


@router.get("/workouts/by-uuid/{workout_uuid}")
async def workout_by_uuid(workout_uuid: str, db: AsyncSession = Depends(get_db)):
    """Return a single workout by UUID."""
    stmt = select(Workout).where(Workout.uuid == workout_uuid)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Workout not found")
    return {
        "id": row.id,
        "uuid": str(row.uuid),
        "activity_type": row.activity_type,
        "activity_name": row.activity_name,
        "duration": row.duration,
        "total_energy_burned": row.total_energy_burned,
        "total_distance": row.total_distance,
        "start_date": row.start_date.isoformat(),
        "end_date": row.end_date.isoformat(),
        "source_name": row.source_name,
        "metadata": row.metadata_,
        "title": row.title,
        "notes": row.notes,
        "activities": row.activities_,
    }


class WorkoutUpdate(BaseModel):
    notes: str | None = None
    title: str | None = None


@router.patch("/workouts/by-uuid/{workout_uuid}")
async def update_workout(workout_uuid: str, body: WorkoutUpdate, db: AsyncSession = Depends(get_db)):
    """Update editable fields of a workout (title, notes). Empty string clears the field."""
    stmt = select(Workout).where(Workout.uuid == workout_uuid)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Workout not found")
    data = body.model_dump(exclude_unset=True)
    if "notes" in data:
        row.notes = data["notes"] if data["notes"] else None
    if "title" in data:
        row.title = data["title"] if data["title"] else None
    await db.commit()
    await db.refresh(row)
    return {
        "uuid": str(row.uuid),
        "title": row.title,
        "notes": row.notes,
    }


@router.get("/workouts/by-uuid/{workout_uuid}/splits")
async def workout_splits(workout_uuid: str, distance_km: float = 1.0, db: AsyncSession = Depends(get_db)):
    """
    Calculate per-distance splits (default 1 km each) for a workout.
    Uses DistanceWalkingRunning samples within the workout's time range.
    Returns: list of splits with duration, avg pace, avg heart rate.
    """
    wstmt = select(Workout).where(Workout.uuid == workout_uuid)
    workout = (await db.execute(wstmt)).scalar_one_or_none()
    if not workout:
        raise HTTPException(404, "Workout not found")

    # Get all distance samples within workout range, ordered
    dist_stmt = (
        select(HealthSample.start_date, HealthSample.end_date, HealthSample.value)
        .where(HealthSample.type == "HKQuantityTypeIdentifierDistanceWalkingRunning")
        .where(HealthSample.start_date >= workout.start_date)
        .where(HealthSample.end_date <= workout.end_date)
        .order_by(HealthSample.start_date)
    )
    dist_rows = (await db.execute(dist_stmt)).all()
    if not dist_rows:
        return {"splits": [], "total_distance": 0, "note": "no distance samples in range"}

    # Get heart rate samples in range
    hr_stmt = (
        select(HealthSample.start_date, HealthSample.value)
        .where(HealthSample.type == "HKQuantityTypeIdentifierHeartRate")
        .where(HealthSample.start_date >= workout.start_date)
        .where(HealthSample.start_date <= workout.end_date)
        .order_by(HealthSample.start_date)
    )
    hr_rows = (await db.execute(hr_stmt)).all()

    # Build splits: walk through distance samples accumulating distance
    split_meters = distance_km * 1000
    splits = []
    cumulative = 0.0
    split_num = 1
    split_start = workout.start_date
    split_start_distance = 0.0

    for r in dist_rows:
        cumulative += r.value
        # When we cross the split boundary, finalize
        while cumulative - split_start_distance >= split_meters:
            # Interpolate the end time
            split_end = r.end_date
            duration = (split_end - split_start).total_seconds()
            # Average HR during this split
            hr_in_split = [h.value for h in hr_rows if split_start <= h.start_date <= split_end]
            avg_hr = sum(hr_in_split) / len(hr_in_split) if hr_in_split else None
            # Pace in sec/km
            pace_sec_per_km = duration / distance_km if duration > 0 else None
            splits.append({
                "n": split_num,
                "distance_km": round((cumulative - split_start_distance) / 1000, 3),
                "duration_seconds": duration,
                "pace_sec_per_km": pace_sec_per_km,
                "avg_heart_rate": round(avg_hr, 1) if avg_hr else None,
            })
            split_start_distance += split_meters
            split_start = split_end
            split_num += 1

    # Final partial split (if any)
    if cumulative - split_start_distance > 0:
        split_end = dist_rows[-1].end_date
        duration = (split_end - split_start).total_seconds()
        hr_in_split = [h.value for h in hr_rows if split_start <= h.start_date <= split_end]
        avg_hr = sum(hr_in_split) / len(hr_in_split) if hr_in_split else None
        partial_km = (cumulative - split_start_distance) / 1000
        pace_sec_per_km = duration / partial_km if partial_km > 0 else None
        splits.append({
            "n": split_num,
            "distance_km": round(partial_km, 3),
            "duration_seconds": duration,
            "pace_sec_per_km": pace_sec_per_km,
            "avg_heart_rate": round(avg_hr, 1) if avg_hr else None,
            "partial": True,
        })

    return {"splits": splits, "total_distance_meters": cumulative}


# SQL snippet that turns (activity_type, metadata) into an "effective_type" slug.
# Mirrored in the frontend helper. Keep in sync.
EFFECTIVE_TYPE_SQL = """
CASE
    WHEN workouts.activity_type = 37 AND workouts.metadata->>'HKIndoorWorkout' = '1' THEN 'treadmill_run'
    WHEN workouts.activity_type = 52 AND workouts.metadata->>'HKIndoorWorkout' = '1' THEN 'treadmill_walk'
    WHEN workouts.activity_type = 13 AND workouts.metadata->>'HKIndoorWorkout' = '1' THEN 'cyclette'
    WHEN workouts.activity_type = 46 AND workouts.metadata->>'HKSwimmingLocationType' = '1' THEN 'swim_pool'
    WHEN workouts.activity_type = 46 AND workouts.metadata->>'HKSwimmingLocationType' = '2' THEN 'swim_open_water'
    ELSE 'type_' || workouts.activity_type::text
END
"""


def _apply_effective_type_filter(stmt, effective_types: list[str]):
    """Add WHERE clauses that match any of the given effective_type slugs."""
    from sqlalchemy import or_, and_

    conds = []
    for et in effective_types:
        if et == "treadmill_run":
            conds.append(and_(Workout.activity_type == 37, text("metadata->>'HKIndoorWorkout' = '1'")))
        elif et == "treadmill_walk":
            conds.append(and_(Workout.activity_type == 52, text("metadata->>'HKIndoorWorkout' = '1'")))
        elif et == "cyclette":
            conds.append(and_(Workout.activity_type == 13, text("metadata->>'HKIndoorWorkout' = '1'")))
        elif et == "swim_pool":
            conds.append(and_(Workout.activity_type == 46, text("metadata->>'HKSwimmingLocationType' = '1'")))
        elif et == "swim_open_water":
            conds.append(and_(Workout.activity_type == 46, text("metadata->>'HKSwimmingLocationType' = '2'")))
        elif et.startswith("type_"):
            try:
                t = int(et.split("_", 1)[1])
            except ValueError:
                continue
            # "type_XXX" means the plain type with NO variant match
            if t == 37 or t == 52 or t == 13:
                conds.append(and_(
                    Workout.activity_type == t,
                    text("(metadata->>'HKIndoorWorkout' IS NULL OR metadata->>'HKIndoorWorkout' != '1')"),
                ))
            elif t == 46:
                conds.append(and_(
                    Workout.activity_type == t,
                    text("metadata->>'HKSwimmingLocationType' IS NULL"),
                ))
            else:
                conds.append(Workout.activity_type == t)

    if conds:
        stmt = stmt.where(or_(*conds))
    return stmt


@router.get("/workouts", response_model=list[WorkoutOut])
async def query_workouts(
    activity_type: list[int] | None = Query(None),
    effective_types: list[str] | None = Query(None),
    start: datetime | None = None,
    end: datetime | None = None,
    years: list[int] | None = Query(None),
    sources: list[str] | None = Query(None),
    distance_min: float | None = None,  # meters
    distance_max: float | None = None,  # meters
    duration_min: float | None = None,  # seconds
    duration_max: float | None = None,  # seconds
    pace_min: float | None = None,      # seconds per km (faster = lower)
    pace_max: float | None = None,      # seconds per km (slower = higher)
    notes_contains: str | None = None,  # ILIKE %value%
    title_contains: str | None = None,  # ILIKE %value%
    limit: int = Query(1000, le=10000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Workout)
    if activity_type:
        stmt = stmt.where(Workout.activity_type.in_(activity_type))
    if effective_types:
        stmt = _apply_effective_type_filter(stmt, effective_types)
    if start:
        stmt = stmt.where(Workout.start_date >= start)
    if end:
        stmt = stmt.where(Workout.start_date <= end)
    if years:
        stmt = stmt.where(func.extract("year", Workout.start_date).in_(years))
    if sources:
        stmt = stmt.where(Workout.source_name.in_(sources))
    if distance_min is not None:
        stmt = stmt.where(Workout.total_distance >= distance_min)
    if distance_max is not None:
        stmt = stmt.where(Workout.total_distance <= distance_max)
    if duration_min is not None:
        stmt = stmt.where(Workout.duration >= duration_min)
    if duration_max is not None:
        stmt = stmt.where(Workout.duration <= duration_max)
    if notes_contains:
        stmt = stmt.where(Workout.notes.ilike(f"%{notes_contains}%"))
    if title_contains:
        stmt = stmt.where(Workout.title.ilike(f"%{title_contains}%"))
    if pace_min is not None or pace_max is not None:
        # pace = duration / (distance_m / 1000) = duration * 1000 / distance
        # Filter only workouts with meaningful distance (> 100 m) to avoid div-by-zero
        stmt = stmt.where(Workout.total_distance > 100)
        stmt = stmt.where(Workout.duration.is_not(None))
        pace_expr = Workout.duration * 1000.0 / Workout.total_distance
        if pace_min is not None:
            stmt = stmt.where(pace_expr >= pace_min)
        if pace_max is not None:
            stmt = stmt.where(pace_expr <= pace_max)
    stmt = stmt.order_by(Workout.start_date.desc()).offset(offset).limit(limit)

    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/workouts/facets")
async def workout_facets(db: AsyncSession = Depends(get_db)):
    """
    Returns distinct *effective types* (including metadata-derived variants like
    treadmill_run, swim_pool) with counts, plus sources and distance range.
    """
    # Effective types with counts
    et_stmt = text(f"""
        SELECT {EFFECTIVE_TYPE_SQL} AS effective_type,
               MIN(activity_type) AS activity_type,
               MIN(activity_name) AS activity_name,
               COUNT(*) AS count
        FROM workouts
        GROUP BY effective_type
        ORDER BY count DESC
    """)
    et_rows = (await db.execute(et_stmt)).all()

    sources_stmt = select(Workout.source_name).distinct()
    range_stmt = select(
        func.min(Workout.total_distance).label("dmin"),
        func.max(Workout.total_distance).label("dmax"),
        func.min(Workout.duration).label("durmin"),
        func.max(Workout.duration).label("durmax"),
    )
    years_stmt = select(
        func.extract("year", Workout.start_date).label("y"),
        func.count().label("c"),
    ).group_by("y").order_by("y")

    sources = [r[0] for r in (await db.execute(sources_stmt)).all() if r[0] is not None]
    rng = (await db.execute(range_stmt)).first()
    years = [{"year": int(r.y), "count": r.c} for r in (await db.execute(years_stmt)).all()]

    return {
        "effective_types": [
            {
                "slug": r.effective_type,
                "activity_type": r.activity_type,
                "activity_name": r.activity_name,
                "count": r.count,
            }
            for r in et_rows
        ],
        "sources": sorted(sources),
        "years": years,
        "distance_min": float(rng.dmin) if rng and rng.dmin is not None else None,
        "distance_max": float(rng.dmax) if rng and rng.dmax is not None else None,
        "duration_min": float(rng.durmin) if rng and rng.durmin is not None else None,
        "duration_max": float(rng.durmax) if rng and rng.durmax is not None else None,
    }


@router.delete("/workouts/by-uuid/{workout_uuid}")
async def delete_workout(workout_uuid: str, db: AsyncSession = Depends(get_db)):
    """Delete a single workout by UUID. Returns its payload so the client can restore it (undo)."""
    stmt = select(Workout).where(Workout.uuid == workout_uuid)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Workout not found")

    from sqlalchemy import delete as sqldelete
    snapshot = {
        "uuid": str(row.uuid),
        "activity_type": row.activity_type,
        "activity_name": row.activity_name,
        "duration": row.duration,
        "total_energy_burned": row.total_energy_burned,
        "total_distance": row.total_distance,
        "start_date": row.start_date.isoformat(),
        "end_date": row.end_date.isoformat(),
        "source_name": row.source_name,
        "metadata": row.metadata_,
        "title": row.title,
        "notes": row.notes,
        "activities": row.activities_,
    }
    await db.execute(sqldelete(Workout).where(Workout.id == row.id))
    await db.commit()
    return {"deleted": True, "snapshot": snapshot}


class WorkoutBulkDeleteIn(BaseModel):
    uuids: list[UUID]


@router.post("/workouts/bulk-delete")
async def bulk_delete_workouts(body: WorkoutBulkDeleteIn, db: AsyncSession = Depends(get_db)):
    """Delete workouts by UUID. Trigger will auto-blacklist them."""
    if not body.uuids:
        return {"deleted": 0}
    from sqlalchemy import delete as sqldelete
    stmt = sqldelete(Workout).where(Workout.uuid.in_(body.uuids))
    result = await db.execute(stmt)
    await db.commit()
    return {"deleted": result.rowcount}


class SampleBulkDeleteUuidsIn(BaseModel):
    uuids: list[UUID]


@router.post("/samples/bulk-delete-by-uuids")
async def bulk_delete_samples_by_uuids(body: SampleBulkDeleteUuidsIn, db: AsyncSession = Depends(get_db)):
    """Delete health samples by UUID (used by iOS anchored-sync deletion propagation).
    The auto-blacklist trigger on health_samples will prevent re-ingestion."""
    if not body.uuids:
        return {"deleted": 0}
    from sqlalchemy import delete as sqldelete
    stmt = sqldelete(HealthSample).where(HealthSample.uuid.in_(body.uuids))
    result = await db.execute(stmt)
    await db.commit()
    return {"deleted": result.rowcount}


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
    Deletes samples by id and enqueues PendingDeletion rows so the iOS app
    will attempt to delete the same samples from Apple Health on its next
    sync. HealthKit only lets apps delete samples they created themselves,
    so delete attempts for third-party samples (e.g., Withings) will fail
    on iOS and the HKSample will stay in Apple Salute; the sample is still
    removed from the backend DB and blacklisted (via trg_blacklist_on_delete)
    so it won't re-appear on future syncs.
    """
    if not body.ids:
        return {"deleted": 0}
    from sqlalchemy import delete

    # Fetch uuid/type/id before deleting so we can enqueue the HK deletion.
    fetch_stmt = select(HealthSample.id, HealthSample.uuid, HealthSample.type).where(
        HealthSample.id.in_(body.ids)
    )
    rows = (await db.execute(fetch_stmt)).all()
    for r in rows:
        db.add(PendingDeletion(
            hk_uuid=r.uuid,
            type=r.type,
            source_sample_id=r.id,
            status="pending",
        ))

    stmt = delete(HealthSample).where(HealthSample.id.in_(body.ids))
    result = await db.execute(stmt)
    await db.commit()
    return {"deleted": result.rowcount, "hk_deletion_enqueued": len(rows)}


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
