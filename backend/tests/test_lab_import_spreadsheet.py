"""Test dell'import spreadsheet (PR #5).

- `parse_cell` / `parse_header_date`: unit puri.
- End-to-end: xlsx sintetico generato via openpyxl → dry-run report + commit
  path con session_factory iniettata.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from openpyxl import Workbook
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.lab import LabPanel, LabResult
from scripts.import_spreadsheet_lab import (
    import_spreadsheet,
    parse_cell,
    parse_header_date,
)

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Unit puri
# ---------------------------------------------------------------------------

def test_parse_cell_numeric_plain():
    p = parse_cell("90")
    assert p is not None and p.value_numeric == Decimal("90") and p.unit_raw is None
    p = parse_cell(90)
    assert p is not None and p.value_numeric == Decimal("90")


def test_parse_cell_italian_decimal():
    p = parse_cell("27,62")
    assert p is not None and p.value_numeric == Decimal("27.62")


def test_parse_cell_value_with_inline_unit():
    p = parse_cell("3,02 pg/ml")
    assert p is not None
    assert p.value_numeric == Decimal("3.02")
    assert p.unit_raw == "pg/ml"


def test_parse_cell_text():
    p = parse_cell("assente")
    assert p is not None and p.value_text == "assente" and p.value_numeric is None
    assert parse_cell("") is None
    assert parse_cell(None) is None


def test_parse_header_date_variants():
    assert parse_header_date(date(2026, 3, 18)) == date(2026, 3, 18)
    assert parse_header_date("18/03/26") == date(2026, 3, 18)
    assert parse_header_date("18/03/2026") == date(2026, 3, 18)
    assert parse_header_date("2026-03-18") == date(2026, 3, 18)
    assert parse_header_date("") is None
    assert parse_header_date("not a date") is None


# ---------------------------------------------------------------------------
# End-to-end con xlsx sintetico
# ---------------------------------------------------------------------------

def _write_synthetic_xlsx(path: Path) -> None:
    """3 colonne di date + 4 righe analiti + 1 riga Note.

    |             | 15/01/25 | 20/06/25 | 18/03/26 |
    | GLICEMIA    | 88       | 95       | 105      |
    | Colesterolo | 180      |          | 157      |
    | TSH         | 1,20     | 1,80     | 2,10     |
    | Coso strano | 42       |          |          |
    | Note        | primo    |          | digiuno  |
    """
    wb = Workbook()
    ws = wb.active
    if ws is None:
        raise RuntimeError("no active sheet")
    ws.title = "Analisi"
    ws.append(["", date(2025, 1, 15), date(2025, 6, 20), date(2026, 3, 18)])
    ws.append(["GLICEMIA", 88, 95, 105])
    ws.append(["Colesterolo", 180, None, 157])
    ws.append(["TSH", "1,20", "1,80", "2,10"])
    ws.append(["Coso strano non mappato", 42, None, None])
    ws.append(["Note", "primo controllo", None, "a digiuno"])
    wb.save(path)


async def _seed_minimal_catalog(db_session):
    await db_session.execute(text(
        "INSERT INTO lab_analytes (slug, display_name_it, category, specimen, "
        "value_type, unit_canonical, ref_low, ref_high) VALUES "
        "('glu_imp','Glicemia','metabolismo','blood','numeric','mg/dl',70,100),"
        "('chol_imp','Colesterolo','lipidi','blood','numeric','mg/dl',0,200),"
        "('tsh_imp','TSH','ormoni','blood','numeric','µUI/ml',0.4,4.0)"
    ))
    rows = (await db_session.execute(text(
        "SELECT id, slug FROM lab_analytes WHERE slug IN "
        "('glu_imp','chol_imp','tsh_imp')"
    ))).all()
    ids = {slug: rid for rid, slug in rows}
    await db_session.execute(
        text("INSERT INTO lab_analyte_aliases (analyte_id, alias) VALUES "
             "(:g1,'GLICEMIA'),(:g2,'Glicemia'),"
             "(:c1,'Colesterolo'),(:c2,'COLESTEROLO'),"
             "(:t1,'TSH')"),
        {
            "g1": ids["glu_imp"], "g2": ids["glu_imp"],
            "c1": ids["chol_imp"], "c2": ids["chol_imp"],
            "t1": ids["tsh_imp"],
        },
    )
    await db_session.commit()


async def test_dry_run_produces_report(db_session, engine, tmp_path):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    await _seed_minimal_catalog(db_session)

    xlsx = tmp_path / "storico.xlsx"
    _write_synthetic_xlsx(xlsx)

    # Session factory che riusa la nostra db_session (rollback-based)
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def factory():
        yield db_session

    report = await import_spreadsheet(xlsx, sheet_name="Analisi", commit=False,
                                       session_factory=factory)
    assert len(report.panels) == 3
    # Matching: 3 analiti su 4 righe mappati (GLICEMIA, Colesterolo, TSH); il 4° no
    rows_by_name = {r.raw_name: r for r in report.rows}
    assert rows_by_name["GLICEMIA"].analyte_slug == "glu_imp"
    assert rows_by_name["Colesterolo"].analyte_slug == "chol_imp"
    assert rows_by_name["TSH"].analyte_slug == "tsh_imp"
    assert rows_by_name["Coso strano non mappato"].analyte_id is None
    # Unmapped rows
    unmapped = report.unmapped_rows()
    assert len(unmapped) == 1
    assert unmapped[0].raw_name == "Coso strano non mappato"
    # Note per colonne
    notes = {p.col_letter: p.notes for p in report.panels}
    assert notes["B"] == "primo controllo"
    assert notes["D"] == "a digiuno"
    # Dry-run: nessun panel/result scritti
    cnt = (await db_session.execute(text("SELECT COUNT(*) FROM lab_panels"))).scalar_one()
    assert cnt == 0


async def test_commit_inserts_panels_and_results(db_session, engine, tmp_path):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    await _seed_minimal_catalog(db_session)

    xlsx = tmp_path / "storico.xlsx"
    _write_synthetic_xlsx(xlsx)

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def factory():
        yield db_session

    await import_spreadsheet(xlsx, sheet_name="Analisi", commit=True,
                              session_factory=factory)

    # 3 panel, tutti confirmed
    panels = (await db_session.execute(
        text("SELECT id, test_date, status, notes FROM lab_panels ORDER BY test_date")
    )).all()
    assert len(panels) == 3
    assert all(p.status == "confirmed" for p in panels)
    notes = {str(p.test_date): p.notes for p in panels}
    assert notes["2025-01-15"] == "primo controllo"
    assert notes["2026-03-18"] == "a digiuno"

    # Il panel del 2025-06-20 ha 2 valori (glicemia, TSH — coso strano è None)
    june_panel = next(p for p in panels if str(p.test_date) == "2025-06-20")
    june_results = (await db_session.execute(
        text("SELECT raw_name, value_numeric, needs_review FROM lab_results "
             "WHERE panel_id = :p"), {"p": june_panel.id}
    )).all()
    assert len(june_results) == 2
    # TSH "1,80" → Decimal("1.80")
    tsh_row = next(r for r in june_results if r.raw_name == "TSH")
    assert float(tsh_row.value_numeric) == 1.80
    assert tsh_row.needs_review is False

    # Il panel con "Coso strano non mappato" → result esiste ma needs_review=True
    jan_panel = next(p for p in panels if str(p.test_date) == "2025-01-15")
    coso = (await db_session.execute(
        text("SELECT analyte_id, needs_review FROM lab_results "
             "WHERE panel_id = :p AND raw_name = :r"),
        {"p": jan_panel.id, "r": "Coso strano non mappato"},
    )).first()
    assert coso is not None
    assert coso.analyte_id is None
    assert coso.needs_review is True
