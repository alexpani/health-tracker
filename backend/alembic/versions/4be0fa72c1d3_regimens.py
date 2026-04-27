"""regimens

Revision ID: 4be0fa72c1d3
Revises: 3af6d8e91a02
Create Date: 2026-04-26 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4be0fa72c1d3'
down_revision: Union[str, None] = '3af6d8e91a02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'regimens',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('dose', sa.String(length=150), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column(
            'source',
            sa.String(length=20),
            server_default='manual',
            nullable=False,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_regimens_kind', 'regimens', ['kind'], unique=False)
    op.create_index('idx_regimens_dates', 'regimens', ['start_date', 'end_date'], unique=False)
    # Idempotent re-run del backfill: stesso (kind, name, end_date) con
    # source='lab_backfill' non puo' essere inserito due volte.
    op.execute(
        "CREATE UNIQUE INDEX uq_regimens_lab_backfill "
        "ON regimens (kind, name, end_date) "
        "WHERE source = 'lab_backfill'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_regimens_lab_backfill")
    op.drop_index('idx_regimens_dates', table_name='regimens')
    op.drop_index('idx_regimens_kind', table_name='regimens')
    op.drop_table('regimens')
