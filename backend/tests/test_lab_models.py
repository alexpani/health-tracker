"""Test CRUD di base sui modelli del dominio Lab (PR #1)."""
from datetime import date

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.models.lab import (
    LabAnalyte,
    LabAnalyteAlias,
    LabDocument,
    LabPanel,
    LabResult,
)

pytestmark = pytest.mark.asyncio


async def test_lab_document_crud_and_unique_sha(db_session):
    doc = LabDocument(
        relative_path="2024/referto-01.pdf",
        sha256="a" * 64,
        mime_type="application/pdf",
        size_bytes=12345,
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)
    assert doc.id is not None
    assert doc.uploaded_at is not None

    fetched = await db_session.scalar(
        select(LabDocument).where(LabDocument.sha256 == "a" * 64)
    )
    assert fetched is not None and fetched.id == doc.id

    db_session.add(
        LabDocument(
            relative_path="2024/duplicato.pdf",
            sha256="a" * 64,
            mime_type="application/pdf",
            size_bytes=1,
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_lab_analyte_and_alias_lookup(db_session):
    analyte = LabAnalyte(
        slug="tsh",
        display_name_it="TSH",
        category="ormoni",
        specimen="blood",
        value_type="numeric",
        unit_canonical="µUI/ml",
        ref_low=0.4,
        ref_high=4.0,
    )
    db_session.add(analyte)
    await db_session.commit()
    await db_session.refresh(analyte)

    db_session.add_all([
        LabAnalyteAlias(analyte_id=analyte.id, alias="TSH"),
        LabAnalyteAlias(analyte_id=analyte.id, alias="Tireotropina"),
    ])
    await db_session.commit()

    # Funzionale case-insensitive: è quello che useremo nell'ingest.
    row = await db_session.scalar(
        select(LabAnalyteAlias).where(func.lower(LabAnalyteAlias.alias) == "tsh")
    )
    assert row is not None
    assert row.analyte_id == analyte.id

    # Unique su alias: duplicato → IntegrityError.
    db_session.add(LabAnalyteAlias(analyte_id=analyte.id, alias="TSH"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_lab_panel_with_array_specimen(db_session):
    doc = LabDocument(
        relative_path="panel.pdf",
        sha256="b" * 64,
        mime_type="application/pdf",
        size_bytes=999,
    )
    db_session.add(doc)
    await db_session.commit()
    await db_session.refresh(doc)

    panel = LabPanel(
        test_date=date(2024, 3, 15),
        lab_name="Lab Esempio",
        specimen_types=["blood", "urine"],
        document_id=doc.id,
    )
    db_session.add(panel)
    await db_session.commit()
    await db_session.refresh(panel)

    assert panel.status == "draft"
    assert panel.specimen_types == ["blood", "urine"]
    assert panel.confirmed_at is None


async def test_lab_result_cascade_on_panel_delete(db_session):
    analyte = LabAnalyte(
        slug="glucose_fasting_test",
        display_name_it="Glicemia a digiuno",
        category="metabolismo",
        specimen="blood",
        value_type="numeric",
        unit_canonical="mg/dl",
        ref_low=70,
        ref_high=100,
    )
    db_session.add(analyte)
    panel = LabPanel(test_date=date(2024, 1, 1), specimen_types=["blood"])
    db_session.add(panel)
    await db_session.commit()
    await db_session.refresh(analyte)
    await db_session.refresh(panel)

    result = LabResult(
        panel_id=panel.id,
        analyte_id=analyte.id,
        raw_name="Glicemia",
        value_numeric=92,
        unit_raw="mg/dl",
    )
    db_session.add(result)
    await db_session.commit()
    await db_session.refresh(result)

    assert result.needs_review is True
    assert result.out_of_range is None

    # Cascade: elimino il panel → il result sparisce.
    await db_session.delete(panel)
    await db_session.commit()

    remaining = await db_session.scalar(
        select(func.count()).select_from(LabResult).where(LabResult.id == result.id)
    )
    assert remaining == 0

    # L'analita invece sopravvive (ON DELETE SET NULL non è rilevante qui
    # perché cancelliamo il panel, non l'analita).
    still_there = await db_session.scalar(
        select(LabAnalyte).where(LabAnalyte.id == analyte.id)
    )
    assert still_there is not None
