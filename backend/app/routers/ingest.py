from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CategorySample, HealthSample, IngestBlacklist, IngestRule, SyncLog, Workout
from app.schemas import BatchResult, CategoryBatchIn, SampleBatchIn, WorkoutBatchIn

router = APIRouter(prefix="/api/v1", tags=["ingest"])


async def _apply_rules(db: AsyncSession, samples: list) -> tuple[list, dict[int, int]]:
    """
    Apply configurable ingest rules from DB.
    Returns (kept_samples, hits_by_rule_id).
    """
    if not samples:
        return samples, {}

    stmt = select(IngestRule).where(IngestRule.active == True)
    rules = (await db.execute(stmt)).scalars().all()
    if not rules:
        return samples, {}

    kept = []
    hits: dict[int, int] = {}

    for s in samples:
        blocked_by = None
        for r in rules:
            if r.rule_type == "blocked_source":
                if r.source_name and s.source_name == r.source_name:
                    # Optional per-type constraint
                    if r.type_identifier and s.type != r.type_identifier:
                        continue
                    blocked_by = r.id
                    break
            elif r.rule_type == "value_range":
                if r.type_identifier and s.type == r.type_identifier:
                    if r.value_min is not None and s.value < r.value_min:
                        blocked_by = r.id
                        break
                    if r.value_max is not None and s.value > r.value_max:
                        blocked_by = r.id
                        break
        if blocked_by is not None:
            hits[blocked_by] = hits.get(blocked_by, 0) + 1
        else:
            kept.append(s)

    return kept, hits


async def _record_rule_hits(db: AsyncSession, hits: dict[int, int]):
    if not hits:
        return
    now = datetime.now(timezone.utc)
    for rule_id, n in hits.items():
        await db.execute(
            update(IngestRule)
            .where(IngestRule.id == rule_id)
            .values(hits_count=IngestRule.hits_count + n, last_hit_at=now)
        )


async def _remove_blacklisted(db: AsyncSession, samples: list) -> tuple[list, int]:
    """Filter out samples whose UUIDs are in the ingest blacklist."""
    if not samples:
        return samples, 0
    uuids = [s.uuid for s in samples]
    stmt = select(IngestBlacklist.hk_uuid).where(IngestBlacklist.hk_uuid.in_(uuids))
    result = await db.execute(stmt)
    blocked = {r[0] for r in result.all()}
    if not blocked:
        return samples, 0
    kept = [s for s in samples if s.uuid not in blocked]
    return kept, len(samples) - len(kept)


@router.post("/samples/batch", response_model=BatchResult)
async def ingest_samples(batch: SampleBatchIn, db: AsyncSession = Depends(get_db)):
    if not batch.samples:
        return BatchResult(inserted=0, duplicates_skipped=0)

    # 1. Remove blacklisted UUIDs
    samples_after_bl, bl_count = await _remove_blacklisted(db, batch.samples)
    # 2. Apply DB-configured rules (value_range, blocked_source)
    accepted, rule_hits = await _apply_rules(db, samples_after_bl)
    await _record_rule_hits(db, rule_hits)
    filtered_out = len(batch.samples) - len(accepted)

    if not accepted:
        await db.commit()  # persist rule hits + sync_log row below
        return BatchResult(inserted=0, duplicates_skipped=filtered_out)

    values = [
        {
            "uuid": s.uuid,
            "type": s.type,
            "value": s.value,
            "unit": s.unit,
            "start_date": s.start_date,
            "end_date": s.end_date,
            "source_name": s.source_name,
            "source_bundle_id": s.source_bundle_id,
            "device": s.device,
            "metadata": s.metadata,
        }
        for s in accepted
    ]

    stmt = insert(HealthSample.__table__).values(values).on_conflict_do_nothing(index_elements=["uuid"])
    result = await db.execute(stmt)
    inserted = result.rowcount

    # Log the sync
    await db.execute(
        insert(SyncLog.__table__).values(device_id=batch.device_id, sample_count=inserted)
    )
    await db.commit()

    return BatchResult(
        inserted=inserted,
        duplicates_skipped=len(accepted) - inserted + filtered_out,
    )


@router.post("/categories/batch", response_model=BatchResult)
async def ingest_categories(batch: CategoryBatchIn, db: AsyncSession = Depends(get_db)):
    if not batch.samples:
        return BatchResult(inserted=0, duplicates_skipped=0)

    values = [
        {
            "uuid": s.uuid,
            "type": s.type,
            "value": s.value,
            "start_date": s.start_date,
            "end_date": s.end_date,
            "source_name": s.source_name,
            "source_bundle_id": s.source_bundle_id,
            "metadata": s.metadata,
        }
        for s in batch.samples
    ]

    stmt = (
        insert(CategorySample.__table__).values(values).on_conflict_do_nothing(index_elements=["uuid"])
    )
    result = await db.execute(stmt)
    inserted = result.rowcount

    await db.execute(
        insert(SyncLog.__table__).values(device_id=batch.device_id, sample_count=inserted)
    )
    await db.commit()

    return BatchResult(
        inserted=inserted,
        duplicates_skipped=len(batch.samples) - inserted,
    )


@router.post("/workouts/batch", response_model=BatchResult)
async def ingest_workouts(batch: WorkoutBatchIn, db: AsyncSession = Depends(get_db)):
    if not batch.workouts:
        return BatchResult(inserted=0, duplicates_skipped=0)

    # Filter out blacklisted UUIDs (same pool used for samples)
    uuids = [w.uuid for w in batch.workouts]
    bl_stmt = select(IngestBlacklist.hk_uuid).where(IngestBlacklist.hk_uuid.in_(uuids))
    blocked = {r[0] for r in (await db.execute(bl_stmt)).all()}
    original_count = len(batch.workouts)
    workouts_in = [w for w in batch.workouts if w.uuid not in blocked]
    bl_filtered = original_count - len(workouts_in)
    if not workouts_in:
        return BatchResult(inserted=0, duplicates_skipped=bl_filtered)

    values = [
        {
            "uuid": w.uuid,
            "activity_type": w.activity_type,
            "activity_name": w.activity_name,
            "duration": w.duration,
            "total_energy_burned": w.total_energy_burned,
            "total_distance": w.total_distance,
            "start_date": w.start_date,
            "end_date": w.end_date,
            "source_name": w.source_name,
            "metadata": w.metadata,
            "title": w.title or ((w.metadata or {}).get("workout name") if isinstance(w.metadata, dict) else None),
            "notes": w.notes,
        }
        for w in workouts_in
    ]

    stmt = insert(Workout.__table__).values(values).on_conflict_do_nothing(index_elements=["uuid"])
    result = await db.execute(stmt)
    inserted = result.rowcount

    await db.execute(
        insert(SyncLog.__table__).values(device_id=batch.device_id, sample_count=inserted)
    )
    await db.commit()

    return BatchResult(
        inserted=inserted,
        duplicates_skipped=original_count - inserted,
    )
