"""Router del dominio Lab Results.

PR #2a: endpoint di ingest, lista/dettaglio panel, stream documento, catalogo
read-only. La conferma di un panel, l'editing dei result e il CRUD alias/analita
arriveranno in PR #2b.
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

import anyio
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    UploadFile,
    File,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session, get_db
from app.models import HealthSample, Workout, Regimen, HealthNote, JournalEntry
from app.models.lab import (
    LabAnalyte,
    LabAnalyteAlias,
    LabCorrelationAnnotation,
    LabDocument,
    LabPanel,
    LabResult,
)
from app.services import lab_correlations, lab_correlations_llm, lab_ingest, lab_units

DIARIO_BASE_URL = os.environ.get("DIARIO_BASE_URL", "http://192.168.68.173:3000")


async def _auto_fill_diet_text(test_date: date) -> str | None:
    """Riassunto diario alimentare per `test_date` come contesto panel."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                f"{DIARIO_BASE_URL}/api/external/daily-totals",
                params={"from": test_date.isoformat(), "to": test_date.isoformat()},
            )
        if r.status_code != 200:
            return None
        rows = r.json() or []
        day = next((row for row in rows if row.get("date") == test_date.isoformat()), None)
        if day is None:
            return None
        target = day.get("kcal_target")
        bits = [f"kcal {int(day.get('kcal', 0))}"]
        if target:
            bits.append(f"target {int(target)}")
        for k, label in (("protein_g", "P"), ("fat_g", "G"), ("carbs_g", "C")):
            v = day.get(k)
            if v is not None:
                bits.append(f"{label} {v:.0f}g")
        return " · ".join(bits)
    except Exception:
        return None


async def _auto_fill_workout_text(db: AsyncSession, test_date: date) -> str | None:
    """Workout più rilevante del giorno del prelievo (o del giorno prima)."""
    start_dt = datetime.combine(test_date - timedelta(days=1), time(0, 0), tzinfo=timezone.utc)
    end_dt = datetime.combine(test_date, time(23, 59, 59), tzinfo=timezone.utc)
    row = (await db.execute(
        select(Workout)
        .where(Workout.start_date >= start_dt, Workout.start_date <= end_dt)
        .order_by(Workout.start_date.desc())
        .limit(1)
    )).scalar_one_or_none()
    if row is None:
        return None
    bits: list[str] = []
    name = row.activity_name or f"Activity {row.activity_type}"
    bits.append(name)
    if row.duration:
        bits.append(f"{int(row.duration / 60)} min")
    if row.total_distance:
        bits.append(f"{row.total_distance / 1000:.1f} km")
    when = row.start_date.date().isoformat()
    bits.append(when)
    return " · ".join(bits)

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
    #    Passiamo il catalogo così il modello può restituire suggested_slug
    #    per ciascun analita — migliora enormemente il matching delle urine
    #    (dove le varianti di naming sono moltissime).
    #    In caso di errore creiamo un panel vuoto con notes=parsing_failed.
    parsing_failed = False
    extracted: lab_ingest.ExtractedPanel | None = None
    try:
        catalog = await lab_ingest.load_catalog_for_llm(db)
        payload = lab_ingest.call_llm(data, catalog=catalog)
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

    # Auto-fill dei campi di contesto se possibile (silent fallback su None).
    td_for_context = panel_kwargs.get("test_date")
    if td_for_context is not None:
        try:
            diet = await _auto_fill_diet_text(td_for_context)
            if diet:
                panel_kwargs["diet_text"] = diet
        except Exception:
            logger.debug("diet auto-fill skipped", exc_info=True)
        try:
            wk = await _auto_fill_workout_text(db, td_for_context)
            if wk:
                panel_kwargs["workout_text"] = wk
        except Exception:
            logger.debug("workout auto-fill skipped", exc_info=True)

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

