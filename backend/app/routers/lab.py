"""Router del dominio Lab Results.

PR #2a: endpoint di ingest, lista/dettaglio panel, stream documento, catalogo
read-only. La conferma di un panel, l'editing dei result e il CRUD alias/analita
arriveranno in PR #2b.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.lab import (
    LabAnalyte,
    LabAnalyteAlias,
    LabDocument,
    LabPanel,
    LabResult,
)
from app.services import lab_ingest, lab_units

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

    # 2) LLM parse del PDF (testuale o scannerizzato: Anthropic gestisce entrambi).
    #    In caso di errore creiamo un panel vuoto con notes=parsing_failed.
    parsing_failed = False
    extracted: lab_ingest.ExtractedPanel | None = None
    try:
        payload = lab_ingest.call_llm(data)
        extracted = lab_ingest.parse_extracted_panel(payload)
    except Exception:
        logger.exception("lab/ingest: LLM parsing failed")
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

    panel_ids = [p.id for p in rows]
    unmapped_by_panel: dict[int, int] = {pid: 0 for pid in panel_ids}
    total_by_panel: dict[int, int] = {pid: 0 for pid in panel_ids}
    if panel_ids:
        agg_rows = (await db.execute(
            select(
                LabResult.panel_id,
                func.count().label("total"),
                func.count().filter(LabResult.analyte_id.is_(None)).label("unmapped"),
            )
            .where(LabResult.panel_id.in_(panel_ids))
            .group_by(LabResult.panel_id)
        )).all()
        for pid, tot, unm in agg_rows:
            total_by_panel[pid] = tot
            unmapped_by_panel[pid] = unm

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
                "results_count": total_by_panel.get(p.id, 0),
                "unmapped_count": unmapped_by_panel.get(p.id, 0),
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
    analyte_ids = [a.id for a in rows]

    # Carica tutti gli alias in una sola query, raggruppati per analyte_id.
    aliases_by_id: dict[int, list[str]] = {aid: [] for aid in analyte_ids}
    if analyte_ids:
        alias_rows = (await db.execute(
            select(LabAnalyteAlias.analyte_id, LabAnalyteAlias.alias)
            .where(LabAnalyteAlias.analyte_id.in_(analyte_ids))
            .order_by(LabAnalyteAlias.analyte_id, LabAnalyteAlias.alias)
        )).all()
        for aid, alias in alias_rows:
            aliases_by_id[aid].append(alias)

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
            "aliases": aliases_by_id.get(a.id, []),
        }
        for a in rows
    ]


# ---------------------------------------------------------------------------
# Helper: applica unit matching + out_of_range a un singolo result
# ---------------------------------------------------------------------------

def _apply_confirm_logic(result: LabResult, analyte: LabAnalyte) -> None:
    """Aggiorna in place `result.unit_normalized`, `result.out_of_range`,
    `result.needs_review` dato il suo analita. Usato dal confirm panel e
    dal backfill automatico (POST /analytes, POST /aliases)."""
    result.unit_normalized = None
    result.out_of_range = None

    if analyte.value_type == "numeric":
        if result.value_numeric is None:
            result.needs_review = True
            return
        if analyte.unit_canonical is None:
            result.unit_normalized = result.unit_raw
            result.out_of_range = lab_units.numeric_out_of_range(
                result.value_numeric, result.ref_low_raw, result.ref_high_raw,
            )
            result.needs_review = False
        elif lab_units.units_equivalent(result.unit_raw, analyte.unit_canonical):
            result.unit_normalized = analyte.unit_canonical
            result.out_of_range = lab_units.numeric_out_of_range(
                result.value_numeric, analyte.ref_low, analyte.ref_high,
            )
            result.needs_review = False
        else:
            # Unità incompatibile: lasciamo il flag review su, usando i range raw
            # come hint visivo nel frattempo.
            result.out_of_range = lab_units.numeric_out_of_range(
                result.value_numeric, result.ref_low_raw, result.ref_high_raw,
            )
            result.needs_review = True
    elif analyte.value_type in ("qualitative", "semi_quantitative"):
        result.out_of_range = lab_units.qualitative_out_of_range(
            result.value_text, analyte.ref_text,
        )
        result.needs_review = result.out_of_range is None
    elif analyte.value_type == "textual":
        result.out_of_range = None
        result.needs_review = False


async def _backfill_analyte_for_aliases(
    db: AsyncSession, analyte: LabAnalyte, alias_strings: list[str],
) -> int:
    """Per ogni `lab_results` con `analyte_id=NULL` il cui `raw_name` combacia
    (case-insensitive) con uno dei `alias_strings` passati O con
    `analyte.display_name_it`: assegna l'analita e, per i result in panel già
    `confirmed`, applica anche la logica di range/unit. Ritorna il count di
    result aggiornati."""
    needles = {analyte.display_name_it.lower(), *(a.lower() for a in alias_strings if a)}
    needles = {n for n in needles if n}
    if not needles:
        return 0

    # Trova i result candidati (con JOIN su panel per conoscere lo status)
    candidates = (await db.execute(
        select(LabResult, LabPanel.status)
        .join(LabPanel, LabResult.panel_id == LabPanel.id)
        .where(LabResult.analyte_id.is_(None))
        .where(func.lower(LabResult.raw_name).in_(needles))
    )).all()
    count = 0
    for result, panel_status in candidates:
        result.analyte_id = analyte.id
        if panel_status == "confirmed":
            _apply_confirm_logic(result, analyte)
        # Per panel ancora draft: non tocchiamo out_of_range/needs_review,
        # li calcolerà il confirm quando l'utente chiuderà la review.
        count += 1
    return count


# ---------------------------------------------------------------------------
# POST /panels/{id}/confirm
# ---------------------------------------------------------------------------

@router.post("/panels/{panel_id}/confirm")
async def confirm_panel(
    panel_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Promuove un panel `draft → confirmed`.

    Per ogni result mappato (analyte_id presente):
    - se l'analita è numerico e l'unità matcha quella canonica → copia il
      valore in `unit_normalized` e calcola `out_of_range` con i range
      dell'analita;
    - se l'unità non matcha (e non è equivalente) → `needs_review=True`,
      `unit_normalized=NULL`: confronta comunque coi range raw, se presenti;
    - se l'analita è qualitativo → confronto testo/testo con `ref_text`.

    I result senza analita (`analyte_id=NULL`) restano con `needs_review=True`
    e vengono naturalmente esclusi da Matrice/Andamenti (i filtri usano
    `analyte_id`). Il panel si conferma comunque, così i valori mappati
    diventano subito visibili; i non-mappati possono essere completati in
    seguito tornando sulla review.
    """
    panel = (await db.execute(
        select(LabPanel).where(LabPanel.id == panel_id)
    )).scalar_one_or_none()
    if panel is None:
        raise HTTPException(404, "panel non trovato")
    if panel.status == "confirmed":
        raise HTTPException(409, "panel già confermato")

    results = (await db.execute(
        select(LabResult).where(LabResult.panel_id == panel_id)
    )).scalars().all()

    # Carica gli analiti una sola volta
    analyte_ids = {r.analyte_id for r in results if r.analyte_id is not None}
    analytes: dict[int, LabAnalyte] = {}
    if analyte_ids:
        rows = (await db.execute(
            select(LabAnalyte).where(LabAnalyte.id.in_(analyte_ids))
        )).scalars().all()
        analytes = {a.id: a for a in rows}

    updated_out_of_range = 0
    still_needs_review = 0
    unmapped_count = 0
    for r in results:
        a = analytes.get(r.analyte_id)  # type: ignore[arg-type]
        if a is None:
            # Result senza analita: resta da rivedere, fuori da Matrice/Andamenti
            r.needs_review = True
            r.out_of_range = None
            r.unit_normalized = None
            unmapped_count += 1
            continue

        r.needs_review = False
        r.unit_normalized = None
        r.out_of_range = None

        if a.value_type == "numeric":
            # Se manca del tutto il numero, lasciamo needs_review attivo.
            if r.value_numeric is None:
                r.needs_review = True
                still_needs_review += 1
                continue
            # Unità canonica mancante: confronta solo con i range raw.
            if a.unit_canonical is None:
                r.unit_normalized = r.unit_raw
                r.out_of_range = lab_units.numeric_out_of_range(
                    r.value_numeric, r.ref_low_raw, r.ref_high_raw,
                )
            elif lab_units.units_equivalent(r.unit_raw, a.unit_canonical):
                r.unit_normalized = a.unit_canonical
                r.out_of_range = lab_units.numeric_out_of_range(
                    r.value_numeric, a.ref_low, a.ref_high,
                )
            else:
                # Unità diversa da quella canonica: lasciamo decidere l'umano.
                r.needs_review = True
                # Usa comunque i range raw per un primo hint visivo
                r.out_of_range = lab_units.numeric_out_of_range(
                    r.value_numeric, r.ref_low_raw, r.ref_high_raw,
                )
                still_needs_review += 1
        elif a.value_type in ("qualitative", "semi_quantitative"):
            r.out_of_range = lab_units.qualitative_out_of_range(
                r.value_text, a.ref_text,
            )
            if r.out_of_range is None:
                r.needs_review = True
                still_needs_review += 1
        elif a.value_type == "textual":
            # Testo libero: nessun giudizio automatico.
            r.out_of_range = None

        if r.out_of_range:
            updated_out_of_range += 1

    panel.status = "confirmed"
    panel.confirmed_at = datetime.now(timezone.utc)
    await db.commit()

    return {
        "panel_id": panel.id,
        "status": panel.status,
        "confirmed_at": panel.confirmed_at.isoformat(),
        "results_count": len(results),
        "out_of_range_count": updated_out_of_range,
        "still_needs_review": still_needs_review,
        "unmapped_count": unmapped_count,
    }


