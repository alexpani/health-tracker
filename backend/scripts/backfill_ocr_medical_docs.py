"""Backfill OCR retroattivo per i documenti medici gia' in archivio.

Per ogni `medical_documents` delle sezioni indicate con `content_text` vuoto
(NULL o whitespace) ri-legge il PDF dal volume e:
  - se il PDF ha gia' un layer di testo → estrae e salva `content_text`;
  - se e' scansionato → OCR via ocrmypdf+tesseract (`ita+eng`), sostituisce il
    file su disco con la versione cercabile, poi estrae e salva `content_text`.
Il trigger DB su `medical_documents` ricalcola `search_tsv`, quindi i referti
cartacei finiscono nella ricerca full-text.

Comportamento:
- Agisce SOLO sui documenti con `content_text` vuoto (idempotente: dopo il run
  con `--commit` i documenti processati non vengono piu' ripresi).
- Se l'OCR e' impossibile / il PDF non e' leggibile, il documento viene saltato
  ("passa oltre"), niente errore.
- Niente chiamate IA: questo script fa SOLO OCR + estrazione testo (non tocca
  titolo/data/categoria/note). Per il riassunto note delle Visite vedi
  `scripts/backfill_visit_notes.py`.

Uso:
    cd backend
    python -m scripts.backfill_ocr_medical_docs [--sections imaging,document]
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
from app.models.medical_docs import MedicalDocFile, MedicalDocument
from app.services import medical_docs_ingest

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("backfill_ocr_medical_docs")

VALID_SECTIONS = {"visit", "imaging", "document"}


def _load_pdf_bytes(rel_path: str) -> bytes | None:
    path = settings.medical_documents_dir / rel_path
    try:
        return path.read_bytes()
    except OSError:
        logger.warning("  file mancante su disco: %s", path)
        return None


def _ocr_and_extract(data: bytes) -> tuple[str | None, bytes | None]:
    """Ritorna (content_text, new_pdf_bytes).
    - content_text=None  → documento illeggibile / OCR impossibile (skip).
    - new_pdf_bytes=None  → il PDF aveva gia' testo (niente da riscrivere).
    - new_pdf_bytes!=None → bytes del PDF OCR-izzato da salvare su disco.
    """
    content_text = medical_docs_ingest.extract_text(data)
    if medical_docs_ingest.is_searchable(content_text):
        return content_text, None
    ocr_bytes = medical_docs_ingest.ocr_pdf(data)
    if ocr_bytes is None:
        return None, None  # OCR impossibile → passa oltre
    content_text = medical_docs_ingest.extract_text(ocr_bytes)
    if not medical_docs_ingest.is_searchable(content_text):
        return None, None  # OCR non ha prodotto testo utile
    return content_text, ocr_bytes


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sections", default="visit,imaging,document",
                        help="sezioni separate da virgola (visit,imaging,document)")
    parser.add_argument("--commit", action="store_true",
                        help="scrive su DB e disco (default: dry-run)")
    parser.add_argument("--limit", type=int, default=None,
                        help="processa al massimo N documenti")
    args = parser.parse_args()

    sections = [s.strip() for s in args.sections.split(",") if s.strip()]
    bad = set(sections) - VALID_SECTIONS
    if bad:
        parser.error(f"sezioni non valide: {', '.join(sorted(bad))}")

    async with async_session() as db:
        stmt = (
            select(MedicalDocument)
            .where(
                MedicalDocument.section.in_(sections),
                MedicalDocument.file_id.isnot(None),
                or_(
                    MedicalDocument.content_text.is_(None),
                    func.length(func.btrim(MedicalDocument.content_text)) < 30,
                ),
            )
            .order_by(MedicalDocument.id)
        )
        if args.limit:
            stmt = stmt.limit(args.limit)
        docs = (await db.execute(stmt)).scalars().all()

        logger.info("Documenti senza testo da processare (%s): %d%s",
                    ",".join(sections), len(docs),
                    "" if args.commit else " (dry-run)")

        updated = ocred = skipped = 0
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

            content_text, new_pdf = await asyncio.to_thread(_ocr_and_extract, data)
            if not content_text:
                logger.info("  #%d [%s] (%s): illeggibile → skip",
                            doc.id, doc.section, doc.title or "senza titolo")
                skipped += 1
                continue

            tag = "OCR" if new_pdf is not None else "testo"
            logger.info("  #%d [%s] (%s): %s, %d caratteri",
                        doc.id, doc.section, doc.title or "senza titolo",
                        tag, len(content_text))
            if args.commit:
                if new_pdf is not None:
                    path = settings.medical_documents_dir / doc_file.relative_path
                    path.write_bytes(new_pdf)
                    doc_file.size_bytes = len(new_pdf)
                    ocred += 1
                doc.content_text = content_text
                doc.parsing_failed = False
                updated += 1

        if args.commit:
            await db.commit()
            logger.info("Fatto. Documenti aggiornati: %d (di cui OCR: %d), saltati: %d",
                        updated, ocred, skipped)
        else:
            logger.info("Dry-run. Aggiornerebbe %d documenti, salterebbe %d. "
                        "Ri-esegui con --commit per applicare.",
                        len(docs) - skipped, skipped)


if __name__ == "__main__":
    asyncio.run(main())
