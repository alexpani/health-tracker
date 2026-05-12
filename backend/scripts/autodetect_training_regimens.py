"""Auto-detect periodi di allenamento dai workout sincronizzati e
crea regimen `kind='training'` con `source='training_autodetect'`.

Regola di rilevamento (configurabile via CLI):
- Stesso `(effective_type, source_name)` (es. `treadmill_run × Apple Watch 7`
  e' un periodo diverso da `type_37 × Strava`).
- Almeno N workout (default 10) in una finestra mobile di W giorni (default 30).
- Gap massimo G giorni (default 15) tra workout consecutivi dentro lo stesso periodo.

Uno "streak" e' una sequenza di workout consecutivi con gap <= G. Lo streak
diventa un regimen se contiene almeno una finestra mobile di W giorni con >= N
workout.

Per ogni streak che qualifica:
    Regimen(
      kind='training',
      name=<label effective_type> + " (" + <source_name> + ")",
      start_date=primo workout dello streak,
      end_date=NULL se ultimo workout entro G giorni da oggi (= "in corso"),
              altrimenti ultimo workout,
      dose="{n} sessioni in {days}gg (~{freq:.1f}/sett)",
      source='training_autodetect',
      notes="Generato automaticamente dai workout sincronizzati.",
    )

Idempotenza via UNIQUE parziale `uq_regimens_training_autodetect` su
`(kind, name, start_date, end_date) WHERE source='training_autodetect'`.

Uso:
    cd backend
    python -m scripts.autodetect_training_regimens [--dry-run|--commit]
                                                    [--min-count 10]
                                                    [--window-days 30]
                                                    [--max-gap 15]

Default: --dry-run. Output: tabella su stdout + TSV
`autodetect_training_report.tsv`.
"""
from __future__ import annotations

import argparse
import asyncio
import csv
from dataclasses import dataclass, asdict
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session as default_session_factory
from app.models import Regimen, Workout


# Mirror 1:1 di dashboard/src/lib/healthkit.ts:WORKOUT_NAMES.
# Mantenere allineato con quella tabella.
HK_ACTIVITY_NAME_IT: dict[int, str] = {
    1: "Football americano", 2: "Tiro con l'arco", 3: "Football australiano",
    4: "Badminton", 5: "Baseball", 6: "Basket", 7: "Bowling", 8: "Boxe",
    9: "Arrampicata", 10: "Cricket", 11: "Cross Training", 12: "Curling",
    13: "Ciclismo", 14: "Danza", 16: "Ellittica", 17: "Equitazione",
    18: "Scherma", 19: "Pesca", 20: "Functional Strength Training",
    21: "Golf", 22: "Ginnastica", 23: "Pallamano", 24: "Hiking",
    25: "Hockey", 26: "Caccia", 27: "Lacrosse", 28: "Arti marziali",
    29: "Mind & Body", 31: "Paddle", 32: "Gioco",
    33: "Preparazione e recupero", 34: "Racquetball", 35: "Rowing",
    36: "Rugby", 37: "Corsa", 38: "Vela", 39: "Pattinaggio",
    40: "Sport invernali", 41: "Calcio", 42: "Softball", 43: "Squash",
    44: "Stair Climbing", 45: "Surf", 46: "Nuoto", 47: "Ping pong",
    48: "Tennis", 49: "Atletica leggera",
    50: "Traditional Strength Training", 51: "Pallavolo",
    52: "Camminata", 53: "Water Fitness", 54: "Pallanuoto",
    55: "Water Sports", 56: "Lotta", 57: "Yoga", 58: "Barre",
    59: "Core Training", 60: "Sci di fondo", 61: "Sci alpino",
    62: "Flessibilita'", 63: "HIIT", 64: "Salto con la corda",
    65: "Kickboxing", 66: "Pilates", 67: "Snowboard", 68: "Scale",
    69: "Step", 70: "Carrozzina camminata", 71: "Carrozzina corsa",
    72: "Tai Chi", 73: "Cardio misto", 74: "Handbike", 75: "Disc sports",
    76: "Fitness gaming", 77: "Cardio dance", 78: "Danza sociale",
    79: "Pickleball", 80: "Cooldown", 82: "Allenamento funzionale",
    83: "Swim Bike Run", 84: "Transizione",
    3000: "Altro",
}


