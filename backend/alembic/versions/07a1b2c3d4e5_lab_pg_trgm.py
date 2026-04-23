"""abilita pg_trgm + indice trigram su lab_analyte_aliases.alias

Serve per il fuzzy matching `similarity(alias, raw_name) > 0.6` in ingest.

Revision ID: 07a1b2c3d4e5
Revises: f5e1a8436255
Create Date: 2026-04-23 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = '07a1b2c3d4e5'
down_revision: Union[str, None] = 'f5e1a8436255'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        "CREATE INDEX ix_lab_aliases_trgm "
        "ON lab_analyte_aliases USING gin (LOWER(alias) gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_lab_aliases_trgm")
    # Non droppiamo l'extension: potrebbe essere usata da altri moduli.
