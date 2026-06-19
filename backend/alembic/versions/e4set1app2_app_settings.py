"""app_settings key-value store

Tabella key-value per le preferenze dell'app condivise tra dispositivi
(es. orizzonte promemoria regimi), al posto di localStorage per-browser.

Revision ID: e4set1app2
Revises: d3lab0corr2
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "e4set1app2"
down_revision = "d3lab0corr2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("app_settings")
