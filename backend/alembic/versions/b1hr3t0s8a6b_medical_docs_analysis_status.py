"""medical_documents.analysis_status: stato analisi IA in background.

Revision ID: b1hr3t0s8a6b
Revises: a0gq2s9r7y5z8
Create Date: 2026-05-21 11:30:00.000000

L'analisi IA viene eseguita in background dopo l'upload: la colonna traccia
`pending` (in corso) → `done` | `failed`. I documenti gia' esistenti sono
considerati `done` (analisi gia' completata in modalita' sincrona).
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b1hr3t0s8a6b'
down_revision: Union[str, None] = 'a0gq2s9r7y5z8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE medical_documents "
        "ADD COLUMN analysis_status text NOT NULL DEFAULT 'done'"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE medical_documents DROP COLUMN IF EXISTS analysis_status")
