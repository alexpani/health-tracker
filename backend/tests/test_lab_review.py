"""Test PR #2b: confirm, PATCH result/panel, alias/analyte POST."""
from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.models.lab import LabAnalyte, LabAnalyteAlias, LabPanel, LabResult
from app.services import lab_units

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Unità: funzioni pure
# ---------------------------------------------------------------------------

def test_normalize_and_equivalent_units():
    assert lab_units.normalize_unit("µUI/ml") == "uui/ml"
    assert lab_units.normalize_unit(" mg/dl ") == "mg/dl"
    assert lab_units.units_equivalent("ng/ml", "µg/l")
    assert lab_units.units_equivalent("U/l", "IU/l")
    assert lab_units.units_equivalent("mg/dl", "mg/dl")
    assert not lab_units.units_equivalent("mg/dl", "mmol/l")
    assert not lab_units.units_equivalent(None, "mg/dl")


def test_numeric_out_of_range():
    assert lab_units.numeric_out_of_range(Decimal("150"), Decimal("100"), Decimal("200")) is False
    assert lab_units.numeric_out_of_range(Decimal("50"), Decimal("100"), Decimal("200")) is True
    assert lab_units.numeric_out_of_range(Decimal("250"), Decimal("100"), Decimal("200")) is True
    assert lab_units.numeric_out_of_range(None, Decimal("100"), Decimal("200")) is None
    assert lab_units.numeric_out_of_range(Decimal("150"), None, None) is None
    # range one-sided
    assert lab_units.numeric_out_of_range(Decimal("10"), None, Decimal("5")) is True


def test_qualitative_out_of_range():
    assert lab_units.qualitative_out_of_range("+", "assente") is True
    assert lab_units.qualitative_out_of_range("tracce", "assente") is True
    assert lab_units.qualitative_out_of_range("assente", "assente") is False
    assert lab_units.qualitative_out_of_range("negativo", "negativo") is False
    assert lab_units.qualitative_out_of_range("positivo", "negativo") is True
    assert lab_units.qualitative_out_of_range("boh", "assente") is None
    assert lab_units.qualitative_out_of_range(None, "assente") is None


# ---------------------------------------------------------------------------
# Helper — setup minimale per gli endpoint
# ---------------------------------------------------------------------------

async def _setup_analyte_and_panel(db_session, *, unit_canonical="mg/dl",
                                    ref_low=Decimal("70"), ref_high=Decimal("100"),
                                    value_type="numeric", ref_text=None):
    analyte = LabAnalyte(
        slug="glucose_test",
        display_name_it="Glicemia",
        category="metabolismo",
        specimen="blood",
        value_type=value_type,
        unit_canonical=unit_canonical,
        ref_low=ref_low,
        ref_high=ref_high,
        ref_text=ref_text,
    )
    db_session.add(analyte)
    await db_session.flush()

    panel = LabPanel(
        test_date=date(2026, 3, 18),
        lab_name="Lab Test",
        specimen_types=["blood"],
        status="draft",
    )
    db_session.add(panel)
    await db_session.flush()
    return analyte, panel


def _app_with_db(db_session):
    from app.main import app
    from app.database import get_db

    async def _override():
        yield db_session

    app.dependency_overrides[get_db] = _override
    return app


async def _client(app):
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


# ---------------------------------------------------------------------------
# Confirm: happy path numerico con unità che matcha
# ---------------------------------------------------------------------------

