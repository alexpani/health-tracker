"""training_autodetect_unique

Revision ID: 5bl7n4m2q0r3
Revises: 4ak6m3l1p9q2
Create Date: 2026-05-11 00:00:00.000000

UNIQUE parziale `(kind, name, start_date, end_date) WHERE source='training_autodetect'`
per rendere idempotente il re-run di `scripts/autodetect_training_regimens.py`,
che deduce periodi di allenamento dai workout sincronizzati.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '5bl7n4m2q0r3'
down_revision: Union[str, None] = '4ak6m3l1p9q2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX uq_regimens_training_autodetect "
        "ON regimens (kind, name, start_date, end_date) "
        "WHERE source = 'training_autodetect'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_regimens_training_autodetect")