def effective_type_for(activity_type: int | None, metadata: dict | None) -> str:
    """Replica della logica EFFECTIVE_TYPE_SQL in app/routers/query.py."""
    if activity_type is None:
        return "type_unknown"
    md = metadata or {}
    if activity_type == 37 and str(md.get("HKIndoorWorkout") or "") == "1":
        return "treadmill_run"
    if activity_type == 52 and str(md.get("HKIndoorWorkout") or "") == "1":
        return "treadmill_walk"
    if activity_type == 13 and str(md.get("HKIndoorWorkout") or "") == "1":
        return "cyclette"
    if activity_type == 46 and str(md.get("HKSwimmingLocationType") or "") == "1":
        return "swim_pool"
    if activity_type == 46 and str(md.get("HKSwimmingLocationType") or "") == "2":
        return "swim_open_water"
    return f"type_{activity_type}"


def effective_type_label(et: str) -> str:
    """Etichetta italiana leggibile per un effective_type slug."""
    special = {
        "treadmill_run": "Corsa tapis roulant",
        "treadmill_walk": "Camminata tapis roulant",
        "cyclette": "Cyclette",
        "swim_pool": "Nuoto piscina",
        "swim_open_water": "Nuoto acque libere",
    }
    if et in special:
        return special[et]
    if et.startswith("type_"):
        try:
            t = int(et.split("_", 1)[1])
        except ValueError:
            return et
        return HK_ACTIVITY_NAME_IT.get(t, f"Attivita' tipo {t}")
    return et


@dataclass
class Period:
    effective_type: str
    source_name: str
    label: str
    name: str
    start_date: date
    end_date: date | None
    workout_count: int
    duration_days: int
    avg_per_week: float
    longest_gap_days: int
    peak_30d_count: int
    action: str  # 'insert' | 'skip-dup'


def detect_periods(
    workouts: list[tuple[date, str, str]],
    min_count: int,
    window_days: int,
    max_gap: int,
    today: date,
) -> list[Period]:
    """workouts: list of (date, effective_type, source_name). Ritorna periodi
    che soddisfano la regola.

    Dedup a livello (giorno, effective_type) PRIMA della detection: se nello
    stesso giorno ci sono workout dello stesso effective_type da sorgenti
    diverse (es. Apple Watch + Freeletics che scrivono entrambi la stessa
    sessione), contano come UN giorno. La sorgente assegnata alla fascia e'
    quella dominante (piu' giorni) nello streak; in caso di pareggio "Sorgenti
    multiple".
    """
    # giorno → effective_type → counter sorgenti
    day_et_sources: dict[tuple[date, str], dict[str, int]] = {}
    for d, et, src in workouts:
        day_et_sources.setdefault((d, et), {})
        day_et_sources[(d, et)][src] = day_et_sources[(d, et)].get(src, 0) + 1

    # raggruppa per effective_type: lista di (date, set_of_sources_that_day)
    groups: dict[str, list[tuple[date, set[str]]]] = {}
    for (d, et), srcs in day_et_sources.items():
        groups.setdefault(et, []).append((d, set(srcs.keys())))

    periods: list[Period] = []
    for et, day_entries in groups.items():
        day_entries.sort(key=lambda x: x[0])
        dates_sorted = [d for d, _ in day_entries]
        if len(dates_sorted) < min_count:
            continue

        # Spezza in streak con gap <= max_gap. Tieni traccia anche delle
        # sorgenti per ogni giorno per calcolare la "dominante" dello streak.
        date_to_sources = {d: s for d, s in day_entries}
        streaks: list[list[date]] = []
        cur: list[date] = [dates_sorted[0]]
        for d in dates_sorted[1:]:
            if (d - cur[-1]).days <= max_gap:
                cur.append(d)
            else:
                streaks.append(cur)
                cur = [d]
        streaks.append(cur)

        for streak in streaks:
            n = len(streak)
            if n < min_count:
                continue
            # Verifica finestra mobile window_days con >= min_count
            peak = 0
            i = 0
            for j in range(n):
                while (streak[j] - streak[i]).days > window_days:
                    i += 1
                peak = max(peak, j - i + 1)
            if peak < min_count:
                continue

            first, last = streak[0], streak[-1]
            duration = (last - first).days + 1
            weeks = max(duration / 7.0, 1.0 / 7.0)
            freq = n / weeks
            longest_gap = max(
                (streak[k] - streak[k - 1]).days for k in range(1, n)
            ) if n > 1 else 0

            end_date: date | None
            if (today - last).days <= max_gap:
                end_date = None
            else:
                end_date = last

            # Sorgente dominante: piu' giorni di copertura nello streak.
            # Tie → "Sorgenti multiple".
            src_days: dict[str, int] = {}
            for d in streak:
                for s in date_to_sources.get(d, set()):
                    src_days[s] = src_days.get(s, 0) + 1
            if not src_days:
                src = "—"
            else:
                max_days = max(src_days.values())
                winners = [s for s, v in src_days.items() if v == max_days]
                src = winners[0] if len(winners) == 1 else "Sorgenti multiple"

            label = effective_type_label(et)
            name = f"{label} ({src})" if src else label
            periods.append(Period(
                effective_type=et,
                source_name=src,
                label=label,
                name=name,
                start_date=first,
                end_date=end_date,
                workout_count=n,
                duration_days=duration,
                avg_per_week=round(freq, 2),
                longest_gap_days=longest_gap,
                peak_30d_count=peak,
                action="insert",
            ))

    periods.sort(key=lambda p: (p.start_date, p.name))
    return periods


