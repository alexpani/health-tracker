"""Router del dominio Lab Results.

PR #2a: endpoint di ingest, lista/dettaglio panel, stream documento, catalogo
read-only. La conferma di un panel, l'editing dei result e il CRUD alias/analita
arriveranno in PR #2b.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.lab import (
    LabAnalyte,
    LabDocument,
    LabPanel,
    LabResult,
)
from app.services import lab_ingest

router = APIRouter(prefix="/api/v1/lab", tags=["lab"])


# ---------------------------------------------------------------------------
# POST /ingest
# ---------------------------------------------------------------------------

@router.post("/ingest")
async def ingest_referto(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Upload di un PDF referto. Crea `lab_document`, `lab_panel` in draft
    + `lab_results` (con matching alias). Ritorna summary per la review UI."""
    data = await file.read()
    if not data:
        raise HTTPException(400, "file vuoto")

    # 1) Save + dedup by sha256
    sha = lab_ingest.compute_sha256(data)
    existing_doc = (await db.execute(
        select(LabDocument).where(LabDocument.sha256 == sha)
    )).scalar_one_or_none()
    if existing_doc is not None:
        # Documento già caricato: se ha già un panel draft/confirmed, lo rimandiamo.
        existing_panel = (await db.execute(
            select(LabPanel).where(LabPanel.document_id == existing_doc.id)
            .order_by(LabPanel.id.desc()).limit(1)
        )).scalar_one_or_none()
        if existing_panel is not None:
            return {
                "panel_id": existing_panel.id,
                "status": existing_panel.status,
                "message": "documento già caricato",
                "deduplicated": True,
            }

    full_path, rel_path, size = lab_ingest.save_document(
        data, original_filename=file.filename or "referto.pdf"
    )

    if existing_doc is None:
        doc = LabDocument(
            relative_path=rel_path,
            sha256=sha,
            mime_type=file.content_type or "application/pdf",
            size_bytes=size,
        )
        db.add(doc)
        await db.flush()
    else:
        doc = existing_doc

    # 2) Extract PDF text
    try:
        raw_text = lab_ingest.extract_text_from_pdf(full_path)
    except Exception as exc:
        raise HTTPException(422, f"impossibile estrarre testo dal PDF: {exc}")

    # 3) LLM parse — in caso di errore creiamo un panel vuoto con notes=parsing_failed
    parsing_failed = False
    extracted: lab_ingest.ExtractedPanel | None = None
    try:
        payload = lab_ingest.call_llm(raw_text)
        extracted = lab_ingest.parse_extracted_panel(payload)
    except Exception:
        parsing_failed = True

    # 4) Create panel + results
    panel_kwargs: dict[str, Any] = {
        "document_id": doc.id,
        "status": "draft",
    }
    if parsing_failed or extracted is None:
        panel_kwargs["test_date"] = __import__("datetime").date.today()
        panel_kwargs["notes"] = "parsing_failed"
        panel_kwargs["specimen_types"] = []
        matched = []
    else:
        panel_kwargs["test_date"] = (
            extracted.test_date or __import__("datetime").date.today()
        )
        panel_kwargs["lab_name"] = extracted.lab_name
        panel_kwargs["specimen_types"] = extracted.specimen_types
        matched = await lab_ingest.build_matched_results(db, extracted.analytes)

    panel = LabPanel(**panel_kwargs)
    db.add(panel)
    await db.flush()

    for m in matched:
        db.add(LabResult(
            panel_id=panel.id,
            analyte_id=m.analyte_id,
            raw_name=m.raw_name,
            value_numeric=m.value_numeric,
            value_text=m.value_text,
            unit_raw=m.unit_raw,
            ref_low_raw=m.ref_low_raw,
            ref_high_raw=m.ref_high_raw,
            ref_text_raw=m.ref_text_raw,
            needs_review=True,
        ))

    await db.commit()
    await db.refresh(panel)

    return {
        "panel_id": panel.id,
        "status": panel.status,
        "test_date": panel.test_date.isoformat() if panel.test_date else None,
        "lab_name": panel.lab_name,
        "specimen_types": panel.specimen_types,
        "analytes_count": len(matched),
        "unmatched_count": sum(1 for m in matched if m.analyte_id is None),
        "parsing_failed": parsing_failed,
        "document_id": doc.id,
    }


# ---------------------------------------------------------------------------
# GET /panels (list)
# ---------------------------------------------------------------------------

