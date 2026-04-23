"""Test PR #6: samples/latest con before+window_days, lab/recent-out-of-range."""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.models import HealthSample
from app.models.lab import LabAnalyte, LabPanel, LabResult

pytestmark = pytest.mark.asyncio


def _app(db_session):
    from app.main import app
    from app.database import get_db

    async def _o():
        yield db_session

    app.dependency_overrides[get_db] = _o
    return app


# ---------------------------------------------------------------------------
# /samples/latest con before + window_days
# ---------------------------------------------------------------------------

async def test_latest_sample_with_before_and_window(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    # 3 campioni di peso: uno remoto, uno vicino, uno dopo
    test_day = datetime(2026, 3, 18, 9, 0, tzinfo=timezone.utc)
    samples = [
        (datetime(2020, 1, 1, 10, 0, tzinfo=timezone.utc), 75.0),  # remoto
        (datetime(2026, 3, 17, 8, 0, tzinfo=timezone.utc), 72.5),  # giorno prima
        (datetime(2026, 3, 19, 10, 0, tzinfo=timezone.utc), 73.0),  # dopo il prelievo
    ]
    for when, val in samples:
        db_session.add(HealthSample(
            uuid=uuid4(),
            type="HKQuantityTypeIdentifierBodyMass",
            value=val, unit="kg",
            start_date=when, end_date=when,
        ))
    await db_session.commit()

    app = _app(db_session)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            # Senza before/window: il più recente è quello del 19
            r = await c.get("/api/v1/samples/latest", params={
                "type": "HKQuantityTypeIdentifierBodyMass",
            })
            assert r.json()["data"]["value"] == 73.0

            # before=2026-03-18 09:00 → il più recente <= quella data è il 17
            r = await c.get("/api/v1/samples/latest", params={
                "type": "HKQuantityTypeIdentifierBodyMass",
                "before": test_day.isoformat(),
            })
            assert r.json()["data"]["value"] == 72.5

            # before + window_days=3 → ancora il 17 (nel range)
            r = await c.get("/api/v1/samples/latest", params={
                "type": "HKQuantityTypeIdentifierBodyMass",
                "before": test_day.isoformat(),
                "window_days": 3,
            })
            assert r.json()["data"]["value"] == 72.5

            # before=2020-01-01 15:00 + window_days=3 → trova il remoto
            r = await c.get("/api/v1/samples/latest", params={
                "type": "HKQuantityTypeIdentifierBodyMass",
                "before": "2020-01-01T15:00:00+00:00",
                "window_days": 3,
            })
            assert r.json()["data"]["value"] == 75.0

            # Window stretto → nessun risultato
            r = await c.get("/api/v1/samples/latest", params={
                "type": "HKQuantityTypeIdentifierBodyMass",
                "before": "2024-01-01T00:00:00+00:00",
                "window_days": 7,
            })
            assert r.json()["data"] is None
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# /lab/recent-out-of-range
# ---------------------------------------------------------------------------

async def test_recent_out_of_range(db_session, engine):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))

    ast = LabAnalyte(
        slug="ast_home", display_name_it="AST", category="fegato",
        specimen="blood", value_type="numeric",
        unit_canonical="U/l",
        ref_low=Decimal("0"), ref_high=Decimal("37"),
    )
    db_session.add(ast)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    # panel confermato recente con AST fuori range
    conf = LabPanel(test_date=date(2026, 3, 18), specimen_types=["blood"],
                    status="confirmed", confirmed_at=now)
    db_session.add(conf)
    # panel confermato più vecchio con AST dentro range
    old = LabPanel(test_date=date(2025, 1, 1), specimen_types=["blood"],
                   status="confirmed", confirmed_at=now)
    db_session.add(old)
    # panel draft con AST fuori range → NON deve comparire
    draft = LabPanel(test_date=date(2026, 4, 1), specimen_types=["blood"], status="draft")
    db_session.add(draft)
    await db_session.flush()

    db_session.add_all([
        LabResult(panel_id=conf.id, analyte_id=ast.id, raw_name="AST",
                  value_numeric=Decimal("42"), unit_raw="U/l", unit_normalized="U/l",
                  out_of_range=True, needs_review=False),
        LabResult(panel_id=old.id, analyte_id=ast.id, raw_name="AST",
                  value_numeric=Decimal("30"), unit_raw="U/l", unit_normalized="U/l",
                  out_of_range=False, needs_review=False),
        LabResult(panel_id=draft.id, analyte_id=ast.id, raw_name="AST",
                  value_numeric=Decimal("99"), unit_raw="U/l",
                  out_of_range=True, needs_review=True),
    ])
    await db_session.commit()

    app = _app(db_session)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            r = await c.get("/api/v1/lab/recent-out-of-range")
        body = r.json()
        # Solo il result del panel confirmed (42 U/l)
        assert len(body) == 1
        item = body[0]
        assert item["display_name"] == "AST"
        assert item["value_numeric"] == 42.0
        assert item["ref_high"] == 37.0
        assert item["test_date"] == "2026-03-18"
    finally:
        app.dependency_overrides.clear()
