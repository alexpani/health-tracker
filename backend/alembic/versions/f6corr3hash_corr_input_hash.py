"""lab_correlation_annotations.input_hash

Impronta dei dati (valori esami, dosi, terapie attive) su cui e' stata fatta
l'annotazione IA: se cambia, la correlazione viene rivalutata.

Revision ID: f6corr3hash
Revises: e4set1app2
Create Date: 2026-11-02
"""
from alembic import op
import sqlalchemy as sa


revision = "f6corr3hash"
down_revision = "e4set1app2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lab_correlation_annotations",
        sa.Column("input_hash", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("lab_correlation_annotations", "input_hash")
