"""lab_correlation_annotations.dismissed

Flag "vista/archiviata" per nascondere una correlazione dal widget home.

Revision ID: d3lab0corr2
Revises: c2lab9corr1
Create Date: 2026-06-03
"""
from alembic import op
import sqlalchemy as sa


revision = "d3lab0corr2"
down_revision = "c2lab9corr1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "lab_correlation_annotations",
        sa.Column("dismissed", sa.Boolean(), nullable=False,
                  server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("lab_correlation_annotations", "dismissed")
