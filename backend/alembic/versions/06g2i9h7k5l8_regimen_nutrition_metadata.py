"""add metadata to regimens for nutrition plan details (kcal_target, macro %)

Revision ID: 06g2i9h7k5l8
Revises: 5cd91e7a6b03
Create Date: 2026-05-07 10:00:00.000000

Allows storing nutrition metadata on diet-kind regimens:
kcal_target, protein_pct, fat_pct, carbs_pct (all optional).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '06g2i9h7k5l8'
down_revision: Union[str, None] = '5cd91e7a6b03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'regimens',
        sa.Column('metadata', sa.dialects.postgresql.JSONB(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('regimens', 'metadata')
