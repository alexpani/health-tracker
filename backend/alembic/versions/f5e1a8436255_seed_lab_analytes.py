"""seed_lab_analytes — catalogo iniziale di analiti sangue + urine con alias IT.

Revision ID: f5e1a8436255
Revises: e4d0f7325144
Create Date: 2026-04-23 00:00:04.000000

Fonti range: linee guida SIPMeL/IFCC per adulto generico, adattate ai cutoff
italiani comuni. Per i qualitativi urinari unit_canonical=NULL, ref_text popolato.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f5e1a8436255'
down_revision: Union[str, None] = 'e4d0f7325144'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (slug, display_name_it, category, specimen, value_type,
#  unit_canonical, ref_low, ref_high, ref_text, aliases)
ANALYTES: list[tuple] = [
    # ---------- SANGUE (28) ----------
    ('lh', 'LH', 'ormoni', 'blood', 'numeric', 'mUI/ml', 1.7, 8.6, None,
        ['LH', 'Ormone luteinizzante', 'Luteotropina']),
    ('fsh', 'FSH', 'ormoni', 'blood', 'numeric', 'mUI/ml', 1.5, 12.4, None,
        ['FSH', 'Ormone follicolo stimolante', 'Follitropina']),
    ('prolactin', 'Prolattina', 'ormoni', 'blood', 'numeric', 'ng/ml', 4.0, 15.2, None,
        ['Prolattina', 'PRL']),
    ('testosterone_total', 'Testosterone totale', 'ormoni', 'blood', 'numeric',
        'ng/ml', 2.8, 11.0, None,
        ['Testosterone', 'Testosterone tot.', 'T tot.', 'Testosterone totale']),
    ('ft3', 'FT3', 'ormoni', 'blood', 'numeric', 'pg/ml', 2.0, 4.4, None,
        ['FT3', 'T3 libera', 'Triiodotironina libera']),
    ('ft4', 'FT4', 'ormoni', 'blood', 'numeric', 'ng/dl', 0.93, 1.7, None,
        ['FT4', 'T4 libera', 'Tiroxina libera']),
    ('tsh', 'TSH', 'ormoni', 'blood', 'numeric', 'µUI/ml', 0.4, 4.0, None,
        ['TSH', 'Tireostimolante', 'Tireotropina']),
    ('cortisol', 'Cortisolo', 'ormoni', 'blood', 'numeric', 'µg/dl', 6.2, 19.4, None,
        ['Cortisolo', 'Cortisolo sierico']),
    ('vit_b12', 'Vitamina B12', 'vitamine', 'blood', 'numeric', 'pg/ml', 211, 911, None,
        ['Vit. B12', 'B12', 'Cobalamina', 'Vitamina B12']),
    ('folate', 'Folati (B9)', 'vitamine', 'blood', 'numeric', 'ng/ml', 3.1, 20.5, None,
        ['Acido folico', 'Folati', 'Vit. B9']),
    ('vit_d_25oh', 'Vitamina D 25-OH', 'vitamine', 'blood', 'numeric',
        'ng/ml', 30, 100, None,
        ['25-OH vit. D', 'Calcidiolo', 'Vitamina D', '25(OH)D']),
    ('vit_d3', 'Vitamina D3', 'vitamine', 'blood', 'numeric', 'ng/ml', 30, 100, None,
        ['Colecalciferolo', 'Vit. D3', 'Vitamina D3']),
    ('psa_total', 'PSA totale', 'oncologici', 'blood', 'numeric', 'ng/ml', 0, 4.0, None,
        ['PSA', 'PSA totale', 'Antigene prostatico specifico', 'PSA tot.']),
    ('psa_free', 'PSA libero', 'oncologici', 'blood', 'numeric', 'ng/ml', 0, 1.0, None,
        ['PSA libero', 'PSA free', 'Free PSA', 'fPSA']),
    ('homocysteine', 'Omocisteina', 'metabolismo', 'blood', 'numeric',
        'µmol/l', 5, 15, None,
        ['Omocisteina', 'HCY']),
    ('urea', 'Azotemia (urea)', 'reni', 'blood', 'numeric', 'mg/dl', 10, 50, None,
        ['Urea', 'Azotemia', 'BUN']),
    ('creatinine', 'Creatinina', 'reni', 'blood', 'numeric', 'mg/dl', 0.7, 1.2, None,
        ['Creatinina', 'Creat.']),
    ('uric_acid', 'Acido urico', 'metabolismo', 'blood', 'numeric',
        'mg/dl', 3.4, 7.0, None,
        ['Acido urico', 'Uricemia']),
    ('ast', 'AST (GOT)', 'fegato', 'blood', 'numeric', 'U/l', 0, 40, None,
        ['AST', 'GOT', 'Aspartato aminotransferasi', 'AST/GOT']),
    ('alt', 'ALT (GPT)', 'fegato', 'blood', 'numeric', 'U/l', 0, 41, None,
        ['ALT', 'GPT', 'Alanina aminotransferasi', 'ALT/GPT']),
    ('ggt', 'Gamma-GT', 'fegato', 'blood', 'numeric', 'U/l', 8, 61, None,
        ['GGT', 'Gamma-GT', 'γ-GT', 'Gamma glutamil transferasi']),
    ('total_bilirubin', 'Bilirubina totale', 'fegato', 'blood', 'numeric',
        'mg/dl', 0.2, 1.2, None,
        ['Bilirubina tot.', 'Bilirubina totale', 'Bilirubina']),
    ('ck', 'CK (CPK)', 'muscoli', 'blood', 'numeric', 'U/l', 30, 200, None,
        ['CK', 'CPK', 'Creatinchinasi']),
    ('ferritin', 'Ferritina', 'ematologia', 'blood', 'numeric',
        'ng/ml', 30, 400, None,
        ['Ferritina']),
    ('esr', 'VES', 'infiammazione', 'blood', 'numeric', 'mm/h', 0, 20, None,
        ['VES', 'ESR', 'Velocità di eritrosedimentazione']),
    ('calcium', 'Calcio totale', 'elettroliti', 'blood', 'numeric',
        'mg/dl', 8.6, 10.2, None,
        ['Calcio', 'Calcemia', 'Ca', 'Calcio totale']),
    ('pth', 'Paratormone (PTH)', 'ormoni', 'blood', 'numeric',
        'pg/ml', 15, 65, None,
        ['PTH', 'Paratormone']),
    ('zinc', 'Zinco', 'oligoelementi', 'blood', 'numeric',
        'µg/dl', 70, 120, None,
        ['Zinco', 'Zn']),
    ('q10', 'Coenzima Q10', 'nutraceutici', 'blood', 'numeric',
        'µg/ml', 0.5, 1.8, None,
        ['Coenzima Q10', 'CoQ10', 'Q10', 'Ubichinone']),
    ('alpha_lipoic_acid', 'Acido alfa-lipoico', 'nutraceutici', 'blood', 'numeric',
        'ng/ml', None, None, None,
        ['ALA', 'Acido α-lipoico', 'Acido alfa-lipoico']),

    # --- Metabolismo glucidico ---
    ('glucose', 'Glicemia', 'metabolismo', 'blood', 'numeric',
        'mg/dl', 70, 100, None,
        ['Glicemia', 'Glucosio (sangue)', 'Glucosio a digiuno', 'GLU']),
    ('hba1c', 'Emoglobina glicata (HbA1c)', 'metabolismo', 'blood', 'numeric',
        '%', 4.0, 5.6, None,
        ['HbA1c', 'Emoglobina glicata', 'Emoglobina glicosilata', 'A1c']),
    ('insulin', 'Insulina', 'metabolismo', 'blood', 'numeric',
        'µUI/ml', 2.6, 24.9, None,
        ['Insulina', 'Insulinemia']),

    # --- Profilo lipidico ---
    ('cholesterol_total', 'Colesterolo totale', 'lipidi', 'blood', 'numeric',
        'mg/dl', 0, 200, None,
        ['Colesterolo', 'Colesterolo tot.', 'Colesterolo totale', 'CT']),
    ('cholesterol_hdl', 'Colesterolo HDL', 'lipidi', 'blood', 'numeric',
        'mg/dl', 40, 100, None,
        ['HDL', 'Colesterolo HDL', 'HDL-C']),
    ('cholesterol_ldl', 'Colesterolo LDL', 'lipidi', 'blood', 'numeric',
        'mg/dl', 0, 115, None,
        ['LDL', 'Colesterolo LDL', 'LDL-C']),
    ('triglycerides', 'Trigliceridi', 'lipidi', 'blood', 'numeric',
        'mg/dl', 0, 150, None,
        ['Trigliceridi', 'TG']),

    # --- Elettroliti ---
    ('sodium', 'Sodio', 'elettroliti', 'blood', 'numeric',
        'mmol/l', 136, 145, None,
        ['Sodio', 'Na', 'Sodiemia']),
    ('potassium', 'Potassio', 'elettroliti', 'blood', 'numeric',
        'mmol/l', 3.5, 5.1, None,
        ['Potassio', 'K', 'Potassiemia']),
    ('chloride', 'Cloro', 'elettroliti', 'blood', 'numeric',
        'mmol/l', 98, 107, None,
        ['Cloro', 'Cl', 'Cloremia']),
    ('magnesium', 'Magnesio', 'elettroliti', 'blood', 'numeric',
        'mg/dl', 1.7, 2.4, None,
        ['Magnesio', 'Mg', 'Magnesiemia']),
    ('phosphorus', 'Fosforo', 'elettroliti', 'blood', 'numeric',
        'mg/dl', 2.5, 4.5, None,
        ['Fosforo', 'P', 'Fosfatemia', 'Fosforemia']),

    # --- Assetto marziale (ferro) ---
    ('iron', 'Ferro (sideremia)', 'ematologia', 'blood', 'numeric',
        'µg/dl', 65, 175, None,
        ['Ferro', 'Sideremia', 'Fe']),
    ('transferrin', 'Transferrina', 'ematologia', 'blood', 'numeric',
        'mg/dl', 200, 360, None,
        ['Transferrina']),
    ('transferrin_saturation', 'Saturazione transferrina', 'ematologia', 'blood',
        'numeric', '%', 20, 50, None,
        ['Saturazione transferrina', 'TSAT', '% saturazione transferrina']),

    # --- Fegato (integrazioni) ---
    ('alp', 'Fosfatasi alcalina (ALP)', 'fegato', 'blood', 'numeric',
        'U/l', 40, 129, None,
        ['ALP', 'Fosfatasi alcalina', 'FA']),
    ('direct_bilirubin', 'Bilirubina diretta', 'fegato', 'blood', 'numeric',
        'mg/dl', 0, 0.3, None,
        ['Bilirubina diretta', 'Bilirubina coniugata']),
    ('ldh', 'LDH (lattato deidrogenasi)', 'fegato', 'blood', 'numeric',
        'U/l', 135, 225, None,
        ['LDH', 'Lattato deidrogenasi']),

    # --- Proteine plasmatiche ---
    ('total_protein', 'Proteine totali', 'proteine', 'blood', 'numeric',
        'g/dl', 6.4, 8.3, None,
        ['Proteine totali', 'Protidemia tot.', 'PT']),
    ('albumin', 'Albumina', 'proteine', 'blood', 'numeric',
        'g/dl', 3.5, 5.2, None,
        ['Albumina', 'Albuminemia']),

    # --- Pancreas ---
    ('amylase', 'Amilasi', 'pancreas', 'blood', 'numeric',
        'U/l', 28, 100, None,
        ['Amilasi', 'Amilasemia']),
    ('lipase', 'Lipasi', 'pancreas', 'blood', 'numeric',
        'U/l', 13, 60, None,
        ['Lipasi', 'Lipasemia']),

    # --- Infiammazione ---
    ('crp', 'Proteina C reattiva (PCR)', 'infiammazione', 'blood', 'numeric',
        'mg/l', 0, 5, None,
        ['PCR', 'CRP', 'Proteina C reattiva', 'PCR hs']),

    # --- Ormoni sessuali (integrazioni) ---
    ('estradiol', 'Estradiolo (E2)', 'ormoni', 'blood', 'numeric',
        'pg/ml', 10, 50, None,
        ['Estradiolo', 'E2', '17β-estradiolo']),
    ('progesterone', 'Progesterone', 'ormoni', 'blood', 'numeric',
        'ng/ml', 0, 1.0, None,
        ['Progesterone', 'PRG']),
    ('shbg', 'SHBG', 'ormoni', 'blood', 'numeric',
        'nmol/l', 10, 80, None,
        ['SHBG', 'Sex hormone binding globulin', 'Globulina legante ormoni sessuali']),

    # --- Emocromo (core) ---
    ('hemoglobin', 'Emoglobina', 'ematologia', 'blood', 'numeric',
        'g/dl', 13.0, 17.0, None,
        ['Emoglobina (sangue)', 'Hb', 'HGB']),
    ('hematocrit', 'Ematocrito', 'ematologia', 'blood', 'numeric',
        '%', 40, 52, None,
        ['Ematocrito', 'HCT', 'Hct']),
    ('wbc', 'Globuli bianchi (WBC)', 'ematologia', 'blood', 'numeric',
        '10^3/µl', 4.0, 10.0, None,
        ['WBC', 'Globuli bianchi', 'Leucociti']),
    ('platelets', 'Piastrine', 'ematologia', 'blood', 'numeric',
        '10^3/µl', 150, 400, None,
        ['Piastrine', 'PLT', 'Plt']),
    ('mcv', 'MCV (volume corpuscolare medio)', 'ematologia', 'blood', 'numeric',
        'fl', 80, 100, None,
        ['MCV', 'Volume corpuscolare medio']),

    # ---------- URINE (17) ----------
    ('urine_color', 'Colore', 'urine', 'urine', 'textual', None, None, None,
        'giallo paglierino',
        ['Colore', 'Aspetto colore']),
    ('urine_appearance', 'Aspetto', 'urine', 'urine', 'qualitative',
        None, None, None, 'limpido',
        ['Aspetto', 'Torbidità']),
    ('urine_specific_gravity', 'Peso specifico', 'urine', 'urine', 'numeric',
        None, 1.005, 1.030, None,
        ['Peso specifico', 'PS', 'Densità']),
    ('urine_ph', 'pH', 'urine', 'urine', 'numeric', None, 5.0, 7.5, None,
        ['pH', 'pH urinario']),
    ('urine_protein', 'Proteine', 'urine', 'urine', 'semi_quantitative',
        None, None, None, 'assente',
        ['Proteine', 'Albumina urinaria', 'Proteinuria']),
    ('urine_glucose', 'Glucosio', 'urine', 'urine', 'semi_quantitative',
        None, None, None, 'assente',
        ['Glucosio', 'Glicosuria', 'Zuccheri']),
    ('urine_ketones', 'Chetoni', 'urine', 'urine', 'semi_quantitative',
        None, None, None, 'assente',
        ['Chetoni', 'Chetonuria', 'Acetone', 'Corpi chetonici']),
    ('urine_blood', 'Emoglobina/Sangue', 'urine', 'urine', 'semi_quantitative',
        None, None, None, 'assente',
        ['Sangue', 'Emoglobina', 'Ematuria', 'Hb urinaria']),
    ('urine_nitrites', 'Nitriti', 'urine', 'urine', 'qualitative',
        None, None, None, 'negativo',
        ['Nitriti', 'Nitriti urinari']),
    ('urine_leukocyte_esterase', 'Esterasi leucocitaria', 'urine', 'urine',
        'semi_quantitative', None, None, None, 'assente',
        ['Esterasi leucocitaria', 'Leucociti (striscia)']),
    ('urine_bilirubin', 'Bilirubina urinaria', 'urine', 'urine',
        'semi_quantitative', None, None, None, 'assente',
        ['Bilirubina urine', 'Bilirubina urinaria']),
    ('urine_urobilinogen', 'Urobilinogeno', 'urine', 'urine', 'numeric',
        'mg/dl', 0.2, 1.0, None,
        ['Urobilinogeno']),
    ('urine_erythrocytes_sediment', 'Eritrociti (sedimento)', 'urine', 'urine',
        'numeric', '/µl', 0, 25, None,
        ['Eritrociti', 'Emazie sedimento', 'Eritrociti sedimento']),
    ('urine_leukocytes_sediment', 'Leucociti (sedimento)', 'urine', 'urine',
        'numeric', '/µl', 0, 25, None,
        ['Leucociti sedimento', 'Leucociti urinari']),
    ('urine_epithelial_cells', 'Cellule epiteliali', 'urine', 'urine',
        'semi_quantitative', None, None, None, 'rare',
        ['Cellule epiteliali', 'Epiteli', 'Cellule di sfaldamento']),
    ('urine_bacteria', 'Batteri', 'urine', 'urine', 'semi_quantitative',
        None, None, None, 'assenti',
        ['Batteri', 'Flora batterica', 'Batteriuria']),
    ('urine_crystals', 'Cristalli', 'urine', 'urine', 'qualitative',
        None, None, None, 'assenti',
        ['Cristalli', 'Cristalluria']),
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
        analyte_id = conn.execute(insert_analyte, {
            'slug': slug,
            'name': name,
            'category': category,
            'specimen': specimen,
            'value_type': value_type,
            'unit': unit,
            'ref_low': ref_low,
            'ref_high': ref_high,
            'ref_text': ref_text,
        }).scalar_one()
        for alias in aliases:
            conn.execute(insert_alias, {'aid': analyte_id, 'alias': alias})


def downgrade() -> None:
    conn = op.get_bind()
    slugs = [row[0] for row in ANALYTES]
    # CASCADE on FK rimuove automaticamente gli alias.
    conn.execute(
        sa.text("DELETE FROM lab_analytes WHERE slug = ANY(:slugs)"),
        {'slugs': slugs},
    )
