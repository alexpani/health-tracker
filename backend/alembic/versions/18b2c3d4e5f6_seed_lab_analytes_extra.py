"""seed: testosterone libero + rapporto PSA libero/totale.

Analiti visti nei referti CDR non presenti nel seed iniziale.

Revision ID: 18b2c3d4e5f6
Revises: 07a1b2c3d4e5
Create Date: 2026-04-23 10:01:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '18b2c3d4e5f6'
down_revision: Union[str, None] = '07a1b2c3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


ANALYTES: list[tuple] = [
    # (slug, name, category, specimen, value_type, unit, ref_low, ref_high, ref_text, aliases)
    ('testosterone_free', 'Testosterone libero', 'ormoni', 'blood', 'numeric',
        'pg/ml', 15.0, 50.0, None,
        ['Testosterone libero', 'T libero', 'Free testosterone', 'fTestosterone']),
    ('psa_ratio_free_total', 'Rapporto PSA libero/totale', 'oncologici', 'blood',
        'numeric', '%', 18, 100, None,
        ['Rapp. PSA libero/tot', 'Rapporto PSA libero/totale',
         'PSA ratio', 'PSA libero/totale', '% PSA libero']),
]


def upgrade() -> None:
    conn = op.get_bind()
    insert_analyte = sa.text(
        """
        INSERT INTO lab_analytes
            (slug, display_name_it, category, specimen, value_type,
             unit_canonical, ref_low, ref_high, ref_text)
        VALUES
            (:slug, :name, :category, :specimen, :value_type,
             :unit, :ref_low, :ref_high, :ref_text)
        RETURNING id
        """
    )
    insert_alias = sa.text(
        "INSERT INTO lab_analyte_aliases (analyte_id, alias) VALUES (:aid, :alias)"
    )
    for row in ANALYTES:
        slug, name, category, specimen, value_type, unit, \
            ref_low, ref_high, ref_text, aliases = row
        aid = conn.execute(insert_analyte, {
            'slug': slug, 'name': name, 'category': category,
            'specimen': specimen, 'value_type': value_type, 'unit': unit,
            'ref_low': ref_low, 'ref_high': ref_high, 'ref_text': ref_text,
        }).scalar_one()
        for alias in aliases:
            conn.execute(insert_alias, {'aid': aid, 'alias': alias})


def downgrade() -> None:
    conn = op.get_bind()
    slugs = [row[0] for row in ANALYTES]
    conn.execute(
        sa.text("DELETE FROM lab_analytes WHERE slug = ANY(:slugs)"),
        {'slugs': slugs},
    )
