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


async def _compute_splits(
    db: AsyncSession,
    workout_start: datetime,
    workout_end: datetime,
    distance_km: float = 1.0,
    distance_type: str = "HKQuantityTypeIdentifierDistanceWalkingRunning",
) -> tuple[list[dict], float]:
    """Reconstruct per-distance splits for a workout time window.
    Shared helper used by `/workouts/by-uuid/{uuid}/splits` and
    `/workouts/records` (to compute best single-km PRs)."""
    dist_stmt = (
        select(HealthSample.start_date, HealthSample.end_date, HealthSample.value)
        .where(HealthSample.type == distance_type)
        .where(HealthSample.start_date >= workout_start)
        .where(HealthSample.end_date <= workout_end)
        .order_by(HealthSample.start_date)
    )
    dist_rows = (await db.execute(dist_stmt)).all()
    if not dist_rows:
        return [], 0.0

    hr_stmt = (
        select(HealthSample.start_date, HealthSample.value)
        .where(HealthSample.type == "HKQuantityTypeIdentifierHeartRate")
        .where(HealthSample.start_date >= workout_start)
        .where(HealthSample.start_date <= workout_end)
        .order_by(HealthSample.start_date)
    )
    hr_rows = (await db.execute(hr_stmt)).all()

    split_meters = distance_km * 1000
    splits: list[dict] = []
    cumulative = 0.0
    split_num = 1
    split_start = workout_start
    split_start_distance = 0.0

    for r in dist_rows:
        cumulative += r.value
        while cumulative - split_start_distance >= split_meters:
            split_end = r.end_date
            duration = (split_end - split_start).total_seconds()
            hr_in_split = [h.value for h in hr_rows if split_start <= h.start_date <= split_end]
            avg_hr = sum(hr_in_split) / len(hr_in_split) if hr_in_split else None
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

    return splits, cumulative


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

    splits, cumulative = await _compute_splits(
        db, workout.start_date, workout.end_date, distance_km=distance_km
    )
    if not splits and cumulative == 0.0:
        return {"splits": [], "total_distance": 0, "note": "no distance samples in range"}
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


def _apply_workout_filters(
    stmt,
    *,
    activity_type: list[int] | None = None,
    effective_types: list[str] | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    years: list[int] | None = None,
    sources: list[str] | None = None,
    distance_min: float | None = None,
    distance_max: float | None = None,
    duration_min: float | None = None,
    duration_max: float | None = None,
    pace_min: float | None = None,
    pace_max: float | None = None,
    notes_contains: str | None = None,
    title_contains: str | None = None,
):
    """Apply the common workout filter clauses used by `/workouts`,
    `/workouts/facets`, and `/workouts/records`. Mutates/returns stmt."""
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
        stmt = stmt.where(Workout.total_distance > 100)
        stmt = stmt.where(Workout.duration.is_not(None))
        pace_expr = Workout.duration * 1000.0 / Workout.total_distance
        if pace_min is not None:
            stmt = stmt.where(pace_expr >= pace_min)
        if pace_max is not None:
            stmt = stmt.where(pace_expr <= pace_max)
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
    stmt = _apply_workout_filters(
        select(Workout),
        activity_type=activity_type, effective_types=effective_types,
        start=start, end=end, years=years, sources=sources,
        distance_min=distance_min, distance_max=distance_max,
        duration_min=duration_min, duration_max=duration_max,
        pace_min=pace_min, pace_max=pace_max,
        notes_contains=notes_contains, title_contains=title_contains,
    )
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


# Activity types supporting per-km splits via DistanceWalkingRunning samples.
# Cycling (13 etc.) and swimming (46) use different quantity types; for now
# `best_single_km` is only computed for running (37) / walking (52).
_RUN_WALK_ACTIVITY_TYPES = {37, 52}
_DISTANCE_TARGETS_KM = [5.0, 10.0, 21.097, 42.195]
_DISTANCE_TARGET_TOL = 0.10  # allow total_distance up to target * 1.10


