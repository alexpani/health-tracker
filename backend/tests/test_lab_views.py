"""Test PR #4: GET /matrix e GET /timeseries (panel confermati)."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.models.lab import LabAnalyte, LabPanel, LabResult

pytestmark = pytest.mark.asyncio


def _app(db_session):
    from app.main import app
    from app.database import get_db

    async def _o():
        yield db_session

    app.dependency_overrides[get_db] = _o
    return app


async def _seed_confirmed_series(db_session):
    # 2 analiti, 3 panels in date diverse.
    tsh = LabAnalyte(
        slug="tsh_test", display_name_it="TSH", category="ormoni",
        specimen="blood", value_type="numeric",
        unit_canonical="µUI/ml",
        ref_low=Decimal("0.4"), ref_high=Decimal("4.0"),
    )
    glucose = LabAnalyte(
        slug="glucose_test_v", display_name_it="Glicemia", category="metabolismo",
        specimen="blood", value_type="numeric",
        unit_canonical="mg/dl",
        ref_low=Decimal("70"), ref_high=Decimal("100"),
    )
    db_session.add_all([tsh, glucose])
    await db_session.flush()

    now = datetime.now(timezone.utc)
    panels_data = [
        (date(2025, 1, 15), Decimal("1.2"), Decimal("88")),
        (date(2025, 6, 20), Decimal("1.8"), Decimal("95")),
        (date(2026, 3, 18), Decimal("2.1"), Decimal("105")),  # glucose oor
    ]
    for d, tsh_val, glu_val in panels_data:
        panel = LabPanel(
            test_date=d, lab_name="Lab T", specimen_types=["blood"],
            status="confirmed", confirmed_at=now,
        )
        db_session.add(panel)
        await db_session.flush()
        db_session.add(LabResult(
            panel_id=panel.id, analyte_id=tsh.id, raw_name="TSH",
            value_numeric=tsh_val, unit_raw="µUI/ml", unit_normalized="µUI/ml",
            out_of_range=False, needs_review=False,
        ))
        db_session.add(LabResult(
            panel_id=panel.id, analyte_id=glucose.id, raw_name="GLICEMIA",
            value_numeric=glu_val, unit_raw="mg/dl", unit_normalized="mg/dl",
            out_of_range=(glu_val > 100), needs_review=False,
        ))
    # Un panel draft che NON deve comparire
    draft = LabPanel(
        test_date=date(2026, 4, 1), specimen_types=["blood"], status="draft",
    )
    db_session.add(draft)
    await db_session.flush()
    db_session.add(LabResult(
        panel_id=draft.id, analyte_id=tsh.id, raw_name="TSH",
        value_numeric=Decimal("99"), unit_raw="µUI/ml",
    ))
    await db_session.commit()
    return tsh.id, glucose.id


async def test_matrix_returns_confirmed_only(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    tsh_id, glu_id = await _seed_confirmed_series(db_session)

    app = _app(db_session)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/api/v1/lab/matrix")
        assert r.status_code == 200
        body = r.json()
        # 3 panel confermati, non il draft
        assert len(body["panels"]) == 3
        # analiti del catalogo con specimen=blood (almeno i 2 inseriti)
        slugs = {a["slug"] for a in body["analytes"]}
        assert {"tsh_test", "glucose_test_v"}.issubset(slugs)

        tsh_cells = body["cells"][str(tsh_id)]
        assert len(tsh_cells) == 3

        # Il panel del 2026-03-18 ha glucose=105 out_of_range
        march_panel = next(p for p in body["panels"] if p["test_date"] == "2026-03-18")
        glu_cell = body["cells"][str(glu_id)][str(march_panel["id"])]
        assert glu_cell["value_numeric"] == 105.0
        assert glu_cell["out_of_range"] is True
    finally:
        app.dependency_overrides.clear()


async def test_matrix_filter_by_category(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    await _seed_confirmed_series(db_session)

    app = _app(db_session)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/api/v1/lab/matrix", params={"category": "ormoni"})
        body = r.json()
        cats = {a["category"] for a in body["analytes"]}
        assert cats == {"ormoni"}
    finally:
        app.dependency_overrides.clear()


async def test_timeseries_known_analyte(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    await _seed_confirmed_series(db_session)

    app = _app(db_session)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/api/v1/lab/timeseries", params={"analyte_slug": "tsh_test"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["analyte"]["slug"] == "tsh_test"
        assert body["analyte"]["ref_low"] == 0.4
        assert body["analyte"]["ref_high"] == 4.0
        pts = body["points"]
        assert len(pts) == 3
        # ordinati crescenti per data
        assert pts[0]["test_date"] < pts[1]["test_date"] < pts[2]["test_date"]
        assert pts[0]["value_numeric"] == 1.2
    finally:
        app.dependency_overrides.clear()


async def test_timeseries_unknown_analyte_404(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    app = _app(db_session)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/api/v1/lab/timeseries", params={"analyte_slug": "does_not_exist"})
        assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()
