"""devices

Revision ID: 6cm8o5n3r1s4
Revises: 5bl7n4m2q0r3
Create Date: 2026-05-13 11:00:00.000000

Crea la tabella `devices` per la registrazione dei device iOS che ricevono
silent push APNs. Vedi `app/models/devices.py` per la doc del modello.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '6cm8o5n3r1s4'
down_revision: Union[str, None] = '5bl7n4m2q0r3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "devices",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("device_id", sa.String(64), nullable=False, unique=True),
        sa.Column("apns_token", sa.String(200), nullable=True),
        sa.Column("bundle_id", sa.String(200), nullable=True),
        sa.Column("apns_env", sa.String(20), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("last_push_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Index parziale sui device che hanno effettivamente un token: query
    # piu' veloce quando il backend cerca "tutti i device con cui pushare".
    op.create_index(
        "ix_devices_with_token",
        "devices",
        ["device_id"],
        postgresql_where=sa.text("apns_token IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_devices_with_token", table_name="devices")
    op.drop_table("devices")