def _workout_row_to_record(row) -> dict:
    """Shape a Workout ORM row into a RecordEntry dict for the API."""
    pace = None
    if row.duration and row.total_distance and row.total_distance > 100:
        pace = row.duration * 1000.0 / row.total_distance
    return {
        "uuid": str(row.uuid),
        "start_date": row.start_date.isoformat(),
        "total_distance": float(row.total_distance) if row.total_distance is not None else None,
        "duration": float(row.duration) if row.duration is not None else None,
        "total_energy_burned": float(row.total_energy_burned) if row.total_energy_burned is not None else None,
        "pace_s_per_km": pace,
    }


@router.get("/workouts/records")
async def workout_records(
    activity_type: list[int] | None = Query(None),
    effective_types: list[str] | None = Query(None),
    start: datetime | None = None,
    end: datetime | None = None,
    years: list[int] | None = Query(None),
    sources: list[str] | None = Query(None),
    distance_min: float | None = None,
    distance_max: float | None = None,
    duration_min: float | None = None,
    duration_max: float | None = None,
    pace_min: float | None = None,
    pace_max: float | None = None,
    notes_contains: str | None = None,
    title_contains: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Personal records aggregated by effective_type, honoring the same filter
    set as `/workouts`. Returns, per activity:
      - overall: longest distance, longest duration, fastest average pace,
        most calories
      - at_distance: best time at ~5K / 10K / mezza / maratona (duration
        min among workouts whose total_distance falls within the target
        range [target_km, target_km * 1.10])
      - best_single_km: fastest single kilometer reconstructed from
        DistanceWalkingRunning samples (running/walking only, sampled from
        the top 30 workouts by average pace)
    """
    filter_kwargs = dict(
        activity_type=activity_type, effective_types=effective_types,
        start=start, end=end, years=years, sources=sources,
        distance_min=distance_min, distance_max=distance_max,
        duration_min=duration_min, duration_max=duration_max,
        pace_min=pace_min, pace_max=pace_max,
        notes_contains=notes_contains, title_contains=title_contains,
    )

    # ---- Find effective_types present in the filtered set ----
    # text() doesn't compose well with our ORM filters, so we run the filter
    # on ORM, collect ids, then let text() work on that subset. This is fast
    # because the id list lives in the same transaction/cache.
    ids_stmt = _apply_workout_filters(select(Workout.id), **filter_kwargs)
    workout_ids = [r[0] for r in (await db.execute(ids_stmt)).all()]
    if not workout_ids:
        return {"by_effective_type": []}

    et_counts_stmt = text(f"""
        SELECT {EFFECTIVE_TYPE_SQL} AS effective_type,
               MIN(activity_type) AS activity_type,
               MIN(activity_name) AS activity_name,
               COUNT(*) AS count
        FROM workouts
        WHERE id = ANY(:ids)
        GROUP BY effective_type
        ORDER BY count DESC
    """).bindparams(ids=workout_ids)
    et_rows = (await db.execute(et_counts_stmt)).all()

    # ---- Resolve (effective_type) -> list[id] bucket map ----
    bucket_stmt = text(f"""
        SELECT id, {EFFECTIVE_TYPE_SQL} AS effective_type
        FROM workouts
        WHERE id = ANY(:ids)
    """).bindparams(ids=workout_ids)
    bucket_rows = (await db.execute(bucket_stmt)).all()
    buckets: dict[str, list[int]] = {}
    for r in bucket_rows:
        buckets.setdefault(r.effective_type, []).append(r.id)

    # ---- Helpers on a bucket id-list ----
    async def _best_by(ids: list[int], order_expr, required_gt_zero=None):
        q = select(Workout).where(Workout.id.in_(ids))
        if required_gt_zero is not None:
            q = q.where(required_gt_zero > 0)
        q = q.order_by(order_expr).limit(1)
        row = (await db.execute(q)).scalar_one_or_none()
        return _workout_row_to_record(row) if row else None

    async def _best_at_distance(ids: list[int], target_km: float):
        target_m = target_km * 1000.0
        q = (
            select(Workout)
            .where(Workout.id.in_(ids))
            .where(Workout.total_distance >= target_m)
            .where(Workout.total_distance <= target_m * (1.0 + _DISTANCE_TARGET_TOL))
            .where(Workout.duration.is_not(None))
            .where(Workout.duration > 0)
            .order_by(Workout.duration.asc())
            .limit(1)
        )
        row = (await db.execute(q)).scalar_one_or_none()
        if not row:
            return None
        rec = _workout_row_to_record(row)
        rec["target_km"] = target_km
        return rec

    async def _best_single_km(ids: list[int]) -> dict | None:
        # Top 30 candidates by average pace (faster first)
        pace_expr = Workout.duration * 1000.0 / Workout.total_distance
        cand_stmt = (
            select(Workout)
            .where(Workout.id.in_(ids))
            .where(Workout.total_distance > 1000)  # need at least 1 km
            .where(Workout.duration.is_not(None))
            .where(Workout.duration > 0)
            .order_by(pace_expr.asc())
            .limit(30)
        )
        candidates = (await db.execute(cand_stmt)).scalars().all()
        # Sanity lower bound: 3:00/km = 180 s/km is already elite-level for
        # a full km. Splits faster than this are almost always artifacts
        # (too few distance samples, GPS glitches, or Endomondo imports
        # without the full per-second distance trace).
        PACE_FLOOR_SEC_PER_KM = 180.0
        best: dict | None = None
        for w in candidates:
            splits, _ = await _compute_splits(db, w.start_date, w.end_date, distance_km=1.0)
            for s in splits:
                if s.get("partial"):
                    continue
                pace = s.get("pace_sec_per_km")
                if pace is None or pace < PACE_FLOOR_SEC_PER_KM:
                    continue
                if best is None or pace < best["pace_s_per_km"]:
                    best = {
                        "uuid": str(w.uuid),
                        "start_date": w.start_date.isoformat(),
                        "n": s["n"],
                        "pace_s_per_km": pace,
                        "avg_heart_rate": s.get("avg_heart_rate"),
                    }
        return best

    # ---- Per-effective-type aggregation ----
    result = []
    pace_expr = Workout.duration * 1000.0 / Workout.total_distance
    for et in et_rows:
        ids = buckets.get(et.effective_type, [])
        if not ids:
            continue

        longest_distance = await _best_by(
            ids, Workout.total_distance.desc(), required_gt_zero=Workout.total_distance
        )
        longest_duration = await _best_by(
            ids, Workout.duration.desc(), required_gt_zero=Workout.duration
        )

        fastest_pace_stmt = (
            select(Workout)
            .where(Workout.id.in_(ids))
            .where(Workout.total_distance > 100)
            .where(Workout.duration.is_not(None))
            .where(Workout.duration > 0)
            .order_by(pace_expr.asc())
            .limit(1)
        )
        fp_row = (await db.execute(fastest_pace_stmt)).scalar_one_or_none()
        fastest_pace = _workout_row_to_record(fp_row) if fp_row else None

        most_calories = await _best_by(
            ids, Workout.total_energy_burned.desc(), required_gt_zero=Workout.total_energy_burned
        )

        at_distance = []
        for target in _DISTANCE_TARGETS_KM:
            rec = await _best_at_distance(ids, target)
            if rec:
                at_distance.append(rec)

        best_km = None
        if et.activity_type in _RUN_WALK_ACTIVITY_TYPES:
            best_km = await _best_single_km(ids)

        result.append({
            "effective_type": et.effective_type,
            "activity_type": et.activity_type,
            "activity_name": et.activity_name,
            "count": et.count,
            "overall": {
                "longest_distance": longest_distance,
                "longest_duration": longest_duration,
                "fastest_pace": fastest_pace,
                "most_calories": most_calories,
            },
            "at_distance": at_distance,
            "best_single_km": best_km,
        })

    return {"by_effective_type": result}


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
