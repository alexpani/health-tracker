"""
HealthKit Clinical Records (FHIR) ingest.

Apple Salute aggrega documenti clinici FHIR da provider sanitari (in
prevalenza US/CA tramite l'integrazione "Health Records") e li espone
all'app via `HKClinicalType`. Ogni record ha un `HKFHIRResource` con il
JSON FHIR grezzo + `resourceType` (es. "AllergyIntolerance", "Condition",
"Immunization", "Observation", "MedicationRequest", "Procedure",
"Coverage").

Tabella `clinical_records`:
- `hk_uuid` UNIQUE: idempotenza su re-sync (UPSERT su fhir_json/updated_at
  per supportare aggiornamenti retroattivi dei provider).
- `resource_type`: il valore FHIR ("AllergyIntolerance", "Observation", ...)
  per filtro lato dashboard.
- `category`: l'`HKClinicalTypeIdentifier` corrispondente
  ("HKClinicalTypeIdentifierAllergyRecord", ecc) — utile perche' alcuni
  tipi FHIR (Observation) sono usati da piu' categorie HK (Lab vs Vital).
- `display_name`: estratto a ingest time da `code.text` o
  `code.coding[0].display` per evitare di re-parsare il JSON ad ogni query.
- `start_date`: `HKSample.startDate` (per ordinamento cronologico).
- `fhir_json` JSONB: il payload originale, completo. La dashboard lo
  renderizza on-demand.
"""

from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from . import Base


class ClinicalRecord(Base):
    __tablename__ = "clinical_records"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    hk_uuid: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # HKClinicalTypeIdentifier (es. "HKClinicalTypeIdentifierAllergyRecord")
    category: Mapped[str] = mapped_column(String(80), nullable=False)
    # FHIR resourceType (es. "AllergyIntolerance", "Observation", ...).
    # Nullable perche' in casi pathologici HKFHIRResource puo' essere None.
    resource_type: Mapped[str | None] = mapped_column(String(60))
    source_name: Mapped[str | None] = mapped_column(String(200))
    source_url: Mapped[str | None] = mapped_column(String(500))
    display_name: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fhir_json: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_clinical_category_start", "category", "start_date"),
        Index("ix_clinical_resource_type", "resource_type"),
        Index("ix_clinical_start_date", "start_date"),
    )
