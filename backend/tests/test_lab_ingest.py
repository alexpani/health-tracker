"""Test della pipeline di ingest referti (PR #2a).

- `parse_value` / `parse_ref_range`: parsing deterministico (no DB)
- `match_analyte`: richiede il DB reale perché usa pg_trgm
- pipeline full via router POST /ingest con Anthropic mockata e PDF reale
"""
from __future__ import annotations

import io
import json
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.services import lab_ingest
from app.services.lab_ingest import ExtractedPanel

pytestmark = pytest.mark.asyncio

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "lab"
CDR_PDF = FIXTURE_DIR / "cdr_20260318.pdf"


# ---------------------------------------------------------------------------
# Puro (nessun DB, nessun network)
# ---------------------------------------------------------------------------

def test_parse_value_italian_decimal():
    v, t = lab_ingest.parse_value("27,62")
    assert v == Decimal("27.62") and t is None

    v, t = lab_ingest.parse_value("90")
    assert v == Decimal("90") and t is None

    v, t = lab_ingest.parse_value("assente")
    assert v is None and t == "assente"

    v, t = lab_ingest.parse_value(None)
    assert v is None and t is None


def test_parse_ref_range():
    low, high, txt = lab_ingest.parse_ref_range("65 - 100")
    assert low == Decimal("65") and high == Decimal("100") and txt is None

    low, high, txt = lab_ingest.parse_ref_range("3,5 - 7,2")
    assert low == Decimal("3.5") and high == Decimal("7.2") and txt is None

    low, high, txt = lab_ingest.parse_ref_range("Superiore a 35")
    assert low is None and high is None and txt == "Superiore a 35"

    low, high, txt = lab_ingest.parse_ref_range(None)
    assert (low, high, txt) == (None, None, None)


def test_parse_extracted_panel_filters_invalid_specimens():
    ep = lab_ingest.parse_extracted_panel({
        "test_date": "2026-03-18",
        "lab_name": "CDR",
        "specimen_types": ["blood", "spam"],
        "analytes": [
            {"raw_name": "TSH", "value_raw": "1.2", "unit_raw": "µUI/ml",
             "ref_range_raw": "0.4 - 4.0"},
            {"raw_name": "", "value_raw": "nope"},  # skip: raw_name vuoto
            "garbage",  # skip: non dict
        ],
    })
    assert ep.lab_name == "CDR"
    assert ep.specimen_types == ["blood"]
    assert len(ep.analytes) == 1
    assert ep.analytes[0].raw_name == "TSH"


# ---------------------------------------------------------------------------
# Hash + save su disco (no DB)
# ---------------------------------------------------------------------------

def test_save_document_dedup(tmp_path, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "lab_documents_dir", tmp_path)

    data = b"%PDF-1.4\n%fake"
    p1, rel1, size1 = lab_ingest.save_document(data, "referto.pdf")
    p2, rel2, size2 = lab_ingest.save_document(data, "referto.pdf")

    assert p1 == p2 and rel1 == rel2 and size1 == size2 == len(data)
    assert p1.exists()
    # Il filename è basato sull'hash → stesso contenuto, stesso path
    assert rel1.endswith(".pdf")


# ---------------------------------------------------------------------------
# pg_trgm matching — richiede il DB di test con le migration lab applicate.
# Le migrations non girano in conftest (usiamo create_all), quindi inseriamo
# le righe a mano e creiamo ad hoc l'extension per questo test.
# ---------------------------------------------------------------------------

async def test_match_analyte_exact_and_trigram(db_session, engine):
    # Abilita pg_trgm (idempotente).
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    # Popola un analita + alias minimale per il test.
    await db_session.execute(text(
        "INSERT INTO lab_analytes (slug, display_name_it, category, specimen, value_type) "
        "VALUES ('tsh', 'TSH', 'ormoni', 'blood', 'numeric')"
    ))
    aid_row = await db_session.execute(text(
        "SELECT id FROM lab_analytes WHERE slug='tsh'"
    ))
    aid = aid_row.scalar_one()
    await db_session.execute(
        text("INSERT INTO lab_analyte_aliases (analyte_id, alias) VALUES (:aid, :a)"),
        [{"aid": aid, "a": "TSH"}, {"aid": aid, "a": "Tireotropina"}],
    )
    await db_session.commit()

    # Exact (case-insensitive)
    match = await lab_ingest.match_analyte(db_session, "tsh")
    assert match == aid

    # Trigram: "Tireotropina " con spazio / "Tireotropin" troncato
    match = await lab_ingest.match_analyte(db_session, "Tireotropin")
    assert match == aid

    # Nessun match
    match = await lab_ingest.match_analyte(db_session, "Coso inesistente XYZ")
    assert match is None


