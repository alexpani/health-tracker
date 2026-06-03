"""lab_correlation_annotations

Cache delle annotazioni IA per le candidate di correlazione esame ↔ regime/nota.

Revision ID: c2lab9corr1
Revises: b1hr3t0s8a6b
Create Date: 2026-06-03
"""
from alembic import op
import sqlalchemy as sa


revision = "c2lab9corr1"
down_revision = "b1hr3t0s8a6b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lab_correlation_annotations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("signature", sa.Text(), nullable=False),
        sa.Column("plausibility", sa.Text(), nullable=False, server_default="none"),
        sa.Column("mechanism_text", sa.Text(), nullable=True),
        sa.Column(
            "is_known_association", sa.Boolean(), nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.UniqueConstraint("signature", name="uq_lab_corr_signature"),
    )


def downgrade() -> None:
    op.drop_table("lab_correlation_annotations")
