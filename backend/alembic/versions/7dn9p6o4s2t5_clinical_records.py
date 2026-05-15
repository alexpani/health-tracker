"""clinical_records

Revision ID: 7dn9p6o4s2t5
Revises: 6cm8o5n3r1s4
Create Date: 2026-05-13 12:00:00.000000

Crea la tabella `clinical_records` per HealthKit Clinical Records (FHIR).
Vedi `app/models/clinical.py` per la doc del modello.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision: str = '7dn9p6o4s2t5'
down_revision: Union[str, None] = '6cm8o5n3r1s4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "clinical_records",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("hk_uuid", sa.String(64), nullable=False, unique=True),
        sa.Column("category", sa.String(80), nullable=False),
        sa.Column("resource_type", sa.String(60), nullable=True),
        sa.Column("source_name", sa.String(200), nullable=True),
        sa.Column("source_url", sa.String(500), nullable=True),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("start_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fhir_json", JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_clinical_category_start", "clinical_records", ["category", "start_date"]
    )
    op.create_index("ix_clinical_resource_type", "clinical_records", ["resource_type"])
    op.create_index("ix_clinical_start_date", "clinical_records", ["start_date"])


def downgrade() -> None:
    op.drop_index("ix_clinical_start_date", table_name="clinical_records")
    op.drop_index("ix_clinical_resource_type", table_name="clinical_records")
    op.drop_index("ix_clinical_category_start", table_name="clinical_records")
    op.drop_table("clinical_records")
