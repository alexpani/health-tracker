"""
Endpoint per HealthKit Clinical Records (FHIR).

- `POST /api/v1/clinical/batch` — ingest idempotente. `ON CONFLICT (hk_uuid)
  DO UPDATE` su `fhir_json` / `display_name` / `updated_at` per supportare
  aggiornamenti retroattivi del payload (i provider FHIR riscrivono spesso
  le risorse, es. una Observation con valore corretto post-validazione).
- `GET /api/v1/clinical?category=&resource_type=&start=&end=&limit=&offset=`
  — query paginata coi filtri standard.
- `GET /api/v1/clinical/{id}` — dettaglio singolo con il JSON FHIR completo.
- `GET /api/v1/clinical/facets` — counts per categoria + sorgente + anno
  per la sidebar dei filtri dashboard.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.clinical import ClinicalRecord

router = APIRouter(prefix="/api/v1/clinical", tags=["clinical"])


class ClinicalRecordIn(BaseModel):
    hk_uuid: str = Field(..., min_length=1, max_length=64)
    category: str = Field(..., min_length=1, max_length=80)
    resource_type: str | None = Field(default=None, max_length=60)
    source_name: str | None = Field(default=None, max_length=200)
    source_url: str | None = Field(default=None, max_length=500)
    display_name: str | None = None
    start_date: datetime
    fhir_json: dict


class ClinicalBatchIn(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=64)
    records: list[ClinicalRecordIn]


class ClinicalBatchOut(BaseModel):
    inserted: int
    updated: int
    total: int


class ClinicalRecordOut(BaseModel):
    id: int
    hk_uuid: str
    category: str
    resource_type: str | None
    source_name: str | None
    source_url: str | None
    display_name: str | None
    start_date: datetime
    created_at: datetime
    updated_at: datetime


class ClinicalRecordDetailOut(ClinicalRecordOut):
    fhir_json: dict


@router.post("/batch", response_model=ClinicalBatchOut)
async def ingest_batch(payload: ClinicalBatchIn, db: AsyncSession = Depends(get_db)):
    """Upsert idempotente su `hk_uuid`. Aggiorna `fhir_json`/`display_name`
    se la risorsa cambia lato provider (capita).
    """
    if not payload.records:
        return ClinicalBatchOut(inserted=0, updated=0, total=0)

    # Per il count inserted vs updated, prima conto quali hk_uuid esistono.
    incoming_uuids = [r.hk_uuid for r in payload.records]
    result = await db.execute(
        select(ClinicalRecord.hk_uuid).where(ClinicalRecord.hk_uuid.in_(incoming_uuids))
    )
    existing = set(result.scalars().all())

    now = datetime.now(timezone.utc)
    values = [
        {
            "hk_uuid": r.hk_uuid,
            "category": r.category,
            "resource_type": r.resource_type,
            "source_name": r.source_name,
            "source_url": r.source_url,
            "display_name": r.display_name,
            "start_date": r.start_date,
            "fhir_json": r.fhir_json,
            "created_at": now,
            "updated_at": now,
        }
        for r in payload.records
    ]

    stmt = pg_insert(ClinicalRecord.__table__).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["hk_uuid"],
        set_={
            "category": stmt.excluded.category,
            "resource_type": stmt.excluded.resource_type,
            "source_name": stmt.excluded.source_name,
            "source_url": stmt.excluded.source_url,
            "display_name": stmt.excluded.display_name,
            "fhir_json": stmt.excluded.fhir_json,
            "updated_at": now,
        },
    )
    await db.execute(stmt)
    await db.commit()

    updated = len(existing)
    inserted = len(payload.records) - updated
    return ClinicalBatchOut(inserted=inserted, updated=updated, total=len(payload.records))


@router.get("", response_model=list[ClinicalRecordOut])
async def list_records(
    category: str | None = Query(default=None),
    resource_type: str | None = Query(default=None),
    source_name: str | None = Query(default=None),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    limit: int = Query(default=100, le=1000),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ClinicalRecord)
    if category:
        stmt = stmt.where(ClinicalRecord.category == category)
    if resource_type:
        stmt = stmt.where(ClinicalRecord.resource_type == resource_type)
    if source_name:
        stmt = stmt.where(ClinicalRecord.source_name == source_name)
    if start:
        stmt = stmt.where(ClinicalRecord.start_date >= start)
    if end:
        stmt = stmt.where(ClinicalRecord.start_date <= end)
    stmt = stmt.order_by(ClinicalRecord.start_date.desc()).limit(limit).offset(offset)

    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [
        ClinicalRecordOut(
            id=r.id,
            hk_uuid=r.hk_uuid,
            category=r.category,
            resource_type=r.resource_type,
            source_name=r.source_name,
            source_url=r.source_url,
            display_name=r.display_name,
            start_date=r.start_date,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.get("/facets")
async def facets(db: AsyncSession = Depends(get_db)):
    """Counts per categoria, resource_type, source_name, anno. Per la
    sidebar dei filtri dashboard."""
    cat_q = await db.execute(
        select(ClinicalRecord.category, func.count())
        .group_by(ClinicalRecord.category)
        .order_by(func.count().desc())
    )
    rtype_q = await db.execute(
        select(ClinicalRecord.resource_type, func.count())
        .group_by(ClinicalRecord.resource_type)
        .order_by(func.count().desc())
    )
    src_q = await db.execute(
        select(ClinicalRecord.source_name, func.count())
        .group_by(ClinicalRecord.source_name)
        .order_by(func.count().desc())
    )
    year_q = await db.execute(
        select(
            func.extract("year", ClinicalRecord.start_date).label("year"),
            func.count(),
        )
        .group_by("year")
        .order_by("year")
    )
    return {
        "categories": [{"value": v, "count": c} for v, c in cat_q.all() if v],
        "resource_types": [{"value": v, "count": c} for v, c in rtype_q.all() if v],
        "sources": [{"value": v, "count": c} for v, c in src_q.all() if v],
        "years": [{"value": int(v), "count": c} for v, c in year_q.all() if v is not None],
    }


@router.get("/{record_id}", response_model=ClinicalRecordDetailOut)
async def get_record(record_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ClinicalRecord).where(ClinicalRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="record not found")
    return ClinicalRecordDetailOut(
        id=record.id,
        hk_uuid=record.hk_uuid,
        category=record.category,
        resource_type=record.resource_type,
        source_name=record.source_name,
        source_url=record.source_url,
        display_name=record.display_name,
        start_date=record.start_date,
        created_at=record.created_at,
        updated_at=record.updated_at,
        fhir_json=record.fhir_json,
    )