@router.get("/panels")
async def list_panels(
    status: str | None = Query(None, pattern="^(draft|confirmed)$"),
    year: int | None = None,
    specimen: str | None = Query(None, pattern="^(blood|urine)$"),
    lab_name: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    stmt = select(LabPanel)
    count_stmt = select(func.count()).select_from(LabPanel)
    if status:
        stmt = stmt.where(LabPanel.status == status)
        count_stmt = count_stmt.where(LabPanel.status == status)
    if year is not None:
        stmt = stmt.where(func.extract("year", LabPanel.test_date) == year)
        count_stmt = count_stmt.where(func.extract("year", LabPanel.test_date) == year)
    if specimen:
        stmt = stmt.where(LabPanel.specimen_types.any(specimen))
        count_stmt = count_stmt.where(LabPanel.specimen_types.any(specimen))
    if lab_name:
        stmt = stmt.where(LabPanel.lab_name.ilike(f"%{lab_name}%"))
        count_stmt = count_stmt.where(LabPanel.lab_name.ilike(f"%{lab_name}%"))

    total = (await db.execute(count_stmt)).scalar_one()
    stmt = stmt.order_by(LabPanel.test_date.desc(), LabPanel.id.desc()).offset(offset).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [
            {
                "id": p.id,
                "test_date": p.test_date.isoformat(),
                "lab_name": p.lab_name,
                "specimen_types": p.specimen_types,
                "status": p.status,
                "notes": p.notes,
                "document_id": p.document_id,
                "confirmed_at": p.confirmed_at.isoformat() if p.confirmed_at else None,
            }
            for p in rows
        ],
    }


# ---------------------------------------------------------------------------
# GET /panels/{id}
# ---------------------------------------------------------------------------

@router.get("/panels/{panel_id}")
async def get_panel(
    panel_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    panel = (await db.execute(
        select(LabPanel).where(LabPanel.id == panel_id)
    )).scalar_one_or_none()
    if panel is None:
        raise HTTPException(404, "panel non trovato")

    results = (await db.execute(
        select(LabResult).where(LabResult.panel_id == panel_id).order_by(LabResult.id)
    )).scalars().all()

    return {
        "id": panel.id,
        "test_date": panel.test_date.isoformat(),
        "lab_name": panel.lab_name,
        "specimen_types": panel.specimen_types,
        "status": panel.status,
        "notes": panel.notes,
        "document_id": panel.document_id,
        "confirmed_at": panel.confirmed_at.isoformat() if panel.confirmed_at else None,
        "results": [
            {
                "id": r.id,
                "analyte_id": r.analyte_id,
                "raw_name": r.raw_name,
                "value_numeric": (
                    float(r.value_numeric) if r.value_numeric is not None else None
                ),
                "value_text": r.value_text,
                "unit_raw": r.unit_raw,
                "unit_normalized": r.unit_normalized,
                "ref_low_raw": (
                    float(r.ref_low_raw) if r.ref_low_raw is not None else None
                ),
                "ref_high_raw": (
                    float(r.ref_high_raw) if r.ref_high_raw is not None else None
                ),
                "ref_text_raw": r.ref_text_raw,
                "out_of_range": r.out_of_range,
                "needs_review": r.needs_review,
                "notes": r.notes,
            }
            for r in results
        ],
    }


# ---------------------------------------------------------------------------
# GET /documents/{id}/file
# ---------------------------------------------------------------------------

@router.get("/documents/{doc_id}/file")
async def get_document_file(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    doc = (await db.execute(
        select(LabDocument).where(LabDocument.id == doc_id)
    )).scalar_one_or_none()
    if doc is None:
        raise HTTPException(404, "documento non trovato")
    full_path: Path = settings.lab_documents_dir / doc.relative_path
    if not full_path.exists():
        raise HTTPException(410, "file non disponibile su disco")
    return FileResponse(
        path=str(full_path),
        media_type=doc.mime_type,
        filename=doc.relative_path,
    )


# ---------------------------------------------------------------------------
# GET /analytes (catalogo read-only)
# ---------------------------------------------------------------------------

@router.get("/analytes")
async def list_analytes(
    specimen: str | None = Query(None, pattern="^(blood|urine|other)$"),
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    stmt = select(LabAnalyte).order_by(LabAnalyte.category, LabAnalyte.display_name_it)
    if specimen:
        stmt = stmt.where(LabAnalyte.specimen == specimen)
    if category:
        stmt = stmt.where(LabAnalyte.category == category)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": a.id,
            "slug": a.slug,
            "display_name_it": a.display_name_it,
            "category": a.category,
            "specimen": a.specimen,
            "value_type": a.value_type,
            "unit_canonical": a.unit_canonical,
            "ref_low": float(a.ref_low) if a.ref_low is not None else None,
            "ref_high": float(a.ref_high) if a.ref_high is not None else None,
            "ref_text": a.ref_text,
        }
        for a in rows
    ]
