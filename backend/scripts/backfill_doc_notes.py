"""Backfill delle note dei documenti medici con un riassunto IA dei contenuti.

Per ogni `medical_documents` delle sezioni indicate con note vuote (NULL o solo
whitespace), ri-legge il PDF dal volume, ne ricava il testo (OCR via
ocrmypdf+tesseract se il PDF e' scansionato) e chiede all'IA un riassunto dei
contenuti salienti (il taglio si adatta alla sezione: visita / referto
strumentale / documento), che viene scritto nel campo `notes`.

Comportamento:
- Agisce SOLO sui documenti con note vuote (idempotente: i documenti con note
  gia' compilate — a mano o da un run precedente — vengono saltati).
- Se l'OCR e' impossibile / il PDF non e' leggibile / l'IA non produce un
  riassunto, il documento viene saltato ("passa oltre"), niente errore.

Uso:
    cd backend
    python -m scripts.backfill_doc_notes [--sections visit,imaging,document]
        [--commit] [--limit N]

Default: --sections visit,imaging,document, --dry-run.
"""
from __future__ import annotations

import argparse
import asyncio
import logging

from sqlalchemy import func, or_, select

from app.config import settings
from app.database import async_session
from app.models.medical_docs import (
    MedicalDocCategory,
    MedicalDocFile,
    MedicalDocument,
)
from app.services import medical_docs_ingest

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("backfill_doc_notes")

VALID_SECTIONS = {"visit", "imaging", "document"}


def _load_pdf_bytes(rel_path: str) -> bytes | None:
    path = settings.medical_documents_dir / rel_path
    try:
        return path.read_bytes()
    except OSError:
        logger.warning("  file mancante su disco: %s", path)
        return None


def _summarize(data: bytes, section: str, cat_names: list[str]) -> str | None:
    """Estrae il testo (OCR se serve) e chiede il riassunto all'IA.
    Ritorna None se il documento non e' leggibile o l'IA non produce nulla."""
    content_text = medical_docs_ingest.extract_text(data)
    if not medical_docs_ingest.is_searchable(content_text):
        ocr_bytes = medical_docs_ingest.ocr_pdf(data)
        if ocr_bytes is None:
            return None  # OCR impossibile → passa oltre
        data = ocr_bytes
    try:
        payload = medical_docs_ingest.call_llm(
            data, section, cat_names, include_summary=True
        )
    except Exception:
        logger.warning("  chiamata IA fallita", exc_info=False)
        return None
    return medical_docs_ingest.parse_extracted_meta(payload).summary


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sections", default="visit,imaging,document",
                        help="sezioni separate da virgola (visit,imaging,document)")
    parser.add_argument("--commit", action="store_true",
                        help="scrive le note sul DB (default: dry-run)")
    parser.add_argument("--limit", type=int, default=None,
                        help="processa al massimo N documenti")
    args = parser.parse_args()

    sections = [s.strip() for s in args.sections.split(",") if s.strip()]
    bad = set(sections) - VALID_SECTIONS
    if bad:
        parser.error(f"sezioni non valide: {', '.join(sorted(bad))}")

    async with async_session() as db:
        # Nomi categoria per sezione (servono al prompt LLM).
        cat_by_section: dict[str, list[str]] = {}
        for sec in sections:
            cat_by_section[sec] = [
                c.name for c in (await db.execute(
                    select(MedicalDocCategory).where(MedicalDocCategory.section == sec)
                )).scalars().all()
            ]

        stmt = (
            select(MedicalDocument)
            .where(
                MedicalDocument.section.in_(sections),
                MedicalDocument.file_id.isnot(None),
                or_(
                    MedicalDocument.notes.is_(None),
                    func.btrim(MedicalDocument.notes) == "",
                ),
            )
            .order_by(MedicalDocument.id)
        )
        if args.limit:
            stmt = stmt.limit(args.limit)
        docs = (await db.execute(stmt)).scalars().all()

        logger.info("Documenti con note vuote da processare (%s): %d%s",
                    ",".join(sections), len(docs),
                    "" if args.commit else " (dry-run)")

        updated = skipped = 0
        for doc in docs:
            doc_file = (await db.execute(
                select(MedicalDocFile).where(MedicalDocFile.id == doc.file_id)
            )).scalar_one_or_none()
            if doc_file is None:
                skipped += 1
                continue

            data = _load_pdf_bytes(doc_file.relative_path)
            if data is None:
                skipped += 1
                continue

            summary = await asyncio.to_thread(
                _summarize, data, doc.section, cat_by_section[doc.section]
            )
            if not summary:
                logger.info("  #%d [%s] (%s): nessun riassunto → skip",
                            doc.id, doc.section, doc.title or "senza titolo")
                skipped += 1
                continue

            preview = summary.replace("\n", " ")[:90]
            logger.info("  #%d [%s] (%s): %s",
                        doc.id, doc.section, doc.title or "senza titolo", preview)
            if args.commit:
                doc.notes = summary
                updated += 1

        if args.commit:
            await db.commit()
            logger.info("Fatto. Note aggiornate: %d, saltati: %d", updated, skipped)
        else:
            logger.info("Dry-run. Aggiornerebbe %d documenti, salterebbe %d. "
                        "Ri-esegui con --commit per applicare.",
                        len(docs) - skipped, skipped)


if __name__ == "__main__":
    asyncio.run(main())
