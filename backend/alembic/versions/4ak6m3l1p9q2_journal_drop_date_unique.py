"""journal_entries: rimuovi UNIQUE su date (piu' note per giorno).

Revision ID: 4ak6m3l1p9q2
Revises: 39j5l2k0n8o1
Create Date: 2026-05-11 20:00:00.000000

Il diario originariamente ammetteva una sola voce per data (UNIQUE su
`date`). Ora ne ammette N. Rimuoviamo solo il vincolo UNIQUE; l'indice
non-unique su `date` viene gia' creato dalla migration originale, quindi
le query continuano ad andare veloci.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '4ak6m3l1p9q2'
down_revision: Union[str, None] = '39j5l2k0n8o1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('uq_journal_entries_date', 'journal_entries', type_='unique')


def downgrade() -> None:
    # Per ripristinare il vincolo bisogna prima eliminare i duplicati.
    op.create_unique_constraint('uq_journal_entries_date', 'journal_entries', ['date'])