# ---------------------------------------------------------------------------
# End-to-end: POST /ingest con PDF reale + Anthropic mockata
# ---------------------------------------------------------------------------

# JSON che simula la risposta dell'LLM per cdr_20260318.pdf.
MOCK_LLM_PAYLOAD = {
    "test_date": "2026-03-18",
    "lab_name": "C.D.R. - Laboratorio Analisi Medicina Nucleare",
    "specimen_types": ["blood"],
    "analytes": [
        {"raw_name": "GLICEMIA", "value_raw": "90", "unit_raw": "mg/dl",
         "ref_range_raw": "65 - 100"},
        {"raw_name": "COLESTEROLO", "value_raw": "157", "unit_raw": "mg/dl",
         "ref_range_raw": "80 - 200"},
        {"raw_name": "COLESTEROLO HDL", "value_raw": "52", "unit_raw": "mg/dl",
         "ref_range_raw": "Superiore a 35"},
        {"raw_name": "COLESTEROLO LDL", "value_raw": "90", "unit_raw": "mg/dl",
         "ref_range_raw": "38 - 150"},
        {"raw_name": "TRIGLICERIDI", "value_raw": "167", "unit_raw": "mg/dl",
         "ref_range_raw": "35 - 170"},
        {"raw_name": "URICEMIA", "value_raw": "4.9", "unit_raw": "mg/dl",
         "ref_range_raw": "3.5 - 7.2"},
        {"raw_name": "TRANSAMINASI GOT (AST)", "value_raw": "42",
         "unit_raw": "U/l", "ref_range_raw": "0.0 - 37.0"},
        {"raw_name": "TRANSAMINASI GPT (ALT)", "value_raw": "43",
         "unit_raw": "U/l", "ref_range_raw": "0.0 - 40.0"},
        {"raw_name": "VES prima ora", "value_raw": "6", "unit_raw": None,
         "ref_range_raw": "fino a 12"},
        {"raw_name": "PSA TOTALE", "value_raw": "0.78", "unit_raw": "ng/ml",
         "ref_range_raw": "0.0 - 4.0"},
        {"raw_name": "PSA LIBERO", "value_raw": "0.26", "unit_raw": "ng/ml",
         "ref_range_raw": None},
        {"raw_name": "RAPP.PSA LIBERO/PSA TOT", "value_raw": "33.33",
         "unit_raw": "%", "ref_range_raw": None},
        {"raw_name": "TESTOSTERONE", "value_raw": "2.90", "unit_raw": "ng/ml",
         "ref_range_raw": "2.0 - 10.0"},
        {"raw_name": "TESTOSTERONE LIBERO", "value_raw": "24.99",
         "unit_raw": "pg/ml", "ref_range_raw": "15.0 - 50.00"},
        {"raw_name": "VIT.D (25OH VITD)", "value_raw": "27,62",
         "unit_raw": "ng/ml",
         "ref_range_raw": "0 - 10 carenza, 10 - 30 carenza moderata, "
                          "30 - 50 valori normali in inverno, "
                          "30 - 100 valori normali in estate"},
    ],
}


