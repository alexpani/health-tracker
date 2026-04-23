"""Pipeline di ingest per un referto PDF.

Step (spec §5.1):
  1. Estrazione testo con pdfplumber (PDF testuali).
  2. Chiamata Anthropic (system prompt IT, temp=0) → JSON strutturato.
  3. Matching raw_name → analyte_id via alias esatti + pg_trgm similarity.

La chiamata LLM è isolata dietro `call_llm()` per poter essere mockata nei test.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import pdfplumber
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

SYSTEM_PROMPT = """Sei un parser di referti medici italiani. Ricevi il testo grezzo di un referto
di analisi del sangue e/o delle urine. Estrai esattamente:
- test_date (ISO YYYY-MM-DD, la data del prelievo, non la data di refertazione)
- lab_name (nome del laboratorio, stringa)
- specimen_types (array tra "blood", "urine")
- analytes: array di { raw_name, value_raw, unit_raw, ref_range_raw }
  dove value_raw è la stringa esatta del valore (può essere numero o testo
  come "assente", "tracce", "++", "negativo"); ref_range_raw è la stringa
  esatta del range come riportato nel referto, se presente.

Regole:
- Non normalizzare nulla. Non tradurre. Non inferire valori.
- Se un campo manca, usa null.
- Rispondi SOLO con JSON valido, niente testo prima o dopo, niente markdown."""

TRGM_SIMILARITY_THRESHOLD = 0.6
MAX_LLM_TOKENS = 4096


# ---------------------------------------------------------------------------
# Dataclasses intermedi
# ---------------------------------------------------------------------------

@dataclass
class ExtractedAnalyte:
    raw_name: str
    value_raw: str | None
    unit_raw: str | None
    ref_range_raw: str | None


@dataclass
class ExtractedPanel:
    test_date: date | None
    lab_name: str | None
    specimen_types: list[str]
    analytes: list[ExtractedAnalyte]


@dataclass
class MatchedResult:
    """Un risultato dopo matching alias. `analyte_id=None` → needs manual review."""
    raw_name: str
    value_numeric: Decimal | None
    value_text: str | None
    unit_raw: str | None
    ref_low_raw: Decimal | None
    ref_high_raw: Decimal | None
    ref_text_raw: str | None
    analyte_id: int | None
    needs_review: bool


# ---------------------------------------------------------------------------
# 1. Hash + salvataggio file
# ---------------------------------------------------------------------------

def compute_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_document(data: bytes, original_filename: str) -> tuple[Path, str, int]:
    """Salva `data` in un file dentro `LAB_DOCUMENTS_DIR`. Ritorna
    (absolute_path, relative_path, size_bytes). Il nome è `{sha256}.pdf`
    per deduplicare naturalmente e avere path idempotenti.
    """
    sha = compute_sha256(data)
    base_dir = settings.lab_documents_dir
    base_dir.mkdir(parents=True, exist_ok=True)
    # Estrai estensione originale, fallback .pdf
    suffix = Path(original_filename).suffix.lower() or ".pdf"
    filename = f"{sha}{suffix}"
    full_path = base_dir / filename
    if not full_path.exists():
        full_path.write_bytes(data)
    return full_path, filename, len(data)


# ---------------------------------------------------------------------------
# 2. Estrazione testo
# ---------------------------------------------------------------------------

def extract_text_from_pdf(path: Path) -> str:
    """Estrae il testo di tutte le pagine, separate da form-feed."""
    chunks: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            txt = page.extract_text() or ""
            chunks.append(txt)
    return "\n\f\n".join(chunks)


# ---------------------------------------------------------------------------
# 3. Chiamata LLM
# ---------------------------------------------------------------------------

def call_llm(raw_text: str) -> dict[str, Any]:
    """Chiama Anthropic e parsa la risposta JSON.

    Restituisce il dict grezzo `{test_date, lab_name, specimen_types, analytes}`.
    Può sollevare `RuntimeError` se la risposta non è JSON valido: il chiamante
    deve decidere se marcare il panel come `parsing_failed`.

    Isolata in una funzione modulare per permettere il mocking nei test.
    """
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY non configurata")
    # Import locale: durante i test questo modulo non viene mai caricato.
    from anthropic import Anthropic

    client = Anthropic(api_key=settings.anthropic_api_key)
    resp = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=MAX_LLM_TOKENS,
        temperature=0,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": raw_text}],
    )
    # La risposta è in resp.content[0].text per messaggi text-only.
    body = "".join(
        block.text for block in resp.content if getattr(block, "type", None) == "text"
    )
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Risposta LLM non è JSON valido: {exc}") from exc


# ---------------------------------------------------------------------------
# Normalizzazione output LLM
# ---------------------------------------------------------------------------

def parse_extracted_panel(payload: dict[str, Any]) -> ExtractedPanel:
    test_date = None
    raw_date = payload.get("test_date")
    if raw_date:
        try:
            test_date = date.fromisoformat(raw_date)
        except (TypeError, ValueError):
            test_date = None

    specimen_types = payload.get("specimen_types") or []
    if not isinstance(specimen_types, list):
        specimen_types = []

    analytes_in = payload.get("analytes") or []
    analytes: list[ExtractedAnalyte] = []
    for a in analytes_in:
        if not isinstance(a, dict):
            continue
        raw_name = (a.get("raw_name") or "").strip()
        if not raw_name:
            continue
        analytes.append(ExtractedAnalyte(
            raw_name=raw_name,
            value_raw=_clean_str(a.get("value_raw")),
            unit_raw=_clean_str(a.get("unit_raw")),
            ref_range_raw=_clean_str(a.get("ref_range_raw")),
        ))

    return ExtractedPanel(
        test_date=test_date,
        lab_name=_clean_str(payload.get("lab_name")),
        specimen_types=[s for s in specimen_types if s in ("blood", "urine")],
        analytes=analytes,
    )


def _clean_str(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


# ---------------------------------------------------------------------------
# 4. Matching analita + parsing valori
# ---------------------------------------------------------------------------

_NUMBER_RE = re.compile(r"^-?\d+(?:[.,]\d+)?$")
_RANGE_SIMPLE_RE = re.compile(
    r"^\s*(-?\d+(?:[.,]\d+)?)\s*[-–—]\s*(-?\d+(?:[.,]\d+)?)\s*$"
)


def parse_value(raw: str | None) -> tuple[Decimal | None, str | None]:
    """`(value_numeric, value_text)`. Se `raw` è numerico (anche con virgola
    italiana) lo ritorna come Decimal; altrimenti come testo."""
    if raw is None:
        return None, None
    s = raw.strip()
    if not s:
        return None, None
    if _NUMBER_RE.match(s):
        try:
            return Decimal(s.replace(",", ".")), None
        except InvalidOperation:
            pass
    return None, s


def parse_ref_range(raw: str | None) -> tuple[Decimal | None, Decimal | None, str | None]:
    """Splitta un range `a - b` (anche con virgola IT) in `(low, high, None)`.
    Se non è un range numerico ritorna `(None, None, raw)`."""
    if raw is None:
        return None, None, None
    s = raw.strip()
    if not s:
        return None, None, None
    m = _RANGE_SIMPLE_RE.match(s)
    if m:
        try:
            return (
                Decimal(m.group(1).replace(",", ".")),
                Decimal(m.group(2).replace(",", ".")),
                None,
            )
        except InvalidOperation:
            pass
    return None, None, s


async def match_analyte(
    db: AsyncSession, raw_name: str
) -> int | None:
    """Tenta di mappare `raw_name` a un `lab_analytes.id`:
    1. Exact match case-insensitive su `lab_analyte_aliases`.
    2. Similarity trigram `> TRGM_SIMILARITY_THRESHOLD` (pg_trgm).
    """
    # 1) exact
    exact = await db.execute(
        text(
            "SELECT analyte_id FROM lab_analyte_aliases "
            "WHERE LOWER(alias) = LOWER(:n) LIMIT 1"
        ),
        {"n": raw_name},
    )
    row = exact.first()
    if row is not None:
        return row[0]

    # 2) trigram similarity (richiede pg_trgm, creato dalla migration 07a1b2c3d4e5)
    trg = await db.execute(
        text(
            "SELECT analyte_id, similarity(LOWER(alias), LOWER(:n)) AS s "
            "FROM lab_analyte_aliases "
            "WHERE similarity(LOWER(alias), LOWER(:n)) > :th "
            "ORDER BY s DESC LIMIT 1"
        ),
        {"n": raw_name, "th": TRGM_SIMILARITY_THRESHOLD},
    )
    row = trg.first()
    return row[0] if row else None


async def build_matched_results(
    db: AsyncSession, analytes: list[ExtractedAnalyte]
) -> list[MatchedResult]:
    out: list[MatchedResult] = []
    for a in analytes:
        aid = await match_analyte(db, a.raw_name)
        v_num, v_text = parse_value(a.value_raw)
        rl, rh, rtxt = parse_ref_range(a.ref_range_raw)
        out.append(MatchedResult(
            raw_name=a.raw_name,
            value_numeric=v_num,
            value_text=v_text,
            unit_raw=a.unit_raw,
            ref_low_raw=rl,
            ref_high_raw=rh,
            ref_text_raw=rtxt,
            analyte_id=aid,
            needs_review=True,  # sempre True al draft; confirm lo abbasserà
        ))
    return out
