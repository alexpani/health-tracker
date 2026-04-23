"""lab_panels: colonne di contesto (attività fisica, farmaci, integratori, …)

Revision ID: 29c3d4e5f6a7
Revises: 18b2c3d4e5f6
Create Date: 2026-04-23 13:00:00.000000

Aggiunge campi testuali opzionali per annotare lo stato del paziente al
momento del prelievo: attività fisica, farmaci, integratori, alimentazione
generica, dieta specifica (auto-fill da diario-alimentare se disponibile),
workout (auto-fill da lab/workouts se disponibile).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '29c3d4e5f6a7'
down_revision: Union[str, None] = '18b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COLS = [
    "activity_text",
    "medications_text",
    "supplements_text",
    "nutrition_text",
    "diet_text",
    "workout_text",
]


def upgrade() -> None:
    for col in _COLS:
        op.add_column("lab_panels", sa.Column(col, sa.Text(), nullable=True))


def downgrade() -> None:
    for col in reversed(_COLS):
        op.drop_column("lab_panels", col)