async def fetch_workouts(db: AsyncSession) -> list[tuple[date, str, str]]:
    rows = (await db.execute(
        select(
            Workout.start_date,
            Workout.source_name,
            Workout.activity_type,
            Workout.metadata_,
        )
    )).all()
    out: list[tuple[date, str, str]] = []
    for sd, src, at, md in rows:
        if sd is None:
            continue
        et = effective_type_for(at, md)
        src_clean = (src or "").strip() or "—"
        out.append((sd.date() if hasattr(sd, "date") else sd, et, src_clean))
    return out


def _build_notes(p: Period) -> str:
    return (
        f"{p.workout_count} sessioni in {p.duration_days}gg "
        f"(~{p.avg_per_week:.1f}/sett). "
        f"Gap max {p.longest_gap_days}gg. Picco {p.peak_30d_count}/30gg. "
        "Generato automaticamente dai workout sincronizzati."
    )


async def run(
    commit: bool,
    min_count: int,
    window_days: int,
    max_gap: int,
    report_path: Path,
    refresh_open: bool,
) -> tuple[int, int, int, list[Period]]:
    """Ritorna (inserted, updated, skipped_dup, periods)."""
    inserted = 0
    updated = 0
    skipped_dup = 0

    async with default_session_factory() as db:  # type: AsyncSession
        workouts = await fetch_workouts(db)
        today = date.today()
        periods = detect_periods(
            workouts, min_count, window_days, max_gap, today
        )

        # Pre-carica le row autodetect esistenti indicizzate per start_date
        # cosi' lo refresh-open puo' fare match anche se name e' stato
        # modificato dall'utente.
        existing_rows = (await db.execute(
            select(Regimen).where(
                Regimen.source == "training_autodetect",
                Regimen.kind == "training",
            )
        )).scalars().all()
        # (start_date) → Regimen — assumiamo unicita' per start_date per
        # source=autodetect (uno streak inizia in un solo giorno).
        # In caso di collisione (raro) si tiene la prima.
        by_start: dict[date, Regimen] = {}
        for r in existing_rows:
            if r.start_date and r.start_date not in by_start:
                by_start[r.start_date] = r

        for p in periods:
            existing = by_start.get(p.start_date)

            if existing is None:
                # Nuova fascia: INSERT.
                if commit:
                    db.add(Regimen(
                        kind="training",
                        name=p.name,
                        dose=None,
                        start_date=p.start_date,
                        end_date=p.end_date,
                        source="training_autodetect",
                        notes=_build_notes(p),
                    ))
                p.action = "insert"
                inserted += 1
                continue

            # Esiste già una row autodetect con quel start_date.
            # Caso chiuso storico: mai toccare.
            if existing.end_date is not None:
                p.action = "skip-dup"
                skipped_dup += 1
                continue

            # Caso "in corso": refresh-open decide se aggiornare.
            if not refresh_open:
                p.action = "skip-dup"
                skipped_dup += 1
                continue

            new_notes = _build_notes(p)
            changed = False
            if existing.notes != new_notes:
                changed = True
            if existing.end_date != p.end_date:
                changed = True
            # name e dose NON vengono mai sovrascritti.
            if not changed:
                p.action = "skip-dup"
                skipped_dup += 1
                continue
            if commit:
                existing.notes = new_notes
                existing.end_date = p.end_date
            p.action = "update"
            updated += 1

        if commit:
            await db.commit()

    # TSV
    with report_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, dialect="excel-tab")
        w.writerow([
            "effective_type", "source_name", "label", "name",
            "start_date", "end_date", "workout_count",
            "duration_days", "avg_per_week", "longest_gap_days",
            "peak_30d_count", "action",
        ])
        for p in periods:
            w.writerow([
                p.effective_type, p.source_name, p.label, p.name,
                p.start_date.isoformat(),
                p.end_date.isoformat() if p.end_date else "(in corso)",
                p.workout_count, p.duration_days, p.avg_per_week,
                p.longest_gap_days, p.peak_30d_count, p.action,
            ])

    return inserted, updated, skipped_dup, periods