async def test_confirm_numeric_in_range(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    analyte, panel = await _setup_analyte_and_panel(db_session)
    db_session.add(LabResult(
        panel_id=panel.id, analyte_id=analyte.id,
        raw_name="GLICEMIA",
        value_numeric=Decimal("90"),
        unit_raw="mg/dl",
    ))
    await db_session.commit()

    app = _app_with_db(db_session)
    try:
        async with await _client(app) as c:
            r = await c.post(f"/api/v1/lab/panels/{panel.id}/confirm")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "confirmed"
        assert body["results_count"] == 1
        assert body["out_of_range_count"] == 0
        assert body["still_needs_review"] == 0

        # Verifica su DB: unit_normalized = mg/dl, out_of_range=False, needs_review=False
        await db_session.expire_all()
        result = (await db_session.execute(
            text("SELECT unit_normalized, out_of_range, needs_review "
                 "FROM lab_results WHERE panel_id = :p"),
            {"p": panel.id},
        )).first()
        assert result.unit_normalized == "mg/dl"
        assert result.out_of_range is False
        assert result.needs_review is False
    finally:
        app.dependency_overrides.clear()


async def test_confirm_numeric_out_of_range_and_equivalent_unit(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    # Canonical ng/ml ma referto in µg/l (equivalente)
    analyte = LabAnalyte(
        slug="psa_total_test", display_name_it="PSA", category="oncologici",
        specimen="blood", value_type="numeric",
        unit_canonical="ng/ml",
        ref_low=Decimal("0"), ref_high=Decimal("4"),
    )
    panel = LabPanel(test_date=date(2026, 3, 18), specimen_types=["blood"])
    db_session.add_all([analyte, panel])
    await db_session.flush()
    db_session.add(LabResult(
        panel_id=panel.id, analyte_id=analyte.id,
        raw_name="PSA", value_numeric=Decimal("8.5"), unit_raw="µg/l",
    ))
    await db_session.commit()

    app = _app_with_db(db_session)
    try:
        async with await _client(app) as c:
            r = await c.post(f"/api/v1/lab/panels/{panel.id}/confirm")
        assert r.status_code == 200, r.text
        assert r.json()["out_of_range_count"] == 1

        res = (await db_session.execute(text(
            "SELECT unit_normalized, out_of_range FROM lab_results WHERE panel_id = :p"
        ), {"p": panel.id})).first()
        assert res.unit_normalized == "ng/ml"  # canonica, non la µg/l del referto
        assert res.out_of_range is True
    finally:
        app.dependency_overrides.clear()


async def test_confirm_rejects_unmatched_results(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    analyte, panel = await _setup_analyte_and_panel(db_session)
    # Due result: uno con analyte_id, uno senza
    db_session.add_all([
        LabResult(panel_id=panel.id, analyte_id=analyte.id, raw_name="GLICEMIA",
                  value_numeric=Decimal("90"), unit_raw="mg/dl"),
        LabResult(panel_id=panel.id, analyte_id=None, raw_name="COSO MISTERIOSO",
                  value_text="foo"),
    ])
    await db_session.commit()

    app = _app_with_db(db_session)
    try:
        async with await _client(app) as c:
            r = await c.post(f"/api/v1/lab/panels/{panel.id}/confirm")
        assert r.status_code == 400
        assert "review incompleta" in r.json()["detail"]

        # Il panel resta draft
        await db_session.expire_all()
        p = (await db_session.execute(
            text("SELECT status FROM lab_panels WHERE id = :id"), {"id": panel.id}
        )).scalar_one()
        assert p == "draft"
    finally:
        app.dependency_overrides.clear()


async def test_confirm_qualitative(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    analyte = LabAnalyte(
        slug="urine_protein_test", display_name_it="Proteine",
        category="urine", specimen="urine", value_type="semi_quantitative",
        ref_text="assente",
    )
    panel = LabPanel(test_date=date(2026, 3, 18), specimen_types=["urine"])
    db_session.add_all([analyte, panel])
    await db_session.flush()
    db_session.add(LabResult(
        panel_id=panel.id, analyte_id=analyte.id,
        raw_name="Proteine", value_text="++",
    ))
    await db_session.commit()

    app = _app_with_db(db_session)
    try:
        async with await _client(app) as c:
            r = await c.post(f"/api/v1/lab/panels/{panel.id}/confirm")
        assert r.json()["out_of_range_count"] == 1
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# PATCH result → needs_review resettato; confirm successivo ok
# ---------------------------------------------------------------------------

async def test_patch_result_resets_review(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    analyte, panel = await _setup_analyte_and_panel(db_session)
    result = LabResult(
        panel_id=panel.id, analyte_id=None,  # inizialmente non mappato
        raw_name="GLICEMIA", value_numeric=Decimal("90"), unit_raw="mg/dl",
        needs_review=True,
    )
    db_session.add(result)
    await db_session.commit()
    await db_session.refresh(result)

    app = _app_with_db(db_session)
    try:
        async with await _client(app) as c:
            # PATCH per mappare l'analita
            r = await c.patch(f"/api/v1/lab/results/{result.id}", json={
                "analyte_id": analyte.id,
            })
            assert r.status_code == 200
            # Ora il confirm dovrebbe passare
            r = await c.post(f"/api/v1/lab/panels/{panel.id}/confirm")
            assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# POST /aliases con collisione
# ---------------------------------------------------------------------------

async def test_create_alias_and_conflict(db_session, engine):
    analyte, _ = await _setup_analyte_and_panel(db_session)
    await db_session.commit()

    app = _app_with_db(db_session)
    try:
        async with await _client(app) as c:
            r = await c.post("/api/v1/lab/aliases", json={
                "analyte_id": analyte.id, "alias": "Glic.",
            })
            assert r.status_code == 201
            # Duplicato
            r2 = await c.post("/api/v1/lab/aliases", json={
                "analyte_id": analyte.id, "alias": "Glic.",
            })
            assert r2.status_code == 409
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# POST /analytes creato con aliases
# ---------------------------------------------------------------------------

async def test_create_analyte_with_aliases(db_session, engine):
    app = _app_with_db(db_session)
    try:
        async with await _client(app) as c:
            r = await c.post("/api/v1/lab/analytes", json={
                "slug": "new_custom_analyte",
                "display_name_it": "Analita Personalizzato",
                "category": "custom",
                "specimen": "blood",
                "value_type": "numeric",
                "unit_canonical": "mg/dl",
                "ref_low": "1.0",
                "ref_high": "5.0",
                "aliases": ["Analita custom", "A. custom", "Analita custom"],  # 1 duplicato
            })
            assert r.status_code == 201, r.text
            body = r.json()
            assert body["aliases_created"] == 2
            assert body["aliases_skipped"] == 1
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# DELETE panel → cascade sui result e (opzionalmente) documento
# ---------------------------------------------------------------------------

async def test_delete_panel_cascade(db_session, engine):
    analyte, panel = await _setup_analyte_and_panel(db_session)
    db_session.add(LabResult(
        panel_id=panel.id, analyte_id=analyte.id,
        raw_name="G", value_numeric=Decimal("90"), unit_raw="mg/dl",
    ))
    await db_session.commit()

    app = _app_with_db(db_session)
    try:
        async with await _client(app) as c:
            r = await c.delete(f"/api/v1/lab/panels/{panel.id}")
            assert r.status_code == 200
            r = await c.get(f"/api/v1/lab/panels/{panel.id}")
            assert r.status_code == 404
            # I results sono spariti per CASCADE
            left = (await db_session.execute(
                text("SELECT COUNT(*) FROM lab_results WHERE panel_id = :p"),
                {"p": panel.id},
            )).scalar_one()
            assert left == 0
    finally:
        app.dependency_overrides.clear()