def _workout_label(w: Workout) -> str:
    """Etichetta breve per un workout nella riga auto-context training."""
    base = w.title or w.activity_name or f"Workout #{w.activity_type}"
    bits = [base]
    if w.duration:
        mins = int(round(w.duration / 60))
        bits.append(f"{mins}'")
    if w.total_distance:
        km = w.total_distance / 1000.0
        bits.append(f"{km:.2f} km")
    return " · ".join(bits)


def _journal_preview(e: JournalEntry, max_len: int = 120) -> str:
    txt = (e.content_text or "").strip().replace("\n", " ")
    if len(txt) > max_len:
        txt = txt[: max_len - 1].rstrip() + "…"
    return txt or "(voce vuota)"


def _regimen_item(r: Regimen) -> dict[str, Any]:
    return {
        "id": r.id,
        "label": r.name,
        "detail": r.dose,
        "start_date": r.start_date.isoformat() if r.start_date else None,
        "end_date": r.end_date.isoformat() if r.end_date else None,
        "kind": r.kind,
        "source": "regimen",
    }


def _health_note_item(n: HealthNote) -> dict[str, Any]:
    label_bits = []
    if n.body_zone:
        label_bits.append(n.body_zone)
    if n.text:
        txt = n.text.strip().replace("\n", " ")
        if len(txt) > 80:
            txt = txt[:79].rstrip() + "…"
        label_bits.append(txt)
    return {
        "id": n.id,
        "label": " — ".join(label_bits) if label_bits else "(nota)",
        "detail": n.category,
        "start_date": n.start_date.isoformat(),
        "end_date": n.end_date.isoformat(),
        "source": "health_note",
    }


def _journal_item(e: JournalEntry) -> dict[str, Any]:
    return {
        "id": e.id,
        "label": _journal_preview(e),
        "detail": ", ".join(e.tags) if e.tags else None,
        "start_date": e.date.isoformat(),
        "end_date": e.date.isoformat(),
        "source": "journal",
    }


def _workout_item(w: Workout) -> dict[str, Any]:
    return {
        "id": w.id,
        "label": _workout_label(w),
        "detail": w.source_name,
        "start_date": w.start_date.date().isoformat(),
        "end_date": w.start_date.date().isoformat(),
        "source": "workout",
    }


def _empty_auto_context() -> dict[str, Any]:
    return {
        "medications": [],
        "supplements": [],
        "training": [],
        "diet": None,
        "health_notes": [],
        "journal": [],
    }


