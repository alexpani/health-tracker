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


def test_dose_change_before_prev_draw_is_lagged():
    # Allopurinolo 300→100mg il 9/05, prelievi 1/06 (4.7) e 13/10 (6.2):
    # il cambio precede il primo prelievo ma l'effetto si vede al secondo.
    series = [lc.AnalyteSeries(
        id=12, slug="uric_acid", name="Acido urico", category="metabolismo",
        ref_low=3.4, ref_high=7.0,
        points=[
            lc.Point(panel_id=1, test_date=date(2026, 6, 1), value=4.7,
                     out_of_range=False, unit="mg/dl"),
            lc.Point(panel_id=2, test_date=date(2026, 10, 13), value=6.2,
                     out_of_range=False, unit="mg/dl"),
        ],
    )]
    regimens = [
        lc.RegimenRow(id=1, kind="medication", name="Allopurinolo",
                      start_date=date(2026, 2, 27), end_date=date(2026, 5, 8), dose="300mg"),
        lc.RegimenRow(id=2, kind="medication", name="Allopurinolo",
                      start_date=date(2026, 5, 9), end_date=None, dose="100mg"),
    ]
    out = lc.compute_candidates(series, regimens, [])
    assert len(out) == 1
    f = out[0]["factor"]
    assert f["change_type"] == "dose_decrease"
    assert f["before_prev_draw"] is True
    active = lc.active_regimens_on(regimens, date(2026, 10, 13))
    assert active == [{"kind": "medication", "name": "Allopurinolo", "dose": "100mg"}]


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
    assert "Contesto allenamenti" not in msg
    cand.update(prev_date="2025-01-01", cur_date="2025-03-01", workout_context={
        "prev": {"last": {"date": "2024-12-31", "days_before": 1, "type": "corsa",
                          "minutes": 54, "km": 7.2}, "same_day": [],
                 "d7": {"count": 3, "minutes": 150, "km": 20.0},
                 "d30": {"count": 12, "minutes": 600, "km": 80.0}},
        "cur": {"last": None, "same_day": [], "d7": {"count": 0, "minutes": 0, "km": 0},
                "d30": {"count": 0, "minutes": 0, "km": 0}},
    })
    msg = build_user_message(cand)
    assert "2025-01-01" in msg and "2025-03-01" in msg
    assert "ultimo workout il 2024-12-31 (1 giorni prima): corsa 54 min" in msg
    assert "nessun workout registrato prima del prelievo" in msg
    cand["factor"]["before_prev_draw"] = True
    cand["therapy_context"] = {"prev": [{"kind": "medication", "name": "Allopurinolo", "dose": "100mg"}], "cur": []}
    msg = build_user_message(cand)
    assert "effetto ritardato" in msg
    assert "in corso al prelievo del 2025-01-01: Allopurinolo 100mg" in msg
    assert "Composizione corporea" not in msg
    cand["body_context"] = {
        "prev": {"weight_kg": 76.6, "weight_kg_date": "2024-12-30",
                 "body_fat_pct": 20.3, "lean_mass_kg": 61.0},
        "cur": {},
    }
    msg = build_user_message(cand)
    assert "prelievo del 2025-01-01: peso 76.6 kg (del 2024-12-30), massa grassa 20.3%, massa magra 61.0 kg" in msg
    assert "prelievo del 2025-03-01: nessun dato nei 14 giorni precedenti" in msg
    ann = parse_annotation({"plausibility": "HIGH", "is_known_association": True,
                            "mechanism_text": " ok "})
    assert ann.plausibility == "high"  # clamp/lower
    assert ann.is_known_association is True
    assert ann.mechanism_text == "ok"
    # valore non valido → clamp a none
    assert parse_annotation({"plausibility": "boh"}).plausibility == "none"


