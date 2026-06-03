"""Test del motore deterministico delle correlazioni esame ↔ regime/nota.

Funzioni pure, niente DB.
"""
from __future__ import annotations

from datetime import date

from app.services import lab_correlations as lc
from app.services.lab_correlations_llm import build_user_message, parse_annotation


def _series_transaminasi():
    return lc.AnalyteSeries(
        id=10, slug="alt", name="ALT (GPT)", category="fegato",
        ref_low=0.0, ref_high=40.0,
        points=[
            lc.Point(panel_id=1, test_date=date(2025, 1, 10), value=25.0,
                     out_of_range=False, unit="U/l"),
            lc.Point(panel_id=2, test_date=date(2025, 3, 10), value=75.0,
                     out_of_range=True, unit="U/l"),
        ],
    )


def test_dose_increase_detected_and_ranked():
    series = [_series_transaminasi()]
    regimens = [
        lc.RegimenRow(id=1, kind="medication", name="Allopurinolo",
                      start_date=date(2024, 6, 1), end_date=date(2025, 2, 1),
                      dose="100mg"),
        lc.RegimenRow(id=2, kind="medication", name="Allopurinolo",
                      start_date=date(2025, 2, 1), end_date=None, dose="300mg"),
    ]
    out = lc.compute_candidates(series, regimens, [])
    assert out, "deve emettere almeno una candidata"
    top = out[0]
    assert top["analyte_slug"] == "alt"
    assert top["factor"]["change_type"] == "dose_increase"
    assert top["factor"]["old_dose"] == "100mg"
    assert top["factor"]["new_dose"] == "300mg"
    assert top["oor_transition"] == "crossed_in"
    assert top["direction"] == "up"
    # direzione dose concorde con l'aumento dell'analita → score alto
    assert top["score"] > 0.5


def test_no_event_no_candidate():
    series = [_series_transaminasi()]
    # Regime che non cambia nell'intervallo (sempre attivo, nessun evento).
    regimens = [
        lc.RegimenRow(id=1, kind="medication", name="Tachipirina",
                      start_date=date(2020, 1, 1), end_date=None, dose="500mg"),
    ]
    assert lc.compute_candidates(series, regimens, []) == []


def test_small_change_no_candidate():
    series = [lc.AnalyteSeries(
        id=11, slug="x", name="X", category="c", ref_low=0.0, ref_high=100.0,
        points=[
            lc.Point(panel_id=1, test_date=date(2025, 1, 1), value=50.0,
                     out_of_range=False, unit="u"),
            lc.Point(panel_id=2, test_date=date(2025, 2, 1), value=52.0,
                     out_of_range=False, unit="u"),  # +4%, sotto soglia, no OOR
        ],
    )]
    regimens = [lc.RegimenRow(id=1, kind="supplement", name="Y",
                              start_date=date(2025, 1, 15), end_date=None, dose="1cp")]
    assert lc.compute_candidates(series, regimens, []) == []


def test_parse_dose_magnitude():
    assert lc.parse_dose_magnitude("300mg") == (300.0, "mg")
    assert lc.parse_dose_magnitude("2,5 mg") == (2.5, "mg")
    assert lc.parse_dose_magnitude("1 cp/die") == (1.0, "cp/die")
    assert lc.parse_dose_magnitude(None) is None
    assert lc.parse_dose_magnitude("una compressa") is None


def test_dose_change_type_units_mismatch_degrades():
    # unita' diverse → non confrontabili → dose_changed generico
    assert lc._dose_change_type("1cp", "300mg") == "dose_changed"
    assert lc._dose_change_type("100mg", "300mg") == "dose_increase"
    assert lc._dose_change_type("300mg", "100mg") == "dose_decrease"


def test_llm_helpers():
    cand = {
        "analyte_name": "ALT", "analyte_category": "fegato",
        "direction": "up", "rel_delta": 2.0, "oor_transition": "crossed_in",
        "interval_days": 59, "prev_value": 25, "cur_value": 75, "unit": "U/l",
        "factor": {"source": "regimen", "name": "Allopurinolo",
                   "change_type": "dose_increase", "old_dose": "100mg",
                   "new_dose": "300mg", "event_date": "2025-02-01"},
    }
    msg = build_user_message(cand)
    assert "Allopurinolo" in msg and "ALT" in msg
    ann = parse_annotation({"plausibility": "HIGH", "is_known_association": True,
                            "mechanism_text": " ok "})
    assert ann.plausibility == "high"  # clamp/lower
    assert ann.is_known_association is True
    assert ann.mechanism_text == "ok"
    # valore non valido → clamp a none
    assert parse_annotation({"plausibility": "boh"}).plausibility == "none"