def print_table(periods: list[Period]) -> None:
    if not periods:
        print("Nessun periodo rilevato con le soglie correnti.")
        return
    headers = [
        "Nome", "Inizio", "Fine", "N", "Giorni",
        "Freq/sett", "Gap max", "Peak 30g", "Azione",
    ]
    rows = []
    for p in periods:
        rows.append([
            p.name,
            p.start_date.isoformat(),
            p.end_date.isoformat() if p.end_date else "(in corso)",
            str(p.workout_count),
            str(p.duration_days),
            f"{p.avg_per_week:.1f}",
            f"{p.longest_gap_days}gg",
            str(p.peak_30d_count),
            p.action,
        ])
    widths = [
        max(len(headers[i]), max((len(r[i]) for r in rows), default=0))
        for i in range(len(headers))
    ]
    def fmt(cells):
        return "  ".join(c.ljust(widths[i]) for i, c in enumerate(cells))
    print(fmt(headers))
    print(fmt(["-" * w for w in widths]))
    for r in rows:
        print(fmt(r))


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true",
                   help="Default. Stampa tabella e TSV, niente DB write.")
    g.add_argument("--commit", action="store_true",
                   help="Inserisce i periodi nel DB.")
    ap.add_argument("--min-count", type=int, default=10)
    ap.add_argument("--window-days", type=int, default=30)
    ap.add_argument("--max-gap", type=int, default=15)
    ap.add_argument("--report", default="autodetect_training_report.tsv")
    refresh = ap.add_mutually_exclusive_group()
    refresh.add_argument("--refresh-open", dest="refresh_open",
                         action="store_true", default=True,
                         help="(default) Aggiorna le fasce con end_date NULL.")
    refresh.add_argument("--no-refresh-open", dest="refresh_open",
                         action="store_false",
                         help="Pure idempotent: niente UPDATE, solo INSERT.")
    args = ap.parse_args()

    commit = bool(args.commit)
    report_path = Path(args.report)

    inserted, updated, skipped_dup, periods = asyncio.run(run(
        commit=commit,
        min_count=args.min_count,
        window_days=args.window_days,
        max_gap=args.max_gap,
        report_path=report_path,
        refresh_open=args.refresh_open,
    ))

    print()
    print_table(periods)
    print()
    mode = "COMMIT" if commit else "DRY-RUN"
    print(
        f"[{mode}] periods={len(periods)}, "
        f"new={inserted}, updated={updated}, skip-dup={skipped_dup}, "
        f"thresholds: min_count={args.min_count}, "
        f"window_days={args.window_days}, max_gap={args.max_gap}, "
        f"refresh_open={args.refresh_open}"
    )
    print(f"Report TSV: {report_path.resolve()}")


if __name__ == "__main__":
    main()