def test_input_hash_tracks_values_and_therapies():
    def regimens(extra=None):
        rows = [
            lc.RegimenRow(id=1, kind="medication", name="Allopurinolo",
                          start_date=date(2024, 6, 1), end_date=date(2025, 2, 1),
                          dose="100mg"),
            lc.RegimenRow(id=2, kind="medication", name="Allopurinolo",
                          start_date=date(2025, 2, 1), end_date=None, dose="300mg"),
        ]
        return rows + (extra or [])

    def top(series, regs):
        out = lc.compute_candidates([series], regs, [])
        return next(c for c in out if c["factor"]["change_type"] == "dose_increase")

    base = top(_series_transaminasi(), regimens())
    # Stessi dati → stessa impronta (deterministica).
    assert top(_series_transaminasi(), regimens())["input_hash"] == base["input_hash"]

    # Valore dell'esame corretto → stessa signature, impronta diversa.
    s = _series_transaminasi()
    s.points[1].value = 80.0
    changed = top(s, regimens())
    assert changed["signature"] == base["signature"]
    assert changed["input_hash"] != base["input_hash"]

    # Integratore concomitante aggiunto (attivo a entrambi i prelievi, quindi
    # nessun nuovo evento) → impronta diversa.
    supp = lc.RegimenRow(id=3, kind="supplement", name="Omega 3",
                         start_date=date(2020, 1, 1), end_date=None, dose="1g")
    with_supp = top(_series_transaminasi(), regimens([supp]))
    assert with_supp["signature"] == base["signature"]
    assert with_supp["input_hash"] != base["input_hash"]

    # Dose corretta sul regime → impronta diversa.
    regs = regimens()
    regs[1].dose = "200mg"
    assert top(_series_transaminasi(), regs)["input_hash"] != base["input_hash"]


def _statina_stop_case(note_start, note_end=None):
    series = [lc.AnalyteSeries(
        id=34, slug="cholesterol_total", name="Colesterolo totale",
        category="lipidi", ref_low=None, ref_high=200.0,
        points=[
            lc.Point(panel_id=60, test_date=date(2026, 10, 13), value=151.0,
                     out_of_range=False, unit="mg/dl"),
            lc.Point(panel_id=61, test_date=date(2026, 11, 2), value=268.0,
                     out_of_range=True, unit="mg/dl"),
        ],
    )]
    regimens = [lc.RegimenRow(
        id=5, kind="medication", name="Rosuvastatina + Ezetimibe",
        start_date=date(2025, 1, 1), end_date=date(2026, 10, 21), dose="10+10",
    )]
    notes = [lc.NoteRow(
        id=9, category="other", body_zone=None,
        text="La dottoressa mi ha proposto di sospendere la statina",
        start_date=note_start, end_date=note_end or note_start,
    )]
    return lc.compute_candidates(series, regimens, notes)


def test_note_near_regimen_event_is_merged():
    out = _statina_stop_case(date(2026, 10, 21))
    assert len(out) == 1, "la nota non deve generare una candidata separata"
    f = out[0]["factor"]
    assert f["source"] == "regimen" and f["change_type"] == "stopped"
    assert [n["id"] for n in f["related_notes"]] == [9]

    msg = build_user_message(out[0])
    assert "La dottoressa mi ha proposto di sospendere la statina" in msg
    assert "dose assunta fino ad allora: 10+10" in msg


def test_note_far_from_regimen_event_stays_separate():
    out = _statina_stop_case(date(2026, 10, 1))  # 20 giorni prima dello stop
    sources = sorted(c["factor"]["source"] for c in out)
    assert sources == ["health_note", "regimen"]
    reg = next(c for c in out if c["factor"]["source"] == "regimen")
    assert reg["factor"]["related_notes"] == []


def test_related_note_changes_input_hash():
    merged = _statina_stop_case(date(2026, 10, 21))[0]
    far = next(c for c in _statina_stop_case(date(2026, 10, 1))
               if c["factor"]["source"] == "regimen")
    assert merged["signature"] == far["signature"]
    assert merged["input_hash"] != far["input_hash"]


def test_whole_note_merged_even_if_it_ends_later():
    # Nota dal giorno dello stop fino al giorno del prelievo: anche la "fine"
    # della nota (lontana dallo stop) non deve creare una candidata separata.
    out = _statina_stop_case(date(2026, 10, 21), date(2026, 11, 2))
    assert len(out) == 1
    notes = out[0]["factor"]["related_notes"]
    assert len(notes) == 1 and notes[0]["end_date"] == "2026-11-02"
    assert "dal 2026-10-21 al 2026-11-02" in build_user_message(out[0])