async def _build_auto_context(
    db: AsyncSession, test_date: date,
) -> dict[str, Any]:
    """Aggrega regimens / health_notes / journal / workouts attivi/del giorno
    per il test_date di un panel lab. Restituito sia da /panels/{id} che, per
    batch, da /matrix."""
    regimens_rows = (await db.execute(
        select(Regimen)
        .where(Regimen.kind.in_(("medication", "supplement", "training", "diet")))
        .where((Regimen.start_date.is_(None)) | (Regimen.start_date <= test_date))
        .where((Regimen.end_date.is_(None)) | (Regimen.end_date >= test_date))
        .order_by(Regimen.kind, Regimen.name)
    )).scalars().all()

    notes_rows = (await db.execute(
        select(HealthNote)
        .where(HealthNote.start_date <= test_date)
        .where(HealthNote.end_date >= test_date)
        .order_by(HealthNote.category, HealthNote.start_date.desc())
    )).scalars().all()

    journal_rows = (await db.execute(
        select(JournalEntry)
        .where(JournalEntry.date == test_date)
        .order_by(JournalEntry.created_at)
    )).scalars().all()

    sod = datetime.combine(test_date, time.min, tzinfo=timezone.utc)
    eod = datetime.combine(test_date, time.max, tzinfo=timezone.utc)
    workout_rows = (await db.execute(
        select(Workout)
        .where(Workout.start_date >= sod)
        .where(Workout.start_date <= eod)
        .order_by(Workout.start_date)
    )).scalars().all()

    # Dedup per (kind, name lowercased trimmed): se per la stessa data sono
    # attivi piu' regimens con stesso nome (es. una "vita" precedente non
    # chiusa correttamente + una ripresa), teniamo solo quello con
    # start_date piu' recente (None = ignoto, conta come piu' vecchio).
    seen: dict[tuple[str, str], Regimen] = {}
    for r in regimens_rows:
        key = (r.kind, (r.name or "").strip().lower())
        prev = seen.get(key)
        if prev is None:
            seen[key] = r
            continue
        prev_start = prev.start_date or date.min
        cur_start = r.start_date or date.min
        if cur_start > prev_start:
            seen[key] = r
    deduped = list(seen.values())

    ctx = _empty_auto_context()
    for r in deduped:
        if r.kind == "medication":
            ctx["medications"].append(_regimen_item(r))
        elif r.kind == "supplement":
            ctx["supplements"].append(_regimen_item(r))
        elif r.kind == "training":
            ctx["training"].append(_regimen_item(r))
        elif r.kind == "diet" and ctx["diet"] is None:
            item = _regimen_item(r)
            meta = r.metadata_ or {}
            extras = []
            if meta.get("kcal_target"):
                extras.append(f"{int(meta['kcal_target'])} kcal")
            if extras:
                item["detail"] = " · ".join(
                    [item.get("detail") or "", *extras]
                ).strip(" ·")
            ctx["diet"] = item
    for w in workout_rows:
        ctx["training"].append(_workout_item(w))
    ctx["health_notes"] = [_health_note_item(n) for n in notes_rows]
    ctx["journal"] = [_journal_item(e) for e in journal_rows]
    return ctx


