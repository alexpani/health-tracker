"""Pipeline di ingest per un documento medico PDF (Visite / Referti / Documentazione).

Step:
  1. Hash SHA-256 + salvataggio file nel volume (`medical_documents/<sha>.pdf`).
  2. Estrazione del testo grezzo via pdfplumber (per la ricerca full-text).
  3. Invio del PDF ad Anthropic come blocco `document` (base64): il modello
     gestisce sia PDF testuali che scannerizzati (OCR interno) e risponde con
     JSON di soli metadati essenziali (data, categoria, titolo, struttura, medico).

La chiamata LLM e' isolata dietro `call_llm()` per poter essere mockata nei test.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

MAX_LLM_TOKENS = 1024

# Etichette per-sezione usate nel prompt LLM.
SECTION_LABELS: dict[str, str] = {
    "visit": "referto di una visita medica specialistica",
    "imaging": "referto di un esame strumentale (radiografia, RMN, ecografia, TAC, ...)",
    "document": "documento sanitario (attestato vaccinale, esenzione, certificato, ...)",
}

# Cosa deve contenere il `summary` per ciascuna sezione.
SUMMARY_HINTS: dict[str, str] = {
    "visit": ("il motivo della visita, l'esito/diagnosi, le terapie o "
              "prescrizioni indicate, i controlli o follow-up consigliati"),
    "imaging": ("il tipo di esame e il distretto indagato, i reperti "
                "principali e le conclusioni/diagnosi del referto, eventuali "
                "raccomandazioni o approfondimenti suggeriti"),
    "document": ("il tipo di documento e a cosa serve, i dati salienti che "
                 "contiene (es. esito, validita'/scadenza, prescrizioni, "
                 "enti o medici coinvolti)"),
}


def build_system_prompt(
    section: str, categories: list[str], include_summary: bool = False
) -> str:
    label = SECTION_LABELS.get(section, "documento medico")
    cat_str = ", ".join(categories) if categories else "(nessuna categoria definita)"
    summary_field = ""
    summary_rule = ""
    if include_summary:
        hint = SUMMARY_HINTS.get(
            section, "i contenuti salienti del documento")
        summary_field = f"""- summary: un riassunto in italiano dei contenuti salienti del documento
  ({hint}). Massimo ~6 righe, conciso e fattuale,
  oppure null se il documento non e' leggibile / non contiene contenuti utili
"""
        summary_rule = ("- `summary` deve riportare solo cio' che e' scritto nel documento, "
                        "senza interpretazioni o diagnosi inventate.\n")
    return f"""Sei un parser di documenti medici italiani. Ricevi un {label}
(PDF testuale o scannerizzato, fai OCR se serve).

Estrai SOLO i metadati essenziali e rispondi con questo JSON:
- doc_date: data del documento in formato ISO YYYY-MM-DD (data della visita /
  esame / emissione del documento), oppure null se non determinabile
- suggested_category: la categoria piu' adatta scelta ESATTAMENTE da questo
  elenco, oppure null se nessuna e' pertinente: {cat_str}
