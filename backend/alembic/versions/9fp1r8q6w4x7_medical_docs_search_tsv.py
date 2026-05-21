"""medical_documents.search_tsv: full-text search column (italian).

Revision ID: 9fp1r8q6w4x7
Revises: 8eo0q7p5u3v6
Create Date: 2026-05-21 10:05:00.000000

Colonna `search_tsv tsvector` su `medical_documents`, popolata da un trigger
BEFORE INSERT/UPDATE che applica `to_tsvector('italian', ...)` su
titolo + struttura + medico + testo estratto del PDF. Indice GIN.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9fp1r8q6w4x7'
down_revision: Union[str, None] = '8eo0q7p5u3v6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TSV_EXPR = (
    "to_tsvector('italian', "
    "COALESCE(NEW.title, '') || ' ' || "
    "COALESCE(NEW.facility_name, '') || ' ' || "
    "COALESCE(NEW.doctor_name, '') || ' ' || "
    "COALESCE(NEW.content_text, ''))"
)


def upgrade() -> None:
    op.execute("ALTER TABLE medical_documents ADD COLUMN search_tsv tsvector")

    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION fn_medical_docs_search_tsv()
        RETURNS trigger AS $$
        BEGIN
          NEW.search_tsv := {_TSV_EXPR};
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_medical_docs_search_tsv
        BEFORE INSERT OR UPDATE OF title, facility_name, doctor_name, content_text
        ON medical_documents
        FOR EACH ROW EXECUTE FUNCTION fn_medical_docs_search_tsv()
        """
    )
    op.execute(
        "UPDATE medical_documents SET search_tsv = to_tsvector('italian', "
        "COALESCE(title, '') || ' ' || COALESCE(facility_name, '') || ' ' || "
        "COALESCE(doctor_name, '') || ' ' || COALESCE(content_text, ''))"
    )
    op.execute(
        "CREATE INDEX idx_medical_documents_search "
        "ON medical_documents USING gin(search_tsv)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_medical_documents_search")
    op.execute("DROP TRIGGER IF EXISTS trg_medical_docs_search_tsv ON medical_documents")
    op.execute("DROP FUNCTION IF EXISTS fn_medical_docs_search_tsv()")
    op.execute("ALTER TABLE medical_documents DROP COLUMN IF EXISTS search_tsv")
