"""seed_medical_doc_categories: categorie iniziali per le 3 sezioni.

Revision ID: a0gq2s9r7y5z8
Revises: 9fp1r8q6w4x7
Create Date: 2026-05-21 10:10:00.000000

Categorie di partenza, comunque editabili dall'UTente via UI. Idempotente:
inserisce solo le categorie (section, name) non gia' presenti.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a0gq2s9r7y5z8'
down_revision: Union[str, None] = '9fp1r8q6w4x7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_SEED: dict[str, list[str]] = {
    "visit": [
        "Oculistica", "Ortopedia", "Cardiologia", "Endocrinologia",
        "Dentista", "Dermatologia", "Otorinolaringoiatria", "Medicina generale",
    ],
    "imaging": [
        "Radiografia", "Risonanza magnetica", "Ecografia", "TAC",
        "Mammografia", "Densitometria",
    ],
    "document": [
        "Attestato vaccinale", "Esenzione", "Certificato medico", "Prescrizione",
    ],
}


def upgrade() -> None:
    conn = op.get_bind()
    for section, names in _SEED.items():
        for name in names:
            conn.execute(
                sa.text(
                    "INSERT INTO medical_doc_categories (section, name) "
                    "SELECT :s, :n WHERE NOT EXISTS ("
                    "  SELECT 1 FROM medical_doc_categories "
                    "  WHERE section = :s AND LOWER(name) = LOWER(:n))"
                ),
                {"s": section, "n": name},
            )


def downgrade() -> None:
    conn = op.get_bind()
    for section, names in _SEED.items():
        conn.execute(
            sa.text(
                "DELETE FROM medical_doc_categories "
                "WHERE section = :s AND name = ANY(:names)"
            ),
            {"s": section, "names": names},
        )