- title: un titolo breve e descrittivo del documento (es. "Visita oculistica
  di controllo", "RMN ginocchio destro", "Certificato vaccinale antinfluenzale")
- facility_name: nome della struttura / ambulatorio / laboratorio, oppure null
- doctor_name: nome del medico refertante / specialista, oppure null
{summary_field}
Regole:
- Non inventare dati: se un campo manca, usa null.
- `suggested_category` deve essere una stringa identica a una voce dell'elenco
  fornito (rispetta maiuscole/minuscole), oppure null.
{summary_rule}- Rispondi SOLO con JSON valido, niente testo prima o dopo, niente markdown."""


@dataclass
class ExtractedMeta:
    doc_date: date | None
    suggested_category: str | None
    title: str | None
    facility_name: str | None
    doctor_name: str | None
    summary: str | None = None


# ---------------------------------------------------------------------------
# 1. Hash + salvataggio file
# ---------------------------------------------------------------------------

def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_document(data: bytes, original_filename: str) -> tuple[Path, str, int]:
    """Salva `data` dentro `MEDICAL_DOCUMENTS_DIR` come `{sha256}.pdf`.
    Ritorna (absolute_path, relative_path, size_bytes). Idempotente."""
    sha = compute_sha256(data)
    base_dir = settings.medical_documents_dir
    base_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(original_filename).suffix.lower() or ".pdf"
    filename = f"{sha}{suffix}"
    full_path = base_dir / filename
    if not full_path.exists():
        full_path.write_bytes(data)
    return full_path, filename, len(data)


# ---------------------------------------------------------------------------
# 2. Estrazione testo grezzo (per la ricerca full-text)
# ---------------------------------------------------------------------------

def extract_text(pdf_bytes: bytes) -> str:
    """Estrae il testo grezzo del PDF via pdfplumber. Ritorna stringa vuota
    se il PDF e' scannerizzato (niente layer testo) o l'estrazione fallisce."""
    try:
        import pdfplumber
        parts: list[str] = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                txt = page.extract_text() or ""
                if txt:
                    parts.append(txt)
        return "\n".join(parts).strip()
    except Exception:
        logger.debug("medical_docs: estrazione testo fallita", exc_info=True)
        return ""


def is_searchable(text_extracted: str) -> bool:
    """True se il PDF ha gia' un layer di testo utile (non e' scansionato)."""
    return len(text_extracted.strip()) >= 30


def ocr_pdf(pdf_bytes: bytes) -> bytes | None:
    """Converte un PDF scansionato in un PDF cercabile aggiungendo un layer
    di testo OCR (ocrmypdf + tesseract, lingua ita+eng). Ritorna i nuovi
    bytes del PDF, o `None` se l'OCR fallisce. `skip_text=True` lascia
    intatte le pagine che hanno gia' del testo (PDF misti)."""
    try:
        import ocrmypdf
        with tempfile.NamedTemporaryFile(suffix=".pdf") as inp, \
             tempfile.NamedTemporaryFile(suffix=".pdf") as outp:
            inp.write(pdf_bytes)
            inp.flush()
            ocrmypdf.ocr(
                inp.name,
                outp.name,
                language="ita+eng",
                skip_text=True,
                progress_bar=False,
                optimize=0,
            )
            outp.seek(0)
            return outp.read()
    except Exception:
        logger.warning("medical_docs: OCR del PDF fallito", exc_info=True)
        return None


# ---------------------------------------------------------------------------
# 3. Chiamata LLM
# ---------------------------------------------------------------------------

def call_llm(
    pdf_bytes: bytes,
    section: str,
    categories: list[str],
    include_summary: bool = False,
) -> dict[str, Any]:
    """Chiama Anthropic passando il PDF come blocco `document` e parsa la
    risposta JSON di soli metadati. Solleva `RuntimeError` su fallimento."""
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY non configurata")
    from anthropic import Anthropic

    client = Anthropic(api_key=settings.anthropic_api_key)
    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("ascii")
    resp = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=MAX_LLM_TOKENS * 2 if include_summary else MAX_LLM_TOKENS,
        system=build_system_prompt(section, categories, include_summary=include_summary),
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": pdf_b64,
                    },
                },
                {
                    "type": "text",
                    "text": "Estrai i metadati di questo documento secondo le regole del system prompt.",
                },
            ],
        }],
    )
    body = "".join(
        block.text for block in resp.content if getattr(block, "type", None) == "text"
    ).strip()
    if body.startswith("```"):
        body = body.strip("`")
        first_nl = body.find("\n")
        if first_nl != -1 and not body[:first_nl].strip().startswith("{"):
            body = body[first_nl + 1:]
        body = body.rsplit("```", 1)[0].strip()
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Risposta LLM non e' JSON valido: {exc}\nBody: {body[:300]!r}") from exc


def parse_extracted_meta(payload: dict[str, Any]) -> ExtractedMeta:
    doc_date: date | None = None
    raw_date = payload.get("doc_date")
    if raw_date:
        try:
            doc_date = date.fromisoformat(str(raw_date))
        except (TypeError, ValueError):
            doc_date = None
    return ExtractedMeta(
        doc_date=doc_date,
        suggested_category=_clean_str(payload.get("suggested_category")),
        title=_clean_str(payload.get("title")),
        facility_name=_clean_str(payload.get("facility_name")),
        doctor_name=_clean_str(payload.get("doctor_name")),
        summary=_clean_str(payload.get("summary")),
    )


def _clean_str(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None