async def _latest_hk_value(
    db: AsyncSession, type_: str, before: datetime, window_days: int = 30,
) -> dict[str, Any] | None:
    lower = before - timedelta(days=window_days)
    row = (await db.execute(
        select(HealthSample)
        .where(HealthSample.type == type_)
        .where(HealthSample.start_date <= before)
        .where(HealthSample.start_date >= lower)
        .order_by(HealthSample.start_date.desc(), HealthSample.id.desc())
        .limit(1)
    )).scalar_one_or_none()
    if row is None:
        return None
    return {
        "value": float(row.value),
        "unit": row.unit,
        "start_date": row.start_date.isoformat(),
    }


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

    # Body snapshot: ultimo peso, massa grassa, BMI con start_date ≤ test_date
    end_of_day = datetime.combine(panel.test_date, time(23, 59, 59), tzinfo=timezone.utc)
    body_snapshot = {
        "weight": await _latest_hk_value(db, "HKQuantityTypeIdentifierBodyMass", end_of_day),
        "body_fat": await _latest_hk_value(db, "HKQuantityTypeIdentifierBodyFatPercentage", end_of_day),
        "bmi": await _latest_hk_value(db, "HKQuantityTypeIdentifierBodyMassIndex", end_of_day),
    }

    return {
        "id": panel.id,
        "test_date": panel.test_date.isoformat(),
        "lab_name": panel.lab_name,
        "specimen_types": panel.specimen_types,
        "status": panel.status,
        "notes": panel.notes,
        "document_id": panel.document_id,
        "confirmed_at": panel.confirmed_at.isoformat() if panel.confirmed_at else None,
        "activity_text": panel.activity_text,
        "medications_text": panel.medications_text,
        "supplements_text": panel.supplements_text,
        "nutrition_text": panel.nutrition_text,
        "diet_text": panel.diet_text,
        "workout_text": panel.workout_text,
        "body_snapshot": body_snapshot,
        "auto_context": await _build_auto_context(db, panel.test_date),
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
    # Inline disposition: il browser apre il PDF nella scheda invece di
    # forzarne il download. Manteniamo comunque il filename suggerito per
    # l'eventuale "Salva con nome" dell'utente.
    return FileResponse(
        path=str(full_path),
        media_type=doc.mime_type,
        headers={
            "Content-Disposition": f'inline; filename="{doc.relative_path}"',
        },
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
    activity_text: str | None = None
    medications_text: str | None = None
    supplements_text: str | None = None
    nutrition_text: str | None = None
    diet_text: str | None = None
    workout_text: str | None = None


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
    raw_name: str | None = None
    value_numeric: Decimal | None = None
    value_text: str | None = None
    unit_raw: str | None = None
    ref_low_raw: Decimal | None = None
    ref_high_raw: Decimal | None = None
    ref_text_raw: str | None = None
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


class NewResultIn(BaseModel):
    raw_name: str = "Nuovo risultato"
    analyte_id: int | None = None
    value_numeric: Decimal | None = None
    value_text: str | None = None
    unit_raw: str | None = None
    ref_low_raw: Decimal | None = None
    ref_high_raw: Decimal | None = None
    ref_text_raw: str | None = None
    notes: str | None = None


@router.post("/panels/{panel_id}/results", status_code=201)
async def add_result(
    panel_id: int,
    body: NewResultIn,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Aggiunge un risultato a un panel esistente (righe mancate dall'OCR)."""
    panel = (await db.execute(
        select(LabPanel).where(LabPanel.id == panel_id)
    )).scalar_one_or_none()
    if panel is None:
        raise HTTPException(404, "panel non trovato")

    result = LabResult(
        panel_id=panel_id,
        raw_name=body.raw_name.strip() or "Nuovo risultato",
        analyte_id=body.analyte_id,
        value_numeric=body.value_numeric,
        value_text=body.value_text,
        unit_raw=body.unit_raw,
        ref_low_raw=body.ref_low_raw,
        ref_high_raw=body.ref_high_raw,
        ref_text_raw=body.ref_text_raw,
        notes=body.notes,
        needs_review=True,
    )
    db.add(result)
    await db.flush()

    # Se il panel è già confirmed e abbiamo un analyte_id, applica subito OOR
    if panel.status == "confirmed" and result.analyte_id is not None:
        analyte = (await db.execute(
            select(LabAnalyte).where(LabAnalyte.id == result.analyte_id)
        )).scalar_one_or_none()
        if analyte is not None:
            _apply_confirm_logic(result, analyte)

    await db.commit()
    await db.refresh(result)
    return {"id": result.id, "panel_id": result.panel_id, "raw_name": result.raw_name}


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
        return {
            "analytes": analytes,
            "panels": panels,
            "cells": {},
            "panel_weights": {},
            "panel_context": {},
            "panel_auto_context": {},
        }

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

    # Peso corporeo (HKBodyMass) per ciascun panel: ultimo sample noto con
    # start_date <= test_date. Aggiungiamo anche sample_date per poter
    # distinguere lato UI quando il peso è "del giorno" vs "di giorni prima".
    panel_weights: dict[int, dict[str, Any]] = {}
    if panels:
        for p in panels:
            pid = p["id"]
            td = date.fromisoformat(p["test_date"])
            end_dt = datetime.combine(td, datetime.max.time(), tzinfo=timezone.utc)
            ws = (await db.execute(
                select(HealthSample)
                .where(HealthSample.type == "HKQuantityTypeIdentifierBodyMass")
                .where(HealthSample.start_date <= end_dt)
                .order_by(HealthSample.start_date.desc(), HealthSample.id.desc())
                .limit(1)
            )).scalar_one_or_none()
            if ws is not None:
                panel_weights[pid] = {
                    "value_numeric": float(ws.value),
                    "value_text": None,
                    "unit": ws.unit or "kg",
                    "out_of_range": None,
                    "needs_review": False,
                    "sample_date": ws.start_date.date().isoformat(),
                }

    # Note di contesto per panel (attività, farmaci, etc.). Ci servono
    # nella Matrice come righe editabili sotto il peso.
    ctx_rows = (await db.execute(
        select(
            LabPanel.id,
            LabPanel.activity_text,
            LabPanel.medications_text,
            LabPanel.supplements_text,
            LabPanel.nutrition_text,
            LabPanel.diet_text,
            LabPanel.workout_text,
            LabPanel.notes,
        ).where(LabPanel.id.in_(panel_ids))
    )).all()
    panel_context: dict[int, dict[str, str | None]] = {
        r.id: {
            "activity_text": r.activity_text,
            "medications_text": r.medications_text,
            "supplements_text": r.supplements_text,
            "nutrition_text": r.nutrition_text,
            "diet_text": r.diet_text,
            "workout_text": r.workout_text,
            "notes": r.notes,
        }
        for r in ctx_rows
    }

    # Auto-context per ogni panel (regimens / health_notes / journal / workouts
    # del giorno del prelievo). Batched: una query globale per ciascuna sorgente
    # nel range [min(test_date), max(test_date)], poi filtraggio per panel.
    panel_dates = {p["id"]: date.fromisoformat(p["test_date"]) for p in panels}
    min_date = min(panel_dates.values())
    max_date = max(panel_dates.values())

    all_regimens = (await db.execute(
        select(Regimen)
        .where(Regimen.kind.in_(("medication", "supplement", "training", "diet")))
        .where((Regimen.start_date.is_(None)) | (Regimen.start_date <= max_date))
        .where((Regimen.end_date.is_(None)) | (Regimen.end_date >= min_date))
        .order_by(Regimen.kind, Regimen.name)
    )).scalars().all()

    all_notes = (await db.execute(
        select(HealthNote)
        .where(HealthNote.start_date <= max_date)
        .where(HealthNote.end_date >= min_date)
        .order_by(HealthNote.category, HealthNote.start_date.desc())
    )).scalars().all()

    panel_date_set = set(panel_dates.values())
    all_journal = (await db.execute(
        select(JournalEntry)
        .where(JournalEntry.date.in_(panel_date_set))
        .order_by(JournalEntry.created_at)
    )).scalars().all()

    sod_global = datetime.combine(min_date, time.min, tzinfo=timezone.utc)
    eod_global = datetime.combine(max_date, time.max, tzinfo=timezone.utc)
    all_workouts = (await db.execute(
        select(Workout)
        .where(Workout.start_date >= sod_global)
        .where(Workout.start_date <= eod_global)
        .order_by(Workout.start_date)
    )).scalars().all()

    panel_auto_context: dict[int, dict[str, Any]] = {}
    for pid, td in panel_dates.items():
        ctx = _empty_auto_context()
        # Dedup per (kind, name): tieni il regimen con start_date piu' recente
        # tra quelli attivi al giorno td.
        seen: dict[tuple[str, str], Regimen] = {}
        for r in all_regimens:
            if r.start_date is not None and r.start_date > td:
                continue
            if r.end_date is not None and r.end_date < td:
                continue
            key = (r.kind, (r.name or "").strip().lower())
            prev = seen.get(key)
            if prev is None:
                seen[key] = r
                continue
            prev_start = prev.start_date or date.min
            cur_start = r.start_date or date.min
            if cur_start > prev_start:
                seen[key] = r
        for r in seen.values():
            if r.kind == "medication":
                ctx["medications"].append(_regimen_item(r))
            elif r.kind == "supplement":
                ctx["supplements"].append(_regimen_item(r))
            elif r.kind == "training":
                ctx["training"].append(_regimen_item(r))
            elif r.kind == "diet" and ctx["diet"] is None:
                item = _regimen_item(r)
                meta = r.metadata_ or {}
                extras = []
                if meta.get("kcal_target"):
                    extras.append(f"{int(meta['kcal_target'])} kcal")
                if extras:
                    item["detail"] = " · ".join(
                        [item.get("detail") or "", *extras]
                    ).strip(" ·")
                ctx["diet"] = item
        for w in all_workouts:
            if w.start_date.date() == td:
                ctx["training"].append(_workout_item(w))
        for n in all_notes:
            if n.start_date <= td <= n.end_date:
                ctx["health_notes"].append(_health_note_item(n))
        for e in all_journal:
            if e.date == td:
                ctx["journal"].append(_journal_item(e))
        panel_auto_context[pid] = ctx

    return {
        "analytes": analytes,
        "panels": panels,
        "cells": cells,
        "panel_weights": panel_weights,
        "panel_context": panel_context,
        "panel_auto_context": panel_auto_context,
    }


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


# ---------------------------------------------------------------------------
# GET /correlations — ipotesi di associazione esame ↔ regime/nota
# ---------------------------------------------------------------------------

_PLAUS_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3}


async def _annotate_correlations(candidates: list[dict[str, Any]]) -> None:
    """Background fill: per ogni candidata con annotazione ancora `pending`
    chiama l'IA (sequenziale, LXC 1GB) e aggiorna la riga a done/failed."""
    async with async_session() as db:
        for c in candidates:
            sig = c["signature"]
            row = (await db.execute(
                select(LabCorrelationAnnotation)
                .where(LabCorrelationAnnotation.signature == sig)
            )).scalar_one_or_none()
            if row is None or row.status != "pending":
                continue
            try:
                payload = await anyio.to_thread.run_sync(
                    lab_correlations_llm.call_llm, c
                )
                ann = lab_correlations_llm.parse_annotation(payload)
                row.plausibility = ann.plausibility
                row.is_known_association = ann.is_known_association
                row.mechanism_text = ann.mechanism_text
                row.model = settings.anthropic_model
                row.status = "done"
            except Exception:
                logger.exception("lab-correlations: annotazione IA fallita per %s", sig)
                row.status = "failed"
            await db.commit()


@router.get("/correlations")
async def get_correlations(
    background_tasks: BackgroundTasks,
    panel_id: int | None = None,
    refresh: bool = False,
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Candidate di associazione esame ↔ regime/nota, ordinate per rilevanza.
    Il motore deterministico gira a ogni chiamata (cheap); le annotazioni IA
    sono cacheate per signature e riempite in background. Senza ANTHROPIC_API_KEY
    le candidate restano comunque (annotazioni `failed`)."""
    # 1. Serie per-analita (solo panel confermati, analita mappato).
    rows = (await db.execute(
        select(LabResult, LabPanel.test_date, LabPanel.id.label("pid"), LabAnalyte)
        .join(LabPanel, LabResult.panel_id == LabPanel.id)
        .join(LabAnalyte, LabResult.analyte_id == LabAnalyte.id)
        .where(LabPanel.status == "confirmed", LabResult.analyte_id.isnot(None))
        .order_by(LabAnalyte.id, LabPanel.test_date.asc(), LabPanel.id.asc())
    )).all()

    series_by_id: dict[int, lab_correlations.AnalyteSeries] = {}
    dates: list[date] = []
    for r, test_date, pid, analyte in rows:
        dates.append(test_date)
        s = series_by_id.get(analyte.id)
        if s is None:
            s = lab_correlations.AnalyteSeries(
                id=analyte.id, slug=analyte.slug, name=analyte.display_name_it,
                category=analyte.category,
                ref_low=float(analyte.ref_low) if analyte.ref_low is not None else None,
                ref_high=float(analyte.ref_high) if analyte.ref_high is not None else None,
                points=[],
            )
            series_by_id[analyte.id] = s
        s.points.append(lab_correlations.Point(
            panel_id=pid, test_date=test_date,
            value=float(r.value_numeric) if r.value_numeric is not None else None,
            out_of_range=r.out_of_range,
            unit=r.unit_normalized or r.unit_raw,
        ))

    if not dates:
        return {"candidates": [], "by_cell": {}, "computed_at": datetime.now(timezone.utc).isoformat()}
    lo, hi = min(dates), max(dates)

    # 2. Regimi + note salute sul range globale.
    regimen_rows = (await db.execute(
        select(Regimen).where(
            Regimen.kind.in_(lab_correlations.REGIMEN_KINDS),
            (Regimen.start_date.is_(None)) | (Regimen.start_date <= hi),
            (Regimen.end_date.is_(None)) | (Regimen.end_date >= lo),
        )
    )).scalars().all()
    regimens = [
        lab_correlations.RegimenRow(
            id=r.id, kind=r.kind, name=r.name,
            start_date=r.start_date, end_date=r.end_date, dose=r.dose,
        )
        for r in regimen_rows
    ]
    note_rows = (await db.execute(
        select(HealthNote).where(
            HealthNote.start_date <= hi, HealthNote.end_date >= lo
        )
    )).scalars().all()
    notes = [
        lab_correlations.NoteRow(
            id=n.id, category=n.category, body_zone=n.body_zone, text=n.text,
            start_date=n.start_date, end_date=n.end_date,
        )
        for n in note_rows
    ]

    # 3. Candidate deterministiche.
    candidates = lab_correlations.compute_candidates(
        list(series_by_id.values()), regimens, notes
    )
    if panel_id is not None:
        candidates = [c for c in candidates if c["cur_panel_id"] == panel_id]
    candidates = candidates[:limit]

    # 4. Annotazioni cacheate + enqueue delle mancanti.
    sigs = [c["signature"] for c in candidates]
    existing: dict[str, LabCorrelationAnnotation] = {}
    if sigs:
        for a in (await db.execute(
            select(LabCorrelationAnnotation)
            .where(LabCorrelationAnnotation.signature.in_(sigs))
        )).scalars().all():
            existing[a.signature] = a

    to_annotate: list[dict[str, Any]] = []
    annotate_budget = lab_correlations.TOP_N_ANNOTATE
    for c in candidates:
        a = existing.get(c["signature"])
        if a is not None and not refresh and a.status != "failed":
            c["annotation"] = {
                "plausibility": a.plausibility,
                "is_known_association": a.is_known_association,
                "mechanism_text": a.mechanism_text,
                "status": a.status,
            }
            continue
        # Da (ri)annotare: inserisci/azzera la riga a pending (cap budget).
        if annotate_budget > 0:
            await db.execute(
                pg_insert(LabCorrelationAnnotation)
                .values(signature=c["signature"], status="pending")
                .on_conflict_do_update(
                    index_elements=["signature"],
                    set_={"status": "pending", "updated_at": func.now()},
                )
            )
            to_annotate.append(c)
            annotate_budget -= 1
            c["annotation"] = {"status": "pending"}
        else:
            c["annotation"] = {"status": "pending"}
    if to_annotate:
        await db.commit()
        background_tasks.add_task(_annotate_correlations, to_annotate)

    # 5. Lookup per la Matrice: by_cell[analyte_id][cur_panel_id].
    by_cell: dict[str, dict[str, Any]] = {}
    for c in candidates:
        ak = str(c["analyte_id"])
        pk = str(c["cur_panel_id"])
        cell = by_cell.setdefault(ak, {}).setdefault(
            pk, {"count": 0, "max_plausibility": None, "signatures": []}
        )
        cell["count"] += 1
        cell["signatures"].append(c["signature"])
        plaus = c.get("annotation", {}).get("plausibility")
        if plaus and (
            cell["max_plausibility"] is None
            or _PLAUS_ORDER.get(plaus, 0) > _PLAUS_ORDER.get(cell["max_plausibility"], 0)
        ):
            cell["max_plausibility"] = plaus

    return {"candidates": candidates, "by_cell": by_cell, "computed_at": datetime.now(timezone.utc).isoformat()}
