"""lab_panels

Revision ID: d3c9e6214033
Revises: c2b8d5103f22
Create Date: 2026-04-23 00:00:02.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd3c9e6214033'
down_revision: Union[str, None] = 'c2b8d5103f22'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'lab_panels',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('test_date', sa.Date(), nullable=False),
        sa.Column('lab_name', sa.Text(), nullable=True),
        sa.Column('specimen_types', postgresql.ARRAY(sa.Text()),
                  nullable=False, server_default='{}'),
        sa.Column('document_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.Text(), nullable=False, server_default='draft'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['document_id'], ['lab_documents.id'],
                                ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.execute(
        "CREATE INDEX ix_lab_panels_date "
        "ON lab_panels (test_date DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_lab_panels_date")
    op.drop_table('lab_panels')