# ---------------------------------------------------------------------------
# PATCH /panels/{id}
# ---------------------------------------------------------------------------

class PanelPatch(BaseModel):
    test_date: date | None = None
    lab_name: str | None = None
    notes: str | None = None
    specimen_types: list[str] | None = None


@router.patch("/panels/{panel_id}")
async def patch_panel(
    panel_id: int,
    body: PanelPatch,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    panel = (await db.execute(
        select(LabPanel).where(LabPanel.id == panel_id)
    )).scalar_one_or_none()
    if panel is None:
        raise HTTPException(404, "panel non trovato")

    data = body.model_dump(exclude_unset=True)
    if "specimen_types" in data and data["specimen_types"] is not None:
        allowed = {"blood", "urine"}
        data["specimen_types"] = [s for s in data["specimen_types"] if s in allowed]

    for k, v in data.items():
        setattr(panel, k, v)
    await db.commit()
    return {"ok": True, "id": panel.id}


# ---------------------------------------------------------------------------
# DELETE /panels/{id}
# ---------------------------------------------------------------------------

@router.delete("/panels/{panel_id}")
async def delete_panel(
    panel_id: int,
    delete_document: bool = Query(True, description="Elimina anche il LabDocument e il PDF su disco"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    panel = (await db.execute(
        select(LabPanel).where(LabPanel.id == panel_id)
    )).scalar_one_or_none()
    if panel is None:
        raise HTTPException(404, "panel non trovato")

    doc_id = panel.document_id
    await db.delete(panel)  # CASCADE sui results
    await db.flush()

    removed_file = False
    if delete_document and doc_id is not None:
        doc = (await db.execute(
            select(LabDocument).where(LabDocument.id == doc_id)
        )).scalar_one_or_none()
        if doc is not None:
            # Rimuove il file su disco se esiste
            full_path = settings.lab_documents_dir / doc.relative_path
            try:
                if full_path.exists():
                    full_path.unlink()
                    removed_file = True
            except OSError:
                pass
            await db.delete(doc)

    await db.commit()
    return {"ok": True, "deleted_panel_id": panel_id, "removed_file": removed_file}


# ---------------------------------------------------------------------------
# PATCH /results/{id}
# ---------------------------------------------------------------------------

class ResultPatch(BaseModel):
    analyte_id: int | None = None
    value_numeric: Decimal | None = None
    value_text: str | None = None
    unit_raw: str | None = None
    notes: str | None = None


@router.patch("/results/{result_id}")
async def patch_result(
    result_id: int,
    body: ResultPatch,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = (await db.execute(
        select(LabResult).where(LabResult.id == result_id)
    )).scalar_one_or_none()
    if result is None:
        raise HTTPException(404, "result non trovato")

    data = body.model_dump(exclude_unset=True)
    # Verifica analyte_id se fornito
    new_analyte: LabAnalyte | None = None
    if "analyte_id" in data and data["analyte_id"] is not None:
        new_analyte = (await db.execute(
            select(LabAnalyte).where(LabAnalyte.id == data["analyte_id"])
        )).scalar_one_or_none()
        if new_analyte is None:
            raise HTTPException(400, "analyte_id inesistente")

    for k, v in data.items():
        setattr(result, k, v)

    # Se il panel è già confermato e la riga ha un analita, riapplica subito
    # la logica di unit/out_of_range così la Matrice/Andamenti restano
    # coerenti senza obbligare l'utente a rifare il confirm.
    panel_status = (await db.execute(
        select(LabPanel.status).where(LabPanel.id == result.panel_id)
    )).scalar_one()

    if panel_status == "confirmed" and result.analyte_id is not None:
        analyte = new_analyte
        if analyte is None or analyte.id != result.analyte_id:
            analyte = (await db.execute(
                select(LabAnalyte).where(LabAnalyte.id == result.analyte_id)
            )).scalar_one()
        _apply_confirm_logic(result, analyte)
    else:
        # Panel ancora draft: lasciamo il confirm a ricalcolare tutto alla fine.
        result.needs_review = True
        result.unit_normalized = None
        result.out_of_range = None

    await db.commit()
    return {"ok": True, "id": result.id}


@router.delete("/results/{result_id}")
async def delete_result(
    result_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Elimina un singolo risultato (es. valore errato nel referto)."""
    result = (await db.execute(
        select(LabResult).where(LabResult.id == result_id)
    )).scalar_one_or_none()
    if result is None:
        raise HTTPException(404, "result non trovato")
    await db.delete(result)
    await db.commit()
    return {"ok": True, "deleted_result_id": result_id}


# ---------------------------------------------------------------------------
# POST /aliases
# ---------------------------------------------------------------------------

class AliasIn(BaseModel):
    analyte_id: int
    alias: str = Field(min_length=1, max_length=200)


@router.post("/aliases", status_code=201)
async def create_alias(
    body: AliasIn,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    analyte = (await db.execute(
        select(LabAnalyte).where(LabAnalyte.id == body.analyte_id)
    )).scalar_one_or_none()
    if analyte is None:
        raise HTTPException(400, "analyte_id inesistente")

    alias_str = body.alias.strip()
    alias = LabAnalyteAlias(analyte_id=body.analyte_id, alias=alias_str)
    db.add(alias)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "alias già presente")

    # Backfill: mappa i result esistenti con raw_name matching a questo analita
    backfilled = await _backfill_analyte_for_aliases(db, analyte, [alias_str])
    await db.commit()
    await db.refresh(alias)
    return {
        "id": alias.id,
        "analyte_id": alias.analyte_id,
        "alias": alias.alias,
        "results_backfilled": backfilled,
    }


# ---------------------------------------------------------------------------
# POST /analytes
# ---------------------------------------------------------------------------

class AnalyteIn(BaseModel):
    slug: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9_]+$")
    display_name_it: str
    category: str
    specimen: str = "blood"
    value_type: str = "numeric"
    unit_canonical: str | None = None
    ref_low: Decimal | None = None
    ref_high: Decimal | None = None
    ref_text: str | None = None
    sex_specific: str | None = None
    loinc_code: str | None = None
    notes: str | None = None
    aliases: list[str] = Field(default_factory=list)


@router.post("/analytes", status_code=201)
async def create_analyte(
    body: AnalyteIn,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    analyte = LabAnalyte(
        slug=body.slug,
        display_name_it=body.display_name_it,
        category=body.category,
        specimen=body.specimen,
        value_type=body.value_type,
        unit_canonical=body.unit_canonical,
        ref_low=body.ref_low,
        ref_high=body.ref_high,
        ref_text=body.ref_text,
        sex_specific=body.sex_specific,
        loinc_code=body.loinc_code,
        notes=body.notes,
    )
    db.add(analyte)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "slug già esistente")
    await db.refresh(analyte)

    created_aliases = 0
    skipped_aliases = 0
    created_alias_strings: list[str] = []
    for raw in body.aliases:
        a = raw.strip()
        if not a:
            continue
        db.add(LabAnalyteAlias(analyte_id=analyte.id, alias=a))
        try:
            await db.commit()
            created_aliases += 1
            created_alias_strings.append(a)
        except IntegrityError:
            await db.rollback()
            skipped_aliases += 1

    # Backfill sui result esistenti senza analita: il match usa
    # display_name_it + tutti gli alias appena creati.
    backfilled = await _backfill_analyte_for_aliases(
        db, analyte, created_alias_strings
    )
    await db.commit()

    return {
        "id": analyte.id,
        "slug": analyte.slug,
        "aliases_created": created_aliases,
        "aliases_skipped": skipped_aliases,
        "results_backfilled": backfilled,
    }


# ---------------------------------------------------------------------------
# GET /matrix — tabella analiti × date (solo panel confermati)
# ---------------------------------------------------------------------------

@router.get("/matrix")
async def get_matrix(
    start: date | None = None,
    end: date | None = None,
    specimen: str | None = Query(None, pattern="^(blood|urine)$"),
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Matrice sparsa analiti × date per la pagina `/lab` tab Matrice.

    - Solo panel `confirmed`.
    - Ritorna `{analytes, dates, cells}` dove `cells` è
      `{analyte_id: {panel_id: {value, unit, out_of_range, needs_review}}}`.
    - Analiti filtrabili per `specimen` o `category`.
    - Periodo opzionale via `start`/`end` (inclusivo).
    """
    panels_stmt = (
        select(LabPanel.id, LabPanel.test_date, LabPanel.lab_name)
        .where(LabPanel.status == "confirmed")
        .order_by(LabPanel.test_date.desc(), LabPanel.id.desc())
    )
    if start is not None:
        panels_stmt = panels_stmt.where(LabPanel.test_date >= start)
    if end is not None:
        panels_stmt = panels_stmt.where(LabPanel.test_date <= end)
    panels_rows = (await db.execute(panels_stmt)).all()
    panels = [
        {"id": pid, "test_date": td.isoformat(), "lab_name": ln}
        for pid, td, ln in panels_rows
    ]

    analytes_stmt = select(LabAnalyte).order_by(
        LabAnalyte.category, LabAnalyte.display_name_it
    )
    if specimen:
        analytes_stmt = analytes_stmt.where(LabAnalyte.specimen == specimen)
    if category:
        analytes_stmt = analytes_stmt.where(LabAnalyte.category == category)
    analytes_rows = (await db.execute(analytes_stmt)).scalars().all()
    analytes = [
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
        for a in analytes_rows
    ]

    if not panels or not analytes:
        return {"analytes": analytes, "panels": panels, "cells": {}}

    analyte_ids = [a["id"] for a in analytes]
    panel_ids = [p["id"] for p in panels]

    results_stmt = select(LabResult).where(
        LabResult.panel_id.in_(panel_ids),
        LabResult.analyte_id.in_(analyte_ids),
    )
    results = (await db.execute(results_stmt)).scalars().all()

    cells: dict[int, dict[int, dict[str, Any]]] = {}
    for r in results:
        if r.analyte_id is None:
            continue
        by_panel = cells.setdefault(r.analyte_id, {})
        by_panel[r.panel_id] = {
            "value_numeric": (
                float(r.value_numeric) if r.value_numeric is not None else None
            ),
            "value_text": r.value_text,
            "unit": r.unit_normalized or r.unit_raw,
            "out_of_range": r.out_of_range,
            "needs_review": r.needs_review,
        }

    return {"analytes": analytes, "panels": panels, "cells": cells}


# ---------------------------------------------------------------------------
# GET /timeseries — serie temporale di un singolo analita
# ---------------------------------------------------------------------------

@router.get("/timeseries")
async def get_timeseries(
    analyte_slug: str,
    start: date | None = None,
    end: date | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Serie temporale di un analita. Solo panel `confirmed`.
    Ritorna `{analyte, points}` con `ref_low/ref_high` per banda del chart."""
    analyte = (await db.execute(
        select(LabAnalyte).where(LabAnalyte.slug == analyte_slug)
    )).scalar_one_or_none()
    if analyte is None:
        raise HTTPException(404, f"analyte slug '{analyte_slug}' inesistente")

    stmt = (
        select(LabResult, LabPanel.test_date, LabPanel.id)
        .join(LabPanel, LabResult.panel_id == LabPanel.id)
        .where(
            LabResult.analyte_id == analyte.id,
            LabPanel.status == "confirmed",
        )
        .order_by(LabPanel.test_date.asc(), LabPanel.id.asc())
    )
    if start is not None:
        stmt = stmt.where(LabPanel.test_date >= start)
    if end is not None:
        stmt = stmt.where(LabPanel.test_date <= end)
    rows = (await db.execute(stmt)).all()

    points = [
        {
            "panel_id": panel_id,
            "test_date": test_date.isoformat(),
            "value_numeric": (
                float(r.value_numeric) if r.value_numeric is not None else None
            ),
            "value_text": r.value_text,
            "unit": r.unit_normalized or r.unit_raw,
            "out_of_range": r.out_of_range,
        }
        for r, test_date, panel_id in rows
    ]

    return {
        "analyte": {
            "id": analyte.id,
            "slug": analyte.slug,
            "display_name_it": analyte.display_name_it,
            "category": analyte.category,
            "value_type": analyte.value_type,
            "unit_canonical": analyte.unit_canonical,
            "ref_low": float(analyte.ref_low) if analyte.ref_low is not None else None,
            "ref_high": float(analyte.ref_high) if analyte.ref_high is not None else None,
            "ref_text": analyte.ref_text,
        },
        "points": points,
    }


# ---------------------------------------------------------------------------
# GET /recent-out-of-range — widget Home
# ---------------------------------------------------------------------------

@router.get("/recent-out-of-range")
async def recent_out_of_range(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """Ultimi result `out_of_range=True` da panel confermati, ordinati per
    data panel DESC. Usato dal widget Home."""
    stmt = (
        select(
            LabResult.id,
            LabResult.raw_name,
            LabResult.value_numeric,
            LabResult.value_text,
            LabResult.unit_normalized,
            LabResult.unit_raw,
            LabPanel.id.label("panel_id"),
            LabPanel.test_date,
            LabAnalyte.slug,
            LabAnalyte.display_name_it,
            LabAnalyte.ref_low,
            LabAnalyte.ref_high,
            LabAnalyte.unit_canonical,
        )
        .join(LabPanel, LabResult.panel_id == LabPanel.id)
        .outerjoin(LabAnalyte, LabResult.analyte_id == LabAnalyte.id)
        .where(
            LabResult.out_of_range.is_(True),
            LabPanel.status == "confirmed",
        )
        .order_by(LabPanel.test_date.desc(), LabPanel.id.desc(), LabResult.id.asc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    return [
        {
            "result_id": r.id,
            "panel_id": r.panel_id,
            "test_date": r.test_date.isoformat(),
            "analyte_slug": r.slug,
            "display_name": r.display_name_it or r.raw_name,
            "raw_name": r.raw_name,
            "value_numeric": float(r.value_numeric) if r.value_numeric is not None else None,
            "value_text": r.value_text,
            "unit": r.unit_normalized or r.unit_raw or r.unit_canonical,
            "ref_low": float(r.ref_low) if r.ref_low is not None else None,
            "ref_high": float(r.ref_high) if r.ref_high is not None else None,
        }
        for r in rows
    ]