async def _apply_migrations_for_lab(engine):
    """Run the lab schema migrations in create_all-friendly mode: the
    conftest already created the tables via Base.metadata; here we just
    need pg_trgm + il seed analytes. Seed minimale sufficiente per matchare
    i raw_name del referto CDR."""
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    # Seed minimale degli analiti che il referto CDR toccherà
    seed: list[tuple[str, str, str, str, list[str]]] = [
        ('glucose', 'Glicemia', 'metabolismo', 'blood',
            ['Glicemia', 'GLICEMIA']),
        ('cholesterol_total', 'Colesterolo totale', 'lipidi', 'blood',
            ['Colesterolo', 'COLESTEROLO', 'Colesterolo totale']),
        ('cholesterol_hdl', 'Colesterolo HDL', 'lipidi', 'blood',
            ['Colesterolo HDL', 'HDL']),
        ('cholesterol_ldl', 'Colesterolo LDL', 'lipidi', 'blood',
            ['Colesterolo LDL', 'LDL']),
        ('triglycerides', 'Trigliceridi', 'lipidi', 'blood',
            ['Trigliceridi', 'TRIGLICERIDI']),
        ('uric_acid', 'Acido urico', 'metabolismo', 'blood',
            ['Uricemia', 'URICEMIA', 'Acido urico']),
        ('ast', 'AST (GOT)', 'fegato', 'blood',
            ['AST', 'GOT', 'Transaminasi GOT (AST)']),
        ('alt', 'ALT (GPT)', 'fegato', 'blood',
            ['ALT', 'GPT', 'Transaminasi GPT (ALT)']),
        ('esr', 'VES', 'infiammazione', 'blood', ['VES', 'ESR']),
        ('psa_total', 'PSA totale', 'oncologici', 'blood',
            ['PSA totale', 'PSA TOTALE', 'PSA']),
        ('psa_free', 'PSA libero', 'oncologici', 'blood',
            ['PSA libero', 'PSA LIBERO']),
        ('psa_ratio_free_total', 'Rapporto PSA libero/totale',
            'oncologici', 'blood',
            ['Rapp.PSA libero/PSA tot', 'Rapporto PSA libero/totale']),
        ('testosterone_total', 'Testosterone totale', 'ormoni', 'blood',
            ['Testosterone', 'TESTOSTERONE']),
        ('testosterone_free', 'Testosterone libero', 'ormoni', 'blood',
            ['Testosterone libero', 'TESTOSTERONE LIBERO']),
        ('vit_d_25oh', 'Vitamina D 25-OH', 'vitamine', 'blood',
            ['Vit.D (25OH VitD)', '25-OH vit. D', 'Vitamina D']),
    ]
    async with engine.begin() as conn:
        for slug, name, cat, spec, aliases in seed:
            aid_row = await conn.execute(text(
                "INSERT INTO lab_analytes (slug, display_name_it, category, "
                "specimen, value_type) VALUES (:slug, :name, :cat, :spec, 'numeric') "
                "RETURNING id"
            ), {"slug": slug, "name": name, "cat": cat, "spec": spec})
            aid = aid_row.scalar_one()
            for a in aliases:
                await conn.execute(
                    text("INSERT INTO lab_analyte_aliases (analyte_id, alias) "
                         "VALUES (:aid, :a)"),
                    {"aid": aid, "a": a},
                )


async def test_ingest_end_to_end_with_real_pdf(engine, db_session, monkeypatch, tmp_path):
    if not CDR_PDF.exists():
        pytest.skip(f"fixture PDF mancante: {CDR_PDF}")

    await _apply_migrations_for_lab(engine)

    from app.config import settings
    monkeypatch.setattr(settings, "lab_documents_dir", tmp_path)

    # Mock della chiamata LLM: bypassa Anthropic completamente.
    def fake_call_llm(raw_text: str):
        return MOCK_LLM_PAYLOAD

    monkeypatch.setattr(lab_ingest, "call_llm", fake_call_llm)

    # Import tardivo: FastAPI wiring dipende dalle dep che potrebbero
    # non essere installate in altri test.
    from app.main import app
    from app.database import get_db

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            with CDR_PDF.open("rb") as f:
                r = await c.post(
                    "/api/v1/lab/ingest",
                    files={"file": ("cdr_20260318.pdf", f, "application/pdf")},
                )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "draft"
        assert body["test_date"] == "2026-03-18"
        assert body["specimen_types"] == ["blood"]
        assert body["analytes_count"] == 15
        # La maggior parte dei 15 raw_name deve mappare su analiti del seed.
        assert body["unmatched_count"] <= 2
        assert body["parsing_failed"] is False

        # Detail endpoint — verifica che i numeric siano parsed
        panel_id = body["panel_id"]
        detail = (await c.get(f"/api/v1/lab/panels/{panel_id}")).json()
        assert len(detail["results"]) == 15
        glucose = next(r for r in detail["results"] if r["raw_name"] == "GLICEMIA")
        assert glucose["value_numeric"] == 90.0
        assert glucose["ref_low_raw"] == 65.0 and glucose["ref_high_raw"] == 100.0
        vitd = next(r for r in detail["results"] if r["raw_name"] == "VIT.D (25OH VITD)")
        assert vitd["value_numeric"] == 27.62  # virgola IT
    finally:
        app.dependency_overrides.clear()
