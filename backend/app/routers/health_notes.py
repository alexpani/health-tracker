"""Health notes router.

Note quotidiane di salute (dolori, malattie, fastidi, sintomi) con
periodo chiuso obbligatorio (start_date e end_date entrambi NOT NULL).
"""
from datetime import date as date_cls

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import HealthNote
from app.schemas import HealthNoteIn, HealthNoteOut, HealthNotePatch

router = APIRouter(prefix="/api/v1/health-notes", tags=["health-notes"])

ALLOWED_CATEGORIES = {"pain", "illness", "discomfort", "symptom", "other"}


def _validate_category(category: str) -> None:
    if category not in ALLOWED_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"category must be one of {sorted(ALLOWED_CATEGORIES)}, got '{category}'",
        )


@router.post("", response_model=HealthNoteOut, status_code=201)
async def create_health_note(payload: HealthNoteIn, db: AsyncSession = Depends(get_db)):
    _validate_category(payload.category)
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="text cannot be empty")
    end_date = payload.end_date or payload.start_date
    if end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="end_date < start_date")

    row = HealthNote(
        category=payload.category,
        body_zone=payload.body_zone.strip() if payload.body_zone else None,
        text=payload.text.strip(),
        start_date=payload.start_date,
        end_date=end_date,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/days", response_model=list[date_cls])
async def list_days_with_notes(
    start: date_cls = Query(...),
    end: date_cls = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Lista di date (ISO) coperte da almeno una nota nel range [start, end].
    Usato dal mini-calendario per disegnare i pallini.
    """
    if end < start:
        raise HTTPException(status_code=400, detail="end < start")

    # Espandi i periodi: una nota dal 3 al 7 copre i giorni 3,4,5,6,7.
    # Per semplicita': pulliamo le note che si sovrappongono al range,
    # poi espandiamo client-side (qui in Python). Volume basso (< qualche
    # centinaia di note tipicamente).
    stmt = select(HealthNote.start_date, HealthNote.end_date).where(
        and_(HealthNote.start_date <= end, HealthNote.end_date >= start)
    )
    rows = (await db.execute(stmt)).all()

    days: set[date_cls] = set()
    from datetime import timedelta as _td
    for s, e in rows:
        cursor = max(s, start)
        last = min(e, end)
        while cursor <= last:
            days.add(cursor)
            cursor = cursor + _td(days=1)
    return sorted(days)


@router.get("", response_model=list[HealthNoteOut])
async def list_health_notes(
    category: str | None = Query(None),
    body_zone: str | None = Query(None),
    text_contains: str | None = Query(None),
    start: date_cls | None = Query(None),
    end: date_cls | None = Query(None),
    active_on: date_cls | None = Query(None, description="YYYY-MM-DD"),
    limit: int = Query(500, le=2000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(HealthNote)
    if category:
        _validate_category(category)
        stmt = stmt.where(HealthNote.category == category)
    if body_zone:
        stmt = stmt.where(HealthNote.body_zone.ilike(f"%{body_zone}%"))
    if text_contains:
        stmt = stmt.where(HealthNote.text.ilike(f"%{text_contains}%"))
    if active_on is not None:
        stmt = stmt.where(
            and_(HealthNote.start_date <= active_on, HealthNote.end_date >= active_on)
        )
    else:
        # Range che si sovrappone con [start, end]
        if start is not None:
            stmt = stmt.where(HealthNote.end_date >= start)
        if end is not None:
            stmt = stmt.where(HealthNote.start_date <= end)

    stmt = stmt.order_by(
        HealthNote.start_date.desc(),
        HealthNote.id.desc(),
    ).offset(offset).limit(limit)

    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/zones", response_model=list[str])
async def list_distinct_zones(db: AsyncSession = Depends(get_db)):
    """Lista delle zone corporee distinte usate nelle note esistenti.
    Usata dalla pagina /health-notes per popolare i chip di filtro."""
    stmt = (
        select(HealthNote.body_zone)
        .where(HealthNote.body_zone.is_not(None))
        .distinct()
        .order_by(HealthNote.body_zone)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [r for r in rows if r]


@router.get("/{note_id}", response_model=HealthNoteOut)
async def get_health_note(note_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(HealthNote).where(HealthNote.id == note_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


@router.patch("/{note_id}", response_model=HealthNoteOut)
async def update_health_note(
    note_id: int,
    patch: HealthNotePatch,
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(HealthNote).where(HealthNote.id == note_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")

    data = patch.model_dump(exclude_unset=True)
    if "category" in data and data["category"] is not None:
        _validate_category(data["category"])
    if "text" in data:
        if data["text"] is None or not str(data["text"]).strip():
            raise HTTPException(status_code=400, detail="text cannot be empty")
        data["text"] = data["text"].strip()
    if "body_zone" in data and data["body_zone"]:
        data["body_zone"] = data["body_zone"].strip()

    new_start = data.get("start_date", row.start_date)
    new_end = data.get("end_date", row.end_date)
    if new_start is not None and new_end is not None and new_end < new_start:
        raise HTTPException(status_code=400, detail="end_date < start_date")

    for k, v in data.items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{note_id}")
async def delete_health_note(note_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(HealthNote).where(HealthNote.id == note_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True, "id": note_id}
