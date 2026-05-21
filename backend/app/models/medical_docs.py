"""Medical documents domain models.

Dominio generico per tre archivi documentali, distinti dal discriminatore
`section`:
  - `visit`    → Visite mediche specialistiche
  - `imaging`  → Referti di esami strumentali (radiografie, RMN, ecografie, ...)
  - `document` → Documentazione varia (attestati vaccinali, esenzioni, ...)

Tutte e tre condividono lo stesso meccanismo: upload PDF, analisi IA per
pre-compilare i metadati, revisione manuale, ricerca full-text + filtri.
Niente HealthKit / iOS — feature solo dashboard.
"""
from datetime import date as _date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class MedicalDocFile(Base):
    """File PDF su disco, deduplicato per `sha256`."""
    __tablename__ = "medical_doc_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    relative_path: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class MedicalDocCategory(Base):
    """Categoria gestibile, scoped per sezione (es. Oculistica, RMN, ...)."""
    __tablename__ = "medical_doc_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    section: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_medical_doc_categories_section", "section"),
    )


class MedicalDocument(Base):
    """Un documento medico (referto visita / esame strumentale / documento)."""
    __tablename__ = "medical_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    section: Mapped[str] = mapped_column(Text, nullable=False)
    category_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("medical_doc_categories.id", ondelete="SET NULL")
    )
    file_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("medical_doc_files.id", ondelete="SET NULL")
    )
    title: Mapped[str | None] = mapped_column(Text)
    doc_date: Mapped[_date | None] = mapped_column(Date)
    facility_name: Mapped[str | None] = mapped_column(Text)
    doctor_name: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="draft"
    )
    notes: Mapped[str | None] = mapped_column(Text)
    # Testo grezzo estratto dal PDF (pdfplumber) per la ricerca full-text.
    content_text: Mapped[str | None] = mapped_column(Text)
    parsing_failed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=False,
    )
    # `search_tsv tsvector` esiste a livello DB (popolata da trigger) ma non
    # viene mappata qui: la gestione e' interamente lato PostgreSQL.

    __table_args__ = (
        Index("ix_medical_documents_section_date", "section", doc_date.desc()),
    )
