"""lab_results

Revision ID: e4d0f7325144
Revises: d3c9e6214033
Create Date: 2026-04-23 00:00:03.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e4d0f7325144'
down_revision: Union[str, None] = 'd3c9e6214033'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'lab_results',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('panel_id', sa.Integer(), nullable=False),
        sa.Column('analyte_id', sa.Integer(), nullable=True),
        sa.Column('raw_name', sa.Text(), nullable=False),
        sa.Column('value_numeric', sa.Numeric(), nullable=True),
        sa.Column('value_text', sa.Text(), nullable=True),
        sa.Column('unit_raw', sa.Text(), nullable=True),
        sa.Column('unit_normalized', sa.Text(), nullable=True),
        sa.Column('ref_low_raw', sa.Numeric(), nullable=True),
        sa.Column('ref_high_raw', sa.Numeric(), nullable=True),
        sa.Column('ref_text_raw', sa.Text(), nullable=True),
        sa.Column('out_of_range', sa.Boolean(), nullable=True),
        sa.Column('needs_review', sa.Boolean(), nullable=False,
                  server_default=sa.text('true')),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['panel_id'], ['lab_panels.id'],
                                ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['analyte_id'], ['lab_analytes.id'],
                                ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_lab_results_panel', 'lab_results',
                    ['panel_id'], unique=False)
    op.create_index('ix_lab_results_analyte', 'lab_results',
                    ['analyte_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_lab_results_analyte', table_name='lab_results')
    op.drop_index('ix_lab_results_panel', table_name='lab_results')
    op.drop_table('lab_results')
