"""Pipeline di ingest per un referto PDF.

Step:
  1. Hash SHA-256 + salvataggio file nel volume (`lab_documents/<sha>.pdf`).
  2. Invio del PDF ad Anthropic come blocco `document` (base64): il modello
     gestisce sia PDF testuali che scannerizzati (OCR interno) e risponde
     con il JSON strutturato richiesto dal system prompt.
  3. Matching raw_name → analyte_id via alias esatti + pg_trgm similarity.

La chiamata LLM è isolata dietro `call_llm()` per poter essere mockata nei test.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

SYSTEM_PROMPT_BASE = """Sei un parser di referti medici italiani. Ricevi un referto di analisi
del sangue e/o delle urine (PDF testuale o scannerizzato, fai OCR se serve).

Estrai esattamente:
- test_date (ISO YYYY-MM-DD, la data del prelievo, non la data di refertazione)
- lab_name (nome del laboratorio, stringa)
- specimen_types (array tra "blood", "urine")
- analytes: array di oggetti con campi:
    - raw_name: il nome dell'analita come riportato nel referto, senza modifiche
    - value_raw: stringa esatta del valore (numero o testo come "assente",
      "tracce", "++", "negativo", "giallo paglierino")
    - unit_raw: stringa esatta dell'unità se presente
    - ref_range_raw: stringa esatta del range di riferimento se presente
    - suggested_slug: lo slug di un analita del catalogo qui sotto che
      corrisponde concettualmente all'analita estratto, altrimenti null

Regole generali:
- Non tradurre e non normalizzare valori, unità o nomi.
- Per i referti delle urine, usa i nomi canonici italiani anche per valori
  qualitativi (es. "assente", "tracce", "+", "++", "+++", "++++", "negativo",
  "positivo", "raro", "presente").
- Se un campo manca, usa null.
- Ogni analita presente nel referto deve comparire nell'output, anche se
  suggested_slug è null.
- Per `suggested_slug` usa SOLO uno degli slug presenti nel catalogo fornito.
- Rispondi SOLO con JSON valido, niente testo prima o dopo, niente markdown."""


def build_system_prompt(catalog: list[dict[str, Any]]) -> str:
    """Appende il catalogo al system prompt così il modello può suggerire lo
    slug corretto per ciascun analita estratto.

    `catalog`: lista di dict con chiavi `slug`, `display_name_it`, `category`,
    `specimen`, e opzionalmente `aliases` (lista di stringhe).
    """
    if not catalog:
        return SYSTEM_PROMPT_BASE
    lines = ["", "CATALOGO ANALITI (slug | campione | nome | sinonimi):"]
    for a in catalog:
        aliases = a.get("aliases") or []
        alias_str = ", ".join(aliases[:6])
        lines.append(
            f"- {a['slug']} | {a['specimen']} | {a['display_name_it']}"
            + (f" | {alias_str}" if alias_str else "")
        )
    return SYSTEM_PROMPT_BASE + "\n" + "\n".join(lines)

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
    suggested_slug: str | None = None


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
# 2. Chiamata LLM col PDF come input diretto (gestisce anche referti scannerizzati)
# ---------------------------------------------------------------------------

def call_llm(pdf_bytes: bytes, catalog: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Chiama Anthropic passando il PDF direttamente come blocco `document`
    e parsa la risposta JSON. Il modello gestisce sia PDF testuali che
    scannerizzati (OCR interno).

    `catalog`: elenco di analiti (slug, display_name_it, specimen, aliases)
    accoded al system prompt così il modello può suggerire lo slug giusto.

    Restituisce il dict grezzo `{test_date, lab_name, specimen_types, analytes}`.
    Solleva `RuntimeError` se la risposta non è JSON valido.
    """
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY non configurata")
    # Import locale: durante i test questo modulo non viene mai caricato.
    from anthropic import Anthropic

    client = Anthropic(api_key=settings.anthropic_api_key)
    pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("ascii")
    system_prompt = build_system_prompt(catalog or [])
    # N.B. `temperature` è deprecato su Opus 4.7 — lasciamo il default del
    # modello (deterministico a temp fissa interna).
    resp = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=MAX_LLM_TOKENS,
        system=system_prompt,
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
                    "text": "Estrai gli analiti da questo referto secondo le regole del system prompt.",
                },
            ],
        }],
    )
    body = "".join(
        block.text for block in resp.content if getattr(block, "type", None) == "text"
    )
    # Alcuni modelli avvolgono il JSON in un codice-fence: strip se presente.
    body = body.strip()
    if body.startswith("```"):
        body = body.strip("`")
        # Rimuovi eventuale `json\n` iniziale
        first_nl = body.find("\n")
        if first_nl != -1 and not body[:first_nl].strip().startswith("{"):
            body = body[first_nl + 1 :]
        body = body.rsplit("```", 1)[0].strip()
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Risposta LLM non è JSON valido: {exc}\nBody: {body[:500]!r}") from exc


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
            suggested_slug=_clean_str(a.get("suggested_slug")),
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
    db: AsyncSession, raw_name: str, suggested_slug: str | None = None,
) -> int | None:
    """Tenta di mappare `raw_name` a un `lab_analytes.id`:
    1. Se il LLM ha fornito `suggested_slug`, proviamo prima quello.
    2. Exact match case-insensitive su `lab_analyte_aliases`.
    3. Similarity trigram `> TRGM_SIMILARITY_THRESHOLD` (pg_trgm).
    """
    # 0) slug suggerito dal LLM (catalog-aware)
    if suggested_slug:
        sug = await db.execute(
            text("SELECT id FROM lab_analytes WHERE slug = :s LIMIT 1"),
            {"s": suggested_slug},
        )
        row = sug.first()
        if row is not None:
            return row[0]

    # 1) exact alias
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
        aid = await match_analyte(db, a.raw_name, a.suggested_slug)
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


async def load_catalog_for_llm(db: AsyncSession) -> list[dict[str, Any]]:
    """Carica il catalogo analiti + alias in un formato compatto pronto per
    il system prompt. Serve a far "vedere" al modello tutti gli analiti
    disponibili così può restituire `suggested_slug` azzeccati."""
    analyte_rows = (await db.execute(
        text(
            "SELECT id, slug, display_name_it, specimen FROM lab_analytes "
            "ORDER BY specimen, category, display_name_it"
        )
    )).all()
    analytes = [
        {
            "id": r[0],
            "slug": r[1],
            "display_name_it": r[2],
            "specimen": r[3],
            "aliases": [],
        }
        for r in analyte_rows
    ]
    by_id = {a["id"]: a for a in analytes}
    alias_rows = (await db.execute(
        text("SELECT analyte_id, alias FROM lab_analyte_aliases")
    )).all()
    for aid, alias in alias_rows:
        if aid in by_id:
            by_id[aid]["aliases"].append(alias)
    # Rimuovi l'id dal dict ritornato (il prompt non ne ha bisogno)
    return [
        {k: v for k, v in a.items() if k != "id"}
        for a in analytes
    ]
