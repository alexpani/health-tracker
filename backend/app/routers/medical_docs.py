"""Router del dominio Medical Docs.

Tre archivi documentali (`visit` / `imaging` / `document`) con lo stesso
meccanismo: upload PDF, analisi IA per i metadati, revisione manuale,
ricerca full-text + filtri. Niente HealthKit / iOS — feature solo dashboard.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import anyio
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session, get_db
from app.models.medical_docs import (
    MedicalDocCategory,
    MedicalDocFile,
    MedicalDocument,
)
from app.services import medical_docs_ingest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/medical-docs", tags=["medical-docs"])

VALID_SECTIONS = {"visit", "imaging", "document"}
_SECTION_RE = "^(visit|imaging|document)$"


def _serialize_doc(d: MedicalDocument) -> dict[str, Any]:
    return {
        "id": d.id,
        "section": d.section,
        "category_id": d.category_id,
        "file_id": d.file_id,
        "title": d.title,
        "doc_date": d.doc_date.isoformat() if d.doc_date else None,
        "facility_name": d.facility_name,
        "doctor_name": d.doctor_name,
        "status": d.status,
        "notes": d.notes,
        "parsing_failed": d.parsing_failed,
        "analysis_status": d.analysis_status,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


# ---------------------------------------------------------------------------
# POST /ingest
# ---------------------------------------------------------------------------

@router.post("/ingest")
async def ingest_document(
    background_tasks: BackgroundTasks,
    section: str = Query(..., pattern=_SECTION_RE),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Upload di un PDF. Dedup per sha256: se lo stesso PDF e' gia' presente
    nella stessa sezione ritorna il documento esistente. Il documento viene
    creato subito in `draft` con `analysis_status='pending'` e ritornato;
    l'estrazione testo + analisi IA girano in background (non bloccano la
    risposta) e popolano i metadati in un secondo momento."""
    data = await file.read()
    if not data:
        raise HTTPException(400, "file vuoto")

    sha = medical_docs_ingest.compute_sha256(data)

    # Dedup: se questo file esiste gia' con un documento nella stessa sezione.
    existing_file = (await db.execute(
        select(MedicalDocFile).where(MedicalDocFile.sha256 == sha)
    )).scalar_one_or_none()
    if existing_file is not None:
        existing_doc = (await db.execute(
            select(MedicalDocument)
            .where(
                MedicalDocument.file_id == existing_file.id,
                MedicalDocument.section == section,
            )
            .order_by(MedicalDocument.id.desc())
            .limit(1)
        )).scalar_one_or_none()
        if existing_doc is not None:
            return {**_serialize_doc(existing_doc), "deduplicated": True}

    _full_path, rel_path, size = medical_docs_ingest.save_document(
        data, original_filename=file.filename or "documento.pdf"
    )
    if existing_file is None:
        doc_file = MedicalDocFile(
            relative_path=rel_path,
            sha256=sha,
            mime_type=file.content_type or "application/pdf",
            size_bytes=size,
        )
        db.add(doc_file)
        await db.flush()
    else:
        doc_file = existing_file

    doc = MedicalDocument(
        section=section,
        file_id=doc_file.id,
        status="draft",
        analysis_status="pending",
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    # Analisi IA differita: non blocca la risposta HTTP.
    background_tasks.add_task(_analyze_document, doc.id, data, section)
    return _serialize_doc(doc)


async def _analyze_document(doc_id: int, data: bytes, section: str) -> None:
    """Estrazione testo (pdfplumber) + analisi IA (Anthropic) in background.
    Le parti bloccanti girano in un thread per non bloccare l'event loop."""
    async with async_session() as db:
        doc = (await db.execute(
            select(MedicalDocument).where(MedicalDocument.id == doc_id)
        )).scalar_one_or_none()
        if doc is None:
            return
        try:
            content_text = await anyio.to_thread.run_sync(
                medical_docs_ingest.extract_text, data
            )
            # PDF scansionato (niente layer di testo) → OCR: genera un PDF
            # cercabile e sostituisce il file su disco.
            if not medical_docs_ingest.is_searchable(content_text):
                ocr_bytes = await anyio.to_thread.run_sync(
                    medical_docs_ingest.ocr_pdf, data
                )
                if ocr_bytes:
                    doc_file = (await db.execute(
                        select(MedicalDocFile)
                        .where(MedicalDocFile.id == doc.file_id)
                    )).scalar_one_or_none()
                    if doc_file is not None:
                        path = settings.medical_documents_dir / doc_file.relative_path
                        path.write_bytes(ocr_bytes)
                        doc_file.size_bytes = len(ocr_bytes)
                    data = ocr_bytes
                    content_text = await anyio.to_thread.run_sync(
                        medical_docs_ingest.extract_text, data
                    )
            cat_rows = (await db.execute(
                select(MedicalDocCategory)
                .where(MedicalDocCategory.section == section)
            )).scalars().all()
            cat_names = [c.name for c in cat_rows]
            cat_by_lower = {c.name.lower(): c.id for c in cat_rows}

            # Per le Visite chiediamo anche un riassunto dei contenuti salienti,
            # con cui popoliamo le note SOLO se l'utente non le ha gia' scritte.
            want_summary = section == "visit"
            payload = await anyio.to_thread.run_sync(
                medical_docs_ingest.call_llm, data, section, cat_names, want_summary
            )
            meta = medical_docs_ingest.parse_extracted_meta(payload)

            doc.content_text = content_text or None
            doc.title = meta.title
            doc.doc_date = meta.doc_date
            doc.facility_name = meta.facility_name
            doc.doctor_name = meta.doctor_name
            if meta.suggested_category:
                doc.category_id = cat_by_lower.get(meta.suggested_category.lower())
            if want_summary and meta.summary and not (doc.notes and doc.notes.strip()):
                doc.notes = meta.summary
            doc.parsing_failed = False
            doc.analysis_status = "done"
        except Exception:
            logger.exception("medical-docs: analisi IA fallita per doc %s", doc_id)
            doc.parsing_failed = True
            doc.analysis_status = "failed"
        await db.commit()


# ---------------------------------------------------------------------------
# GET / (lista con filtri + ricerca full-text)
# ---------------------------------------------------------------------------

@router.get("")
async def list_documents(
    section: str = Query(..., pattern=_SECTION_RE),
    category_id: int | None = None,
    status: str | None = Query(None, pattern="^(draft|confirmed)$"),
    q: str | None = None,
    start: date | None = None,
    end: date | None = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    stmt = select(MedicalDocument).where(MedicalDocument.section == section)
    count_stmt = select(func.count()).select_from(MedicalDocument).where(
        MedicalDocument.section == section
    )

    def _apply(s):
        if category_id is not None:
            s = s.where(MedicalDocument.category_id == category_id)
        if status:
            s = s.where(MedicalDocument.status == status)
        if start is not None:
            s = s.where(MedicalDocument.doc_date >= start)
        if end is not None:
            s = s.where(MedicalDocument.doc_date <= end)
        if q and q.strip():
            qs = q.strip()
            # Una sola parola → ILIKE; piu' parole/quote → FTS italiano.
            if any(c.isspace() or c == '"' for c in qs):
                s = s.where(
                    text("search_tsv @@ websearch_to_tsquery('italian', :q)")
                    .bindparams(q=qs)
                )
            else:
                like = f"%{qs}%"
                s = s.where(
                    MedicalDocument.title.ilike(like)
                    | MedicalDocument.facility_name.ilike(like)
                    | MedicalDocument.doctor_name.ilike(like)
                    | MedicalDocument.content_text.ilike(like)
                )
        return s

    stmt = _apply(stmt)
    count_stmt = _apply(count_stmt)

    total = (await db.execute(count_stmt)).scalar_one()
    stmt = (
        stmt.order_by(
            MedicalDocument.doc_date.desc().nullslast(),
            MedicalDocument.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [_serialize_doc(d) for d in rows],
    }


# ---------------------------------------------------------------------------
# Categorie (CRUD) — dichiarate prima di /{doc_id} per il routing
# ---------------------------------------------------------------------------

class CategoryIn(BaseModel):
    section: str
    name: str


class CategoryPatch(BaseModel):
    name: str


@router.get("/categories")
async def list_categories(
    section: str = Query(..., pattern=_SECTION_RE),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    rows = (await db.execute(
        select(MedicalDocCategory)
        .where(MedicalDocCategory.section == section)
        .order_by(MedicalDocCategory.name)
    )).scalars().all()
    # Conteggio documenti per categoria.
    count_rows = (await db.execute(
        select(MedicalDocument.category_id, func.count())
        .where(MedicalDocument.section == section)
        .group_by(MedicalDocument.category_id)
    )).all()
    counts = {cid: n for cid, n in count_rows}
    return [
        {"id": c.id, "section": c.section, "name": c.name,
         "doc_count": counts.get(c.id, 0)}
        for c in rows
    ]


@router.post("/categories", status_code=201)
async def create_category(
    payload: CategoryIn, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    if payload.section not in VALID_SECTIONS:
        raise HTTPException(400, "section non valida")
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "nome vuoto")
    existing = (await db.execute(
        select(MedicalDocCategory).where(
            MedicalDocCategory.section == payload.section,
            func.lower(MedicalDocCategory.name) == name.lower(),
        )
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(409, "categoria gia' esistente")
    cat = MedicalDocCategory(section=payload.section, name=name)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return {"id": cat.id, "section": cat.section, "name": cat.name, "doc_count": 0}


@router.patch("/categories/{category_id}")
async def rename_category(
    category_id: int, payload: CategoryPatch, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    cat = (await db.execute(
        select(MedicalDocCategory).where(MedicalDocCategory.id == category_id)
    )).scalar_one_or_none()
    if cat is None:
        raise HTTPException(404, "categoria non trovata")
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "nome vuoto")
    dup = (await db.execute(
        select(MedicalDocCategory).where(
            MedicalDocCategory.section == cat.section,
            func.lower(MedicalDocCategory.name) == name.lower(),
            MedicalDocCategory.id != category_id,
        )
    )).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(409, "categoria gia' esistente")
    cat.name = name
    await db.commit()
    return {"id": cat.id, "section": cat.section, "name": cat.name}


@router.delete("/categories/{category_id}")
async def delete_category(
    category_id: int, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    cat = (await db.execute(
        select(MedicalDocCategory).where(MedicalDocCategory.id == category_id)
    )).scalar_one_or_none()
    if cat is None:
        raise HTTPException(404, "categoria non trovata")
    # I documenti collegati vanno a category_id=NULL via FK ON DELETE SET NULL.
    await db.delete(cat)
    await db.commit()
    return {"ok": True, "id": category_id}


# ---------------------------------------------------------------------------
# GET /files/{file_id} — stream del PDF
# ---------------------------------------------------------------------------

@router.get("/files/{file_id}")
async def get_file(file_id: int, db: AsyncSession = Depends(get_db)):
    doc_file = (await db.execute(
        select(MedicalDocFile).where(MedicalDocFile.id == file_id)
    )).scalar_one_or_none()
    if doc_file is None:
        raise HTTPException(404, "file non trovato")
    full_path = settings.medical_documents_dir / doc_file.relative_path
    if not full_path.exists():
        raise HTTPException(404, "file mancante su disco")
    return FileResponse(
        path=str(full_path),
        media_type=doc_file.mime_type or "application/pdf",
        headers={"Content-Disposition": "inline"},
    )


# ---------------------------------------------------------------------------
# GET /{doc_id} — dettaglio
# ---------------------------------------------------------------------------

@router.get("/{doc_id}")
async def get_document(
    doc_id: int, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    doc = (await db.execute(
        select(MedicalDocument).where(MedicalDocument.id == doc_id)
    )).scalar_one_or_none()
    if doc is None:
        raise HTTPException(404, "documento non trovato")
    return _serialize_doc(doc)


# ---------------------------------------------------------------------------
# PATCH /{doc_id}
# ---------------------------------------------------------------------------

class DocumentPatch(BaseModel):
    title: str | None = None
    doc_date: date | None = None
    category_id: int | None = None
    facility_name: str | None = None
    doctor_name: str | None = None
    notes: str | None = None
    status: str | None = None


@router.patch("/{doc_id}")
async def patch_document(
    doc_id: int, patch: DocumentPatch, db: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    doc = (await db.execute(
        select(MedicalDocument).where(MedicalDocument.id == doc_id)
    )).scalar_one_or_none()
    if doc is None:
        raise HTTPException(404, "documento non trovato")

    data = patch.model_dump(exclude_unset=True)
    if "status" in data and data["status"] is not None:
        if data["status"] not in ("draft", "confirmed"):
            raise HTTPException(400, "status non valido")
    for field in ("title", "doc_date", "category_id", "facility_name",
                   "doctor_name", "notes", "status"):
        if field in data:
            setattr(doc, field, data[field])
    await db.commit()
    await db.refresh(doc)
    return _serialize_doc(doc)


# ---------------------------------------------------------------------------
# DELETE /{doc_id}
# ---------------------------------------------------------------------------

@router.delete("/{doc_id}")
async def delete_document(
    doc_id: int,
    delete_file: bool = Query(True),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    doc = (await db.execute(
        select(MedicalDocument).where(MedicalDocument.id == doc_id)
    )).scalar_one_or_none()
    if doc is None:
        raise HTTPException(404, "documento non trovato")

    file_id = doc.file_id
    await db.delete(doc)
    await db.flush()

    removed_file = False
    if delete_file and file_id is not None:
        # Cancella file + record solo se nessun altro documento lo riferisce.
        others = (await db.execute(
            select(func.count()).select_from(MedicalDocument)
            .where(MedicalDocument.file_id == file_id)
        )).scalar_one()
        if others == 0:
            doc_file = (await db.execute(
                select(MedicalDocFile).where(MedicalDocFile.id == file_id)
            )).scalar_one_or_none()
            if doc_file is not None:
                full_path = settings.medical_documents_dir / doc_file.relative_path
                try:
                    Path(full_path).unlink(missing_ok=True)
                except OSError:
                    logger.warning("medical-docs: impossibile rimuovere %s", full_path)
                await db.delete(doc_file)
                removed_file = True

    await db.commit()
    return {"ok": True, "id": doc_id, "file_removed": removed_file}
