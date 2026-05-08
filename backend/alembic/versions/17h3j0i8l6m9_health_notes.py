"""health_notes table for daily health annotations (pain, illness, ...).

Revision ID: 17h3j0i8l6m9
Revises: 06g2i9h7k5l8
Create Date: 2026-05-08 10:00:00.000000

Tabella per note quotidiane di salute. Periodo chiuso obbligatorio
(start_date e end_date entrambi NOT NULL). Per nota di un giorno solo:
start_date = end_date.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '17h3j0i8l6m9'
down_revision: Union[str, None] = '06g2i9h7k5l8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'health_notes',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('category', sa.String(length=30), nullable=False),
        sa.Column('body_zone', sa.String(length=50), nullable=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_health_notes_dates', 'health_notes',
                    ['start_date', 'end_date'])
    op.create_index('idx_health_notes_category', 'health_notes',
                    ['category'])


def downgrade() -> None:
    op.drop_index('idx_health_notes_category', table_name='health_notes')
    op.drop_index('idx_health_notes_dates', table_name='health_notes')
    op.drop_table('health_notes')
