"""Motore deterministico per le correlazioni esami ↔ regimi/note.

Trova coincidenze temporali fra una variazione marcata di un analita (o
l'uscita/rientro dal range di riferimento) fra due prelievi consecutivi e un
"evento" di regime/nota salute avvenuto nell'intervallo fra i due prelievi
(inizio / stop / cambio dose di un farmaco/integratore, inizio/fine di un
piano o di una nota di salute).

Niente statistica: con pochi prelievi una correlazione vera non e' calcolabile,
quindi ragioniamo per coincidenza temporale + ampiezza della variazione. Il
giudizio di plausibilita' farmacologica e' demandato al layer IA
(`lab_correlations_llm.py`); qui produciamo solo candidate ordinate.

Funzioni pure: ricevono righe gia' fetchate (niente sessione DB) cosi' sono
unit-testabili e riusabili dal router.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, asdict
from datetime import date

# --- Costanti tunabili ------------------------------------------------------
REL_DELTA_THRESHOLD = 0.20      # |variazione relativa| minima per segnalare
MAX_INTERVAL_DAYS = 120         # oltre questo intervallo fra i due prelievi: scarta
SWITCH_GAP_DAYS = 31            # gap max fra fine di un periodo e inizio del
                                # successivo per considerarlo un "cambio dose"
TOP_N_ANNOTATE = 12             # cap candidate da inviare all'IA

# Pesi dello score (solo per il ranking, NON un claim clinico).
W_DELTA = 0.4
W_OOR = 0.3
W_DIR = 0.2
W_PROX = 0.1

# kind di regime ammessi come possibili fattori.
REGIMEN_KINDS = ("medication", "supplement", "diet", "training", "gear")


def slugify_name(name: str) -> str:
    s = unicodedata.normalize("NFD", name or "").encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    return s or "x"


# --- Parsing dose free-text -------------------------------------------------

_DOSE_RE = re.compile(r"^\s*([0-9]+(?:[.,][0-9]+)?)\s*([a-zA-Zµ%/]+)?")


def parse_dose_magnitude(dose: str | None) -> tuple[float, str] | None:
    """Estrae (numero, unita') dal numero+unita' iniziale di una dose
    free-text. `"300mg"`→(300,'mg'), `"1 cp/die"`→(1,'cp/die'), `"2,5 mg"`→
    (2.5,'mg'). Ritorna None se non c'e' un numero iniziale."""
    if not dose:
        return None
    m = _DOSE_RE.match(dose)
    if not m:
        return None
    num = float(m.group(1).replace(",", "."))
    unit = (m.group(2) or "").lower()
    return num, unit


def _dose_change_type(old_dose: str | None, new_dose: str | None) -> str:
    """`dose_increase`/`dose_decrease` se confrontabili (unita' coincidenti),
    altrimenti `dose_changed`."""
    a = parse_dose_magnitude(old_dose)
    b = parse_dose_magnitude(new_dose)
    if a and b and a[1] == b[1]:
        if b[0] > a[0]:
            return "dose_increase"
        if b[0] < a[0]:
            return "dose_decrease"
        return "dose_changed"
    return "dose_changed"


# --- Strutture dati ---------------------------------------------------------

@dataclass
class Point:
    panel_id: int
    test_date: date
    value: float | None
    out_of_range: bool | None
    unit: str | None


@dataclass
class AnalyteSeries:
    id: int
    slug: str
    name: str
    category: str
    ref_low: float | None
    ref_high: float | None
    points: list[Point]


@dataclass
class RegimenRow:
    id: int
    kind: str
    name: str
    start_date: date | None
    end_date: date | None
    dose: str | None


@dataclass
class NoteRow:
    id: int
    category: str
    body_zone: str | None
    text: str
    start_date: date
    end_date: date


@dataclass
class Factor:
    source: str          # 'regimen' | 'health_note'
    kind: str            # regimen kind, oppure note category
    name: str
    change_type: str     # started|stopped|dose_increase|dose_decrease|dose_changed|note_started|note_resolved
    old_dose: str | None
    new_dose: str | None
    ref_id: int
    event_date: str      # ISO


# --- Eventi nell'intervallo -------------------------------------------------

def _regimen_events(
    regimens: list[RegimenRow], lo: date, hi: date
) -> list[Factor]:
    """Eventi di regime con event_date in (lo, hi]. Raggruppa per
    (kind, lower(name)) per riconoscere i cambi dose (riga che termina +
    riga successiva con dose diversa)."""
    groups: dict[tuple[str, str], list[RegimenRow]] = {}
    for r in regimens:
        groups.setdefault((r.kind, (r.name or "").strip().lower()), []).append(r)

    out: list[Factor] = []
    for (kind, _), rows in groups.items():
        rows = sorted(rows, key=lambda r: (r.start_date or date.min, r.id))
        for idx, r in enumerate(rows):
            prev = rows[idx - 1] if idx > 0 else None
            # Inizio periodo dentro l'intervallo.
            if r.start_date is not None and lo < r.start_date <= hi:
                is_switch = (
                    prev is not None
                    and prev.end_date is not None
                    and 0 <= (r.start_date - prev.end_date).days <= SWITCH_GAP_DAYS
                )
                if is_switch:
                    out.append(Factor(
                        source="regimen", kind=kind, name=r.name,
                        change_type=_dose_change_type(prev.dose, r.dose),
                        old_dose=prev.dose, new_dose=r.dose,
                        ref_id=r.id, event_date=r.start_date.isoformat(),
                    ))
                else:
                    out.append(Factor(
                        source="regimen", kind=kind, name=r.name,
                        change_type="started", old_dose=None, new_dose=r.dose,
                        ref_id=r.id, event_date=r.start_date.isoformat(),
                    ))
            # Fine periodo dentro l'intervallo (solo se non e' uno switch verso
            # un periodo successivo, gia' gestito come dose_change dell'altra riga).
            if r.end_date is not None and lo < r.end_date <= hi:
                nxt = rows[idx + 1] if idx + 1 < len(rows) else None
                is_switch_out = (
                    nxt is not None
                    and nxt.start_date is not None
                    and 0 <= (nxt.start_date - r.end_date).days <= SWITCH_GAP_DAYS
                )
                if not is_switch_out:
                    out.append(Factor(
                        source="regimen", kind=kind, name=r.name,
                        change_type="stopped", old_dose=r.dose, new_dose=None,
                        ref_id=r.id, event_date=r.end_date.isoformat(),
                    ))
    return out


def _note_events(notes: list[NoteRow], lo: date, hi: date) -> list[Factor]:
    out: list[Factor] = []
    for n in notes:
        if lo < n.start_date <= hi:
            out.append(Factor(
                source="health_note", kind=n.category, name=n.body_zone or n.text[:40],
                change_type="note_started", old_dose=None, new_dose=None,
                ref_id=n.id, event_date=n.start_date.isoformat(),
            ))
        if n.end_date != n.start_date and lo < n.end_date <= hi:
            out.append(Factor(
                source="health_note", kind=n.category, name=n.body_zone or n.text[:40],
                change_type="note_resolved", old_dose=None, new_dose=None,
                ref_id=n.id, event_date=n.end_date.isoformat(),
            ))
    return out


# --- Scoring ----------------------------------------------------------------

def _oor_transition(prev_oor: bool | None, cur_oor: bool | None) -> str:
    if prev_oor is False and cur_oor is True:
        return "crossed_in"
    if prev_oor is True and cur_oor is False:
        return "left"
    if prev_oor is True and cur_oor is True:
        return "stayed_oor"
    return "stayed_in"


def _dir_agrees(change_type: str, direction: str) -> bool:
    return (
        (change_type == "dose_increase" and direction == "up")
        or (change_type == "dose_decrease" and direction == "down")
    )


def _score(rel_delta: float | None, oor: str, change_type: str,
           direction: str, interval_days: int) -> float:
    delta_term = W_DELTA * min(abs(rel_delta or 0.0) / 0.5, 1.0)
    oor_term = W_OOR * (1.0 if oor == "crossed_in" else 0.5 if oor == "left" else 0.0)
    dir_term = W_DIR * (1.0 if _dir_agrees(change_type, direction) else 0.0)
    prox_term = W_PROX * max(0.0, 1.0 - interval_days / MAX_INTERVAL_DAYS)
    return round(delta_term + oor_term + dir_term + prox_term, 4)


# --- Entry point ------------------------------------------------------------

def compute_candidates(
    series: list[AnalyteSeries],
    regimens: list[RegimenRow],
    notes: list[NoteRow],
) -> list[dict]:
    """Ritorna la lista di candidate (dict) ordinata per score desc."""
    candidates: list[dict] = []
    for s in series:
        pts = [p for p in s.points if p.value is not None]
        pts.sort(key=lambda p: (p.test_date, p.panel_id))
        for i in range(1, len(pts)):
            prev, cur = pts[i - 1], pts[i]
            interval_days = (cur.test_date - prev.test_date).days
            if interval_days <= 0 or interval_days > MAX_INTERVAL_DAYS:
                continue
            abs_delta = cur.value - prev.value
            rel_delta = (abs_delta / prev.value) if prev.value not in (0, None) else None
            direction = "up" if abs_delta > 0 else "down" if abs_delta < 0 else "flat"
            oor = _oor_transition(prev.out_of_range, cur.out_of_range)

            significant = (
                (rel_delta is not None and abs(rel_delta) >= REL_DELTA_THRESHOLD)
                or oor in ("crossed_in", "left")
            )
            if not significant:
                continue

            events = (
                _regimen_events(regimens, prev.test_date, cur.test_date)
                + _note_events(notes, prev.test_date, cur.test_date)
            )
            for f in events:
                score = _score(rel_delta, oor, f.change_type, direction, interval_days)
                signature = (
                    f"{s.id}:{prev.panel_id}:{cur.panel_id}:"
                    f"{f.source}:{f.kind}:{slugify_name(f.name)}:{f.change_type}"
                )
                candidates.append({
                    "signature": signature,
                    "analyte_id": s.id,
                    "analyte_slug": s.slug,
                    "analyte_name": s.name,
                    "analyte_category": s.category,
                    "ref_low": s.ref_low,
                    "ref_high": s.ref_high,
                    "prev_panel_id": prev.panel_id,
                    "cur_panel_id": cur.panel_id,
                    "prev_date": prev.test_date.isoformat(),
                    "cur_date": cur.test_date.isoformat(),
                    "prev_value": prev.value,
                    "cur_value": cur.value,
                    "unit": cur.unit or prev.unit,
                    "abs_delta": round(abs_delta, 4),
                    "rel_delta": round(rel_delta, 4) if rel_delta is not None else None,
                    "direction": direction,
                    "oor_transition": oor,
                    "interval_days": interval_days,
                    "factor": asdict(f),
                    "score": score,
                })

    # Dedup per signature (tieni lo score piu' alto) e ordina.
    best: dict[str, dict] = {}
    for c in candidates:
        ex = best.get(c["signature"])
        if ex is None or c["score"] > ex["score"]:
            best[c["signature"]] = c
    out = sorted(best.values(), key=lambda c: c["score"], reverse=True)
    return out
