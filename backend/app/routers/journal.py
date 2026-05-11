"""Journal router.

Voce diario (rich text + tag). N voci per giorno: la `date` e' editabile
e puoi spostare una nota da un giorno all'altro. L'HTML in input viene
sanitizzato server-side (whitelist tag); il plain text estratto viene
salvato in `content_text` per la ricerca (ILIKE / FTS italiano).
"""
from __future__ import annotations

from datetime import date as date_cls

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import JournalEntry
from pydantic import BaseModel

from app.schemas import JournalEntryIn, JournalEntryOut, JournalEntryPatch
from app.services.journal_sanitize import normalize_tags, sanitize_journal_html


class JournalBulkIn(BaseModel):
    ids: list[int]
    action: str  # "delete" | "add_tag" | "remove_tag"
    tag: str | None = None


class JournalTagRenameIn(BaseModel):
    old: str
    new: str | None  # None = elimina il tag da tutte le voci

router = APIRouter(prefix="/api/v1/journal", tags=["journal"])


def _sanitize_or_400(raw_html: str) -> tuple[str, str]:
    try:
        return sanitize_journal_html(raw_html)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("", response_model=JournalEntryOut, status_code=201)
async def create_journal_entry(payload: JournalEntryIn, db: AsyncSession = Depends(get_db)):
    """Crea una nuova voce per `payload.date`. Un giorno puo' avere N voci."""
    html_clean, plain = _sanitize_or_400(payload.content_html)
    tags = normalize_tags(payload.tags)

    row = JournalEntry(
        date=payload.date,
        content_html=html_clean,
        content_text=plain,
        tags=tags,
    )
    db.add(row)
    await db.commit()
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
        q = text_contains.strip()
        # Single word senza spazi / quote → ILIKE (matching substring,
        # rapido su query corte).
        # Altrimenti FTS italiano via websearch_to_tsquery (multi-word
        # AND, supporta "phrase" e -negation).
        if any(c.isspace() or c == '"' for c in q):
            stmt = stmt.where(
                text("search_tsv @@ websearch_to_tsquery('italian', :q)").bindparams(q=q)
            )
        else:
            stmt = stmt.where(JournalEntry.content_text.ilike(f"%{q}%"))

    stmt = stmt.order_by(JournalEntry.date.desc(), JournalEntry.id.desc()).offset(offset).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/by-date/{day_str}", response_model=list[JournalEntryOut])
async def get_by_date(day_str: str, db: AsyncSession = Depends(get_db)):
    """Lista (anche vuota) delle voci per quel giorno, ordinate per
    `created_at` ascendente."""
    try:
        d = date_cls.fromisoformat(day_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date, expected YYYY-MM-DD")
    rows = (
        await db.execute(
            select(JournalEntry)
            .where(JournalEntry.date == d)
            .order_by(JournalEntry.created_at.asc(), JournalEntry.id.asc())
        )
    ).scalars().all()
    return list(rows)


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
    if "date" in data and data["date"] is not None:
        row.date = data["date"]

    await db.commit()
    await db.refresh(row)
    return row


@router.post("/bulk")
async def bulk_journal(payload: JournalBulkIn, db: AsyncSession = Depends(get_db)):
    """Azione in massa su un set di voci.

    Actions:
      - `delete`: elimina tutte le voci negli `ids`.
      - `add_tag` / `remove_tag`: aggiunge/rimuove il tag normalizzato
        su tutte le voci. Idempotente (no-op se gia' presente/assente).
    """
    if not payload.ids:
        return {"updated": 0, "deleted": 0}

    action = payload.action
    if action == "delete":
        res = await db.execute(
            JournalEntry.__table__.delete().where(JournalEntry.id.in_(payload.ids))
        )
        await db.commit()
        return {"deleted": res.rowcount or 0}

    if action not in {"add_tag", "remove_tag"}:
        raise HTTPException(status_code=400, detail=f"unknown action {action}")
    if not payload.tag:
        raise HTTPException(status_code=400, detail="tag richiesto per add_tag/remove_tag")
    norm_tags = normalize_tags([payload.tag])
    if not norm_tags:
        raise HTTPException(status_code=400, detail="tag non valido dopo normalizzazione")
    tag = norm_tags[0]

    rows = (
        await db.execute(select(JournalEntry).where(JournalEntry.id.in_(payload.ids)))
    ).scalars().all()
    updated = 0
    for row in rows:
        cur = list(row.tags or [])
        if action == "add_tag":
            if tag not in cur:
                cur.append(tag)
                row.tags = cur
                updated += 1
        else:  # remove_tag
            if tag in cur:
                cur = [t for t in cur if t != tag]
                row.tags = cur
                updated += 1
    await db.commit()
    return {"updated": updated}


@router.post("/tags/rename")
async def rename_tag(payload: JournalTagRenameIn, db: AsyncSession = Depends(get_db)):
    """Rinomina o elimina un tag su tutte le voci che lo contengono.

    - `{old, new}` → sostituisce `old` con `new` (con normalizzazione e
      dedup).
    - `{old, new: null}` → rimuove `old` da tutte le voci.
    """
    old_norm = normalize_tags([payload.old])
    if not old_norm:
        raise HTTPException(status_code=400, detail="tag sorgente non valido")
    old = old_norm[0]

    new: str | None = None
    if payload.new is not None:
        new_norm = normalize_tags([payload.new])
        if not new_norm:
            raise HTTPException(status_code=400, detail="tag destinazione non valido")
        new = new_norm[0]

    rows = (
        await db.execute(
            select(JournalEntry).where(JournalEntry.tags.op("@>")([old]))
        )
    ).scalars().all()
    updated = 0
    for row in rows:
        cur = list(row.tags or [])
        if old not in cur:
            continue
        cur = [t for t in cur if t != old]
        if new is not None and new not in cur:
            cur.append(new)
        row.tags = cur
        updated += 1
    await db.commit()
    return {"updated": updated, "old": old, "new": new}


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
