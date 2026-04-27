"""daily_stats

Revision ID: 3af6d8e91a02
Revises: 29c3d4e5f6a7
Create Date: 2026-04-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3af6d8e91a02'
down_revision: Union[str, None] = '29c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'daily_stats',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('type', sa.String(length=100), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('value', sa.Double(), nullable=False),
        sa.Column('source', sa.String(length=200), nullable=True),
        sa.Column('computed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_daily_stats_type_date', 'daily_stats', ['type', 'date'], unique=False)
    # UNIQUE su (type, date, COALESCE(source, '_all_')) per supportare upsert
    # idempotente sia con source=NULL (totale cross-source) sia con source
    # specifica in futuro.
    op.execute(
        "CREATE UNIQUE INDEX uq_daily_stats ON daily_stats "
        "(type, date, (COALESCE(source, '_all_')))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_daily_stats")
    op.drop_index('idx_daily_stats_type_date', table_name='daily_stats')
    op.drop_table('daily_stats')
