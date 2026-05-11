"""journal_entries: voce diario giornaliera (rich text + tag).

Revision ID: 28i4k1j9m7n0
Revises: 17h3j0i8l6m9
Create Date: 2026-05-11 10:00:00.000000

Tabella per il diario giornaliero. Una sola entry per data (UNIQUE su
`date`). content_html e' HTML sanitizzato server-side, content_text e' il
plain text estratto per ricerca. tags e' un array JSONB normalizzato
(lowercase trim dedup), con indice GIN per filtri per tag.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '28i4k1j9m7n0'
down_revision: Union[str, None] = '17h3j0i8l6m9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'journal_entries',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('content_html', sa.Text(), nullable=False),
        sa.Column('content_text', sa.Text(), nullable=False),
        sa.Column(
            'tags',
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('date', name='uq_journal_entries_date'),
    )
    op.create_index('idx_journal_entries_date', 'journal_entries', ['date'])
    op.create_index(
        'idx_journal_entries_tags',
        'journal_entries',
        ['tags'],
        postgresql_using='gin',
    )


def downgrade() -> None:
    op.drop_index('idx_journal_entries_tags', table_name='journal_entries')
    op.drop_index('idx_journal_entries_date', table_name='journal_entries')
    op.drop_table('journal_entries')
