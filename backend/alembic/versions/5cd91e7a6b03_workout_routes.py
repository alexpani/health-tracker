"""workout_routes

Revision ID: 5cd91e7a6b03
Revises: 4be0fa72c1d3
Create Date: 2026-04-29 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '5cd91e7a6b03'
down_revision: Union[str, None] = '4be0fa72c1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'workout_routes',
        sa.Column('workout_uuid', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('points', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('point_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint('workout_uuid'),
        sa.ForeignKeyConstraint(
            ['workout_uuid'], ['workouts.uuid'], ondelete='CASCADE'
        ),
    )


def downgrade() -> None:
    op.drop_table('workout_routes')
