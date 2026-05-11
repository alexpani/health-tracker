"""Journal router.

Voce diario giornaliera (rich text + tag). Una sola entry per data.
L'HTML in input viene sanitizzato server-side (whitelist tag); il plain
text estratto viene salvato in `content_text` per la ricerca ILIKE.
"""
from __future__ import annotations

from datetime import date as date_cls

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import JournalEntry
from app.schemas import JournalEntryIn, JournalEntryOut, JournalEntryPatch
from app.services.journal_sanitize import normalize_tags, sanitize_journal_html

router = APIRouter(prefix="/api/v1/journal", tags=["journal"])


def _sanitize_or_400(raw_html: str) -> tuple[str, str]:
    try:
        return sanitize_journal_html(raw_html)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("", response_model=JournalEntryOut, status_code=201)
async def upsert_journal_entry(payload: JournalEntryIn, db: AsyncSession = Depends(get_db)):
    """Upsert per data: una sola entry esiste per giorno. Se gia' presente,
    aggiorna content_html / content_text / tags."""
    html_clean, plain = _sanitize_or_400(payload.content_html)
    tags = normalize_tags(payload.tags)

    stmt = (
        pg_insert(JournalEntry)
        .values(
            date=payload.date,
            content_html=html_clean,
            content_text=plain,
            tags=tags,
        )
        .on_conflict_do_update(
            index_elements=["date"],
            set_={
                "content_html": html_clean,
                "content_text": plain,
                "tags": tags,
                "updated_at": func.now(),
            },
        )
        .returning(JournalEntry)
    )
    res = await db.execute(stmt)
    await db.commit()
    row = res.scalar_one()
    await db.refresh(row)
    return row


@router.get("/days", response_model=list[date_cls])
async def list_days_with_entries(
    start: date_cls = Query(...),
    end: date_cls = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Lista di date che hanno almeno una voce diario nel range, per il
    pallino del mini-calendario."""
    if end < start:
        raise HTTPException(status_code=400, detail="end < start")
    stmt = (
        select(JournalEntry.date)
        .where(JournalEntry.date >= start, JournalEntry.date <= end)
        .order_by(JournalEntry.date)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return list(rows)


@router.get("/tags", response_model=list[str])
async def list_tags(db: AsyncSession = Depends(get_db)):
    """Tag distinti gia' usati, ordinati per frequenza desc. Usato dal
    componente TagInput per l'autocomplete."""
    # Esplosione dell'array JSONB via jsonb_array_elements_text in raw SQL.
    sql = text(
        """
        SELECT tag, COUNT(*) AS c
        FROM journal_entries, jsonb_array_elements_text(tags) AS tag
        GROUP BY tag
        ORDER BY c DESC, tag ASC
        """
    )
    rows = (await db.execute(sql)).all()
    return [r[0] for r in rows]


@router.get("", response_model=list[JournalEntryOut])
async def list_journal_entries(
    start: date_cls | None = Query(None),
    end: date_cls | None = Query(None),
    tag: str | None = Query(None),
    text_contains: str | None = Query(None),
    limit: int = Query(200, le=1000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(JournalEntry)
    if start is not None:
        stmt = stmt.where(JournalEntry.date >= start)
    if end is not None:
        stmt = stmt.where(JournalEntry.date <= end)
    if tag:
        norm = tag.strip().lower()
        # JSONB contains [norm]
        stmt = stmt.where(JournalEntry.tags.op("@>")([norm]))
    if text_contains:
        stmt = stmt.where(JournalEntry.content_text.ilike(f"%{text_contains}%"))

    stmt = stmt.order_by(JournalEntry.date.desc(), JournalEntry.id.desc()).offset(offset).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/by-date/{day_str}", response_model=JournalEntryOut)
async def get_by_date(day_str: str, db: AsyncSession = Depends(get_db)):
    try:
        d = date_cls.fromisoformat(day_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date, expected YYYY-MM-DD")
    row = (
        await db.execute(select(JournalEntry).where(JournalEntry.date == d))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


@router.get("/{entry_id}", response_model=JournalEntryOut)
async def get_journal_entry(entry_id: int, db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(select(JournalEntry).where(JournalEntry.id == entry_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


@router.patch("/{entry_id}", response_model=JournalEntryOut)
async def update_journal_entry(
    entry_id: int,
    patch: JournalEntryPatch,
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(select(JournalEntry).where(JournalEntry.id == entry_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")

    data = patch.model_dump(exclude_unset=True)
    if "content_html" in data and data["content_html"] is not None:
        html_clean, plain = _sanitize_or_400(data["content_html"])
        row.content_html = html_clean
        row.content_text = plain
    if "tags" in data:
        row.tags = normalize_tags(data["tags"])

    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{entry_id}")
async def delete_journal_entry(entry_id: int, db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(select(JournalEntry).where(JournalEntry.id == entry_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True, "id": entry_id}
