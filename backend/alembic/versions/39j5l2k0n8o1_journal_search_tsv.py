"""journal_entries.search_tsv: full-text search column (italian).

Revision ID: 39j5l2k0n8o1
Revises: 28i4k1j9m7n0
Create Date: 2026-05-11 19:00:00.000000

Aggiunge una colonna `search_tsv tsvector` su `journal_entries`,
popolata da un trigger BEFORE INSERT/UPDATE che applica
`to_tsvector('italian', content_text)`. Indice GIN per la ricerca
full-text con stemming italiano. Backfill esistente.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '39j5l2k0n8o1'
down_revision: Union[str, None] = '28i4k1j9m7n0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Colonna nullable inizialmente (la riempiamo subito col backfill)
    op.execute(
        "ALTER TABLE journal_entries ADD COLUMN search_tsv tsvector"
    )

    # Trigger function
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_journal_search_tsv()
        RETURNS trigger AS $$
        BEGIN
          NEW.search_tsv := to_tsvector('italian', COALESCE(NEW.content_text, ''));
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_journal_search_tsv
        BEFORE INSERT OR UPDATE OF content_text
        ON journal_entries
        FOR EACH ROW EXECUTE FUNCTION fn_journal_search_tsv()
        """
    )

    # Backfill esistenti
    op.execute(
        "UPDATE journal_entries SET search_tsv = to_tsvector('italian', COALESCE(content_text, ''))"
    )

    # Indice GIN
    op.execute(
        "CREATE INDEX idx_journal_entries_search ON journal_entries USING gin(search_tsv)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_journal_entries_search")
    op.execute("DROP TRIGGER IF EXISTS trg_journal_search_tsv ON journal_entries")
    op.execute("DROP FUNCTION IF EXISTS fn_journal_search_tsv()")
    op.execute("ALTER TABLE journal_entries DROP COLUMN IF EXISTS search_tsv")
