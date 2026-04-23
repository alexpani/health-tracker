"""lab_documents

Revision ID: b1a7c4f02e11
Revises: 6677af61441c
Create Date: 2026-04-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b1a7c4f02e11'
down_revision: Union[str, None] = '6677af61441c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'lab_documents',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('relative_path', sa.Text(), nullable=False),
        sa.Column('sha256', sa.Text(), nullable=False),
        sa.Column('mime_type', sa.Text(), nullable=False),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('sha256', name='uq_lab_documents_sha256'),
    )


def downgrade() -> None:
    op.drop_table('lab_documents')
