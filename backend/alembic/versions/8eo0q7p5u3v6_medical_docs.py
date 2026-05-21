"""medical_docs: tabelle per Visite / Referti / Documentazione.

Revision ID: 8eo0q7p5u3v6
Revises: 7dn9p6o4s2t5
Create Date: 2026-05-21 10:00:00.000000

Dominio documentale generico (discriminatore `section`):
  - medical_doc_files       PDF su disco, dedup per sha256
  - medical_doc_categories  categorie gestibili scoped per sezione
  - medical_documents       il documento con metadati + testo estratto
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8eo0q7p5u3v6'
down_revision: Union[str, None] = '7dn9p6o4s2t5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'medical_doc_files',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('relative_path', sa.Text(), nullable=False),
        sa.Column('sha256', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.Text(), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('sha256'),
    )

    op.create_table(
        'medical_doc_categories',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('section', sa.Text(), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_medical_doc_categories_section',
                    'medical_doc_categories', ['section'])
    # UNIQUE parziale case-insensitive per evitare categorie duplicate.
    op.execute(
        "CREATE UNIQUE INDEX ix_medical_doc_categories_uniq "
        "ON medical_doc_categories (section, LOWER(name))"
    )

    op.create_table(
        'medical_documents',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('section', sa.Text(), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=True),
        sa.Column('file_id', sa.Integer(), nullable=True),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column('doc_date', sa.Date(), nullable=True),
        sa.Column('facility_name', sa.Text(), nullable=True),
        sa.Column('doctor_name', sa.Text(), nullable=True),
        sa.Column('status', sa.Text(), server_default='draft', nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('content_text', sa.Text(), nullable=True),
        sa.Column('parsing_failed', sa.Boolean(),
                  server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['category_id'], ['medical_doc_categories.id'],
                                ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['file_id'], ['medical_doc_files.id'],
                                ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_medical_documents_section_date', 'medical_documents',
                    ['section', sa.text('doc_date DESC')])


def downgrade() -> None:
    op.drop_index('ix_medical_documents_section_date',
                  table_name='medical_documents')
    op.drop_table('medical_documents')
    op.execute("DROP INDEX IF EXISTS ix_medical_doc_categories_uniq")
    op.drop_index('ix_medical_doc_categories_section',
                  table_name='medical_doc_categories')
    op.drop_table('medical_doc_categories')
    op.drop_table('medical_doc_files')
