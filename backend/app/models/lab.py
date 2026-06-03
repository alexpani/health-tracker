"""Lab results domain models (sangue / urine).

Dominio separato da HealthKit. Vedi LAB_RESULTS_SPEC.md e CLAUDE.md.
"""
from datetime import date as _date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class LabDocument(Base):
    __tablename__ = "lab_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    relative_path: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class LabAnalyte(Base):
    __tablename__ = "lab_analytes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    display_name_it: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    specimen: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="blood"
    )
    value_type: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="numeric"
    )
    unit_canonical: Mapped[str | None] = mapped_column(Text)
    ref_low: Mapped[Decimal | None] = mapped_column(Numeric)
    ref_high: Mapped[Decimal | None] = mapped_column(Numeric)
    ref_text: Mapped[str | None] = mapped_column(Text)
    sex_specific: Mapped[str | None] = mapped_column(Text)
    loinc_code: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class LabAnalyteAlias(Base):
    __tablename__ = "lab_analyte_aliases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    analyte_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("lab_analytes.id", ondelete="CASCADE"),
        nullable=False,
    )
    alias: Mapped[str] = mapped_column(Text, unique=True, nullable=False)


class LabPanel(Base):
    __tablename__ = "lab_panels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    test_date: Mapped[_date] = mapped_column(Date, nullable=False)
    lab_name: Mapped[str | None] = mapped_column(Text)
    specimen_types: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    document_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("lab_documents.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="draft"
    )
    notes: Mapped[str | None] = mapped_column(Text)
    # Contesto del prelievo (tutti opzionali; auto-popolati o editabili).
    activity_text: Mapped[str | None] = mapped_column(Text)
    medications_text: Mapped[str | None] = mapped_column(Text)
    supplements_text: Mapped[str | None] = mapped_column(Text)
    nutrition_text: Mapped[str | None] = mapped_column(Text)
    diet_text: Mapped[str | None] = mapped_column(Text)
    workout_text: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_lab_panels_date", test_date.desc()),
    )


class LabResult(Base):
    __tablename__ = "lab_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    panel_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("lab_panels.id", ondelete="CASCADE"),
        nullable=False,
    )
    analyte_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("lab_analytes.id", ondelete="SET NULL")
    )
    raw_name: Mapped[str] = mapped_column(Text, nullable=False)
    value_numeric: Mapped[Decimal | None] = mapped_column(Numeric)
    value_text: Mapped[str | None] = mapped_column(Text)
    unit_raw: Mapped[str | None] = mapped_column(Text)
    unit_normalized: Mapped[str | None] = mapped_column(Text)
    ref_low_raw: Mapped[Decimal | None] = mapped_column(Numeric)
    ref_high_raw: Mapped[Decimal | None] = mapped_column(Numeric)
    ref_text_raw: Mapped[str | None] = mapped_column(Text)
    out_of_range: Mapped[bool | None] = mapped_column(Boolean)
    needs_review: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    notes: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_lab_results_panel", "panel_id"),
        Index("ix_lab_results_analyte", "analyte_id"),
    )


class LabCorrelationAnnotation(Base):
    """Cache dell'annotazione IA per una candidata di correlazione esame ↔
    regime/nota. Chiave = `signature` deterministica prodotta dal motore
    (`lab_correlations.compute_candidates`). Il fill avviene in background
    (1 chiamata per signature unica) per non rifare la chiamata IA a ogni
    pageload e per non bloccare il request-handler (LXC 1GB RAM)."""
    __tablename__ = "lab_correlation_annotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    signature: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    plausibility: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="none"
    )  # none | low | medium | high
    mechanism_text: Mapped[str | None] = mapped_column(Text)
    is_known_association: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    model: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="pending"
    )  # pending | done | failed
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(),
        nullable=False,
    )
