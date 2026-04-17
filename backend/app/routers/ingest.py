from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CategorySample, HealthSample, SyncLog, Workout
from app.schemas import BatchResult, CategoryBatchIn, SampleBatchIn, WorkoutBatchIn

router = APIRouter(prefix="/api/v1", tags=["ingest"])

# Validation filters: samples outside these ranges are silently discarded.
# Format: type_identifier -> (min_value, max_value)  inclusive.
# Types not listed here are accepted without filtering.
SAMPLE_FILTERS: dict[str, tuple[float, float]] = {
    # Body
    "HKQuantityTypeIdentifierBodyMass": (70, 200),           # kg
    "HKQuantityTypeIdentifierBodyMassIndex": (18, 50),
    "HKQuantityTypeIdentifierBodyFatPercentage": (0.01, 0.60),  # 1%-60% (stored as 0-1 fraction)
    "HKQuantityTypeIdentifierLeanBodyMass": (45, 150),       # kg
}


def _filter_samples(samples: list) -> list:
    """Remove samples that fall outside configured validation ranges."""
    filtered = []
    for s in samples:
        bounds = SAMPLE_FILTERS.get(s.type)
        if bounds is not None:
            min_val, max_val = bounds
            if s.value < min_val or s.value > max_val:
                continue  # silently discard
        filtered.append(s)
    return filtered


@router.post("/samples/batch", response_model=BatchResult)
async def ingest_samples(batch: SampleBatchIn, db: AsyncSession = Depends(get_db)):
    if not batch.samples:
        return BatchResult(inserted=0, duplicates_skipped=0)

    accepted = _filter_samples(batch.samples)
    filtered_out = len(batch.samples) - len(accepted)

    if not accepted:
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
        }
        for w in batch.workouts
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
        duplicates_skipped=len(batch.workouts) - inserted,
    )
