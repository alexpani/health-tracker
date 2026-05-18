"""Day aggregator router.

`GET /api/v1/day/{YYYY-MM-DD}` ritorna in un singolo JSON tutto cio' che il
DB ha per il giorno richiesto: attivita' (daily_stats), corpo (latest <=
EOD), vitali (aggregati health_samples), nutrizione (diario + HK dietary),
sonno (CategorySample sleepAnalysis), workout, panel lab, regimi attivi.

L'endpoint riusa solo le tabelle/funzioni esistenti — niente nuova logica
di calcolo. Le query sono lanciate in parallelo con asyncio.gather.
"""
from __future__ import annotations

import asyncio
import os
from datetime import date as date_cls, datetime, time, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from zoneinfo import ZoneInfo

from app.database import get_db
from app.models import (
    CategorySample,
    DailyStat,
    HealthNote,
    HealthSample,
    JournalEntry,
    Regimen,
    Workout,
)
from app.models.lab import LabPanel, LabResult

router = APIRouter(prefix="/api/v1/day", tags=["day"])

DIARIO_BASE_URL = os.environ.get("DIARIO_BASE_URL", "http://192.168.68.173:3000")

# --- attivita' (daily_stats / 9 tipi cumulative) ---
ACTIVITY_KEY = {
    "HKQuantityTypeIdentifierStepCount": "steps",
    "HKQuantityTypeIdentifierDistanceWalkingRunning": "distance_walking_running_m",
    "HKQuantityTypeIdentifierDistanceCycling": "distance_cycling_m",
    "HKQuantityTypeIdentifierDistanceSwimming": "distance_swimming_m",
    "HKQuantityTypeIdentifierFlightsClimbed": "flights",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "active_kcal",
    "HKQuantityTypeIdentifierBasalEnergyBurned": "basal_kcal",
    "HKQuantityTypeIdentifierAppleExerciseTime": "exercise_min",
    "HKQuantityTypeIdentifierAppleStandTime": "stand_min",
    "HKQuantityTypeIdentifierAppleMoveTime": "move_min",
}

# --- body (latest sample <= EOD del giorno) ---
BODY_TYPES = {
    "HKQuantityTypeIdentifierBodyMass": "weight_kg",
    "HKQuantityTypeIdentifierBodyMassIndex": "bmi",
    "HKQuantityTypeIdentifierBodyFatPercentage": "body_fat_pct",
    "HKQuantityTypeIdentifierLeanBodyMass": "lean_mass_kg",
    "HKQuantityTypeIdentifierWaistCircumference": "waist_m",
    "HKQuantityTypeIdentifierHeight": "height_m",
}

# --- vitali (aggregato AVG/MIN/MAX nel giorno) ---
VITAL_AVG_TYPES = {
    "HKQuantityTypeIdentifierHeartRate": "hr",
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": "hrv_ms_avg",
    "HKQuantityTypeIdentifierOxygenSaturation": "spo2",
    "HKQuantityTypeIdentifierBloodPressureSystolic": "bp_systolic",
    "HKQuantityTypeIdentifierBloodPressureDiastolic": "bp_diastolic",
    "HKQuantityTypeIdentifierRespiratoryRate": "respiratory_rate",
    "HKQuantityTypeIdentifierBodyTemperature": "temp_c",
    "HKQuantityTypeIdentifierRestingHeartRate": "resting_hr",
}

# --- nutrizione HK (sum giornaliero) ---
NUTRITION_TYPES = {
    "HKQuantityTypeIdentifierDietaryEnergyConsumed": "kcal_hk",
    "HKQuantityTypeIdentifierDietaryProtein": "protein_g_hk",
    "HKQuantityTypeIdentifierDietaryFatTotal": "fat_g_hk",
    "HKQuantityTypeIdentifierDietaryCarbohydrates": "carbs_g_hk",
    "HKQuantityTypeIdentifierDietaryFiber": "fiber_g",
    "HKQuantityTypeIdentifierDietarySugar": "sugar_g",
    "HKQuantityTypeIdentifierDietaryWater": "water_l",
    "HKQuantityTypeIdentifierDietaryCaffeine": "caffeine_g",
}

SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis"
# Apple sleep stage values (HKCategoryValueSleepAnalysis):
#   0 inBed, 1 asleepUnspecified, 2 awake,
#   3 asleepCore, 4 asleepDeep, 5 asleepREM
SLEEP_STAGE_NAMES = {
    0: "in_bed",
    1: "asleep_unspecified",
    2: "awake",
    3: "core",
    4: "deep",
    5: "rem",
}


# Single-user self-hosted: bounds del giorno in fuso locale italiano.
# Senza tz-aware bounds, datetime naive verrebbero interpretati come UTC e
# i sample fra mezzanotte locale e mezzanotte UTC (2h in CEST) finirebbero
# nel giorno sbagliato — incoerente con la pagina /sleep che bucketizza in
# local time lato dashboard.
LOCAL_TZ = ZoneInfo("Europe/Rome")


def _local_day_bounds(d: date_cls) -> tuple[datetime, datetime]:
    """[SOD, EOD) in fuso Europe/Rome, tz-aware (Postgres lo confronta
    correttamente contro le colonne TIMESTAMPTZ)."""
    sod = datetime.combine(d, time.min, tzinfo=LOCAL_TZ)
    eod = sod + timedelta(days=1)
    return sod, eod


async def _fetch_activity(db: AsyncSession, d: date_cls) -> dict:
    rows = (
        await db.execute(
            select(DailyStat.type, DailyStat.value)
            .where(DailyStat.type.in_(ACTIVITY_KEY.keys()))
            .where(DailyStat.date == d)
            .where(or_(DailyStat.source.is_(None), DailyStat.source == "_all_"))
        )
    ).all()
    out: dict[str, float | None] = {v: None for v in ACTIVITY_KEY.values()}
    for t, v in rows:
        out[ACTIVITY_KEY[t]] = float(v)
    return out


async def _fetch_body(db: AsyncSession, d: date_cls) -> dict:
    """Latest body sample with start_date <= EOD. We do one query per type
    (fast: indexed on (type, start_date) and limited to 1 row)."""
    sod, eod = _local_day_bounds(d)
    out: dict[str, dict | None] = {v: None for v in BODY_TYPES.values()}
    for t, key in BODY_TYPES.items():
        row = (
            await db.execute(
                select(HealthSample.value, HealthSample.unit, HealthSample.start_date)
                .where(HealthSample.type == t)
                .where(HealthSample.start_date < eod)
                .order_by(HealthSample.start_date.desc())
                .limit(1)
            )
        ).first()
        if row:
            out[key] = {
                "value": float(row[0]),
                "unit": row[1],
                "start_date": row[2].isoformat(),
            }
    return out


async def _fetch_vitals(db: AsyncSession, d: date_cls) -> dict:
    sod, eod = _local_day_bounds(d)
    out: dict[str, Any] = {}
    rows = (
        await db.execute(
            select(
                HealthSample.type,
                func.avg(HealthSample.value).label("avg"),
                func.min(HealthSample.value).label("min"),
                func.max(HealthSample.value).label("max"),
                func.count().label("n"),
            )
            .where(HealthSample.type.in_(VITAL_AVG_TYPES.keys()))
            .where(HealthSample.start_date >= sod)
            .where(HealthSample.start_date < eod)
            .group_by(HealthSample.type)
        )
    ).all()

    # Default keys = None
    for key in VITAL_AVG_TYPES.values():
        out[key + "_avg" if not key.endswith("_avg") else key] = None

    out["hr_avg"] = None
    out["hr_min"] = None
    out["hr_max"] = None

    for t, avg, vmin, vmax, n in rows:
        key = VITAL_AVG_TYPES[t]
        if t == "HKQuantityTypeIdentifierHeartRate":
            out["hr_avg"] = round(float(avg), 1) if avg is not None else None
            out["hr_min"] = round(float(vmin), 1) if vmin is not None else None
            out["hr_max"] = round(float(vmax), 1) if vmax is not None else None
        else:
            out[key] = round(float(avg), 2) if avg is not None else None
    return out


async def _fetch_nutrition(db: AsyncSession, d: date_cls) -> dict:
    """Combina diario alimentare (preferito quando disponibile) + HK dietary
    sum. Se il diario non ha dati per quel giorno, ricade sui valori HK."""
    sod, eod = _local_day_bounds(d)
    rows = (
        await db.execute(
            select(HealthSample.type, func.sum(HealthSample.value).label("sum"))
            .where(HealthSample.type.in_(NUTRITION_TYPES.keys()))
            .where(HealthSample.start_date >= sod)
            .where(HealthSample.start_date < eod)
            .group_by(HealthSample.type)
        )
    ).all()
    hk: dict[str, float | None] = {v: None for v in NUTRITION_TYPES.values()}
    for t, s in rows:
        hk[NUTRITION_TYPES[t]] = float(s) if s is not None else None

    # Diario (proxy) — best-effort, niente errori se irraggiungibile.
    diario: dict[str, Any] | None = None
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(
                f"{DIARIO_BASE_URL}/api/external/daily-totals",
                params={"from": d.isoformat(), "to": d.isoformat()},
            )
            if r.status_code == 200:
                arr = r.json()
                if isinstance(arr, list) and arr:
                    diario = arr[0]
    except Exception:
        diario = None

    out: dict[str, Any] = {
        "kcal": (diario or {}).get("kcal"),
        "kcal_target": (diario or {}).get("kcal_target"),
        "protein_g": (diario or {}).get("protein_g"),
        "fat_g": (diario or {}).get("fat_g"),
        "carbs_g": (diario or {}).get("carbs_g"),
        # HK fallback
        "kcal_hk": hk["kcal_hk"],
        "protein_g_hk": hk["protein_g_hk"],
        "fat_g_hk": hk["fat_g_hk"],
        "carbs_g_hk": hk["carbs_g_hk"],
        # solo HK
        "fiber_g": hk["fiber_g"],
        "sugar_g": hk["sugar_g"],
        "water_l": hk["water_l"],
        "caffeine_g": hk["caffeine_g"],
        "diario_present": diario is not None,
    }
    # Se il diario non ha numeri, usa HK come fallback display.
    if out["kcal"] is None:
        out["kcal"] = out["kcal_hk"]
        out["protein_g"] = out["protein_g_hk"]
        out["fat_g"] = out["fat_g_hk"]
        out["carbs_g"] = out["carbs_g_hk"]
    return out


async def _fetch_sleep(db: AsyncSession, d: date_cls) -> dict | None:
    """Sleep e' un caso particolare: i sample della notte fra (d-1) e d
    hanno end_date al mattino di d. Prendiamo i sample il cui end_date
    cade nel giorno richiesto."""
    sod, eod = _local_day_bounds(d)
    rows = (
        await db.execute(
            select(
                CategorySample.value,
                CategorySample.start_date,
                CategorySample.end_date,
            )
            .where(CategorySample.type == SLEEP_TYPE)
            .where(CategorySample.end_date >= sod)
            .where(CategorySample.end_date < eod)
            .order_by(CategorySample.start_date.asc())
        )
    ).all()
    if not rows:
        return None

    by_stage: dict[str, float] = {}
    earliest = rows[0][1]
    latest = rows[0][2]
    for value, start, end in rows:
        seconds = (end - start).total_seconds()
        if seconds <= 0:
            continue
        stage = SLEEP_STAGE_NAMES.get(int(value), "asleep_unspecified")
        by_stage[stage] = by_stage.get(stage, 0.0) + seconds
        if start < earliest:
            earliest = start
        if end > latest:
            latest = end

    def _min(stage: str) -> int:
        return int(round(by_stage.get(stage, 0.0) / 60.0))

    in_bed = _min("in_bed")
    # Stage 1 (asleep_unspecified) e' un wrapper che copre l'intera notte e
    # viene sovrascritto dai sample dettagliati Core/Deep/REM: sommarlo
    # produce double-count rispetto alla pagina /sleep (che lo esclude).
    asleep = _min("core") + _min("deep") + _min("rem")
    return {
        "in_bed_min": in_bed if in_bed > 0 else None,
        "asleep_min": asleep if asleep > 0 else None,
        "core_min": _min("core") or None,
        "deep_min": _min("deep") or None,
        "rem_min": _min("rem") or None,
        "awake_min": _min("awake") or None,
        "start": earliest.isoformat(),
        "end": latest.isoformat(),
    }


async def _fetch_workouts(db: AsyncSession, d: date_cls) -> list[dict]:
    sod, eod = _local_day_bounds(d)
    rows = (
        await db.execute(
            select(Workout)
            .where(Workout.start_date >= sod)
            .where(Workout.start_date < eod)
            .order_by(Workout.start_date.asc())
        )
    ).scalars().all()
    return [
        {
            "uuid": str(w.uuid),
            "activity_type": w.activity_type,
            "activity_name": w.activity_name,
            "duration": w.duration,
            "total_distance": w.total_distance,
            "total_energy_burned": w.total_energy_burned,
            "start_date": w.start_date.isoformat(),
            "end_date": w.end_date.isoformat(),
            "source_name": w.source_name,
            "title": w.title,
            "notes": w.notes,
        }
        for w in rows
    ]


async def _fetch_lab_panels(db: AsyncSession, d: date_cls) -> list[dict]:
    rows = (
        await db.execute(
            select(LabPanel)
            .where(LabPanel.test_date == d)
            .order_by(LabPanel.id.desc())
        )
    ).scalars().all()
    out = []
    for p in rows:
        # count results + out_of_range
        cnt_total = (
            await db.execute(
                select(func.count()).select_from(LabResult).where(LabResult.panel_id == p.id)
            )
        ).scalar() or 0
        cnt_oor = (
            await db.execute(
                select(func.count())
                .select_from(LabResult)
                .where(LabResult.panel_id == p.id)
                .where(LabResult.out_of_range.is_(True))
            )
        ).scalar() or 0
        out.append(
            {
                "id": p.id,
                "test_date": p.test_date.isoformat(),
                "lab_name": p.lab_name,
                "specimen_types": list(p.specimen_types or []),
                "status": p.status,
                "results_count": int(cnt_total),
                "out_of_range_count": int(cnt_oor),
            }
        )
    return out


async def _fetch_journal(db: AsyncSession, d: date_cls) -> list[JournalEntry]:
    """Lista delle voci diario per il giorno (N voci possibili),
    ordinate per `created_at` ascendente."""
    rows = (
        await db.execute(
            select(JournalEntry)
            .where(JournalEntry.date == d)
            .order_by(JournalEntry.created_at.asc(), JournalEntry.id.asc())
        )
    ).scalars().all()
    return list(rows)


async def _fetch_health_notes(db: AsyncSession, d: date_cls) -> list[HealthNote]:
    """Note di salute attive nel giorno (start_date <= d <= end_date)."""
    rows = (
        await db.execute(
            select(HealthNote)
            .where(and_(HealthNote.start_date <= d, HealthNote.end_date >= d))
            .order_by(HealthNote.category.asc(), HealthNote.id.desc())
        )
    ).scalars().all()
    return list(rows)


async def _fetch_regimens_active(db: AsyncSession, d: date_cls) -> list[Regimen]:
    """Regimi manuali attivi nel giorno. Escludiamo `kind='diet'`: i piani
    alimentari vengono dal diario-alimentare via `_fetch_diet_plan`,
    non si inseriscono a mano."""
    rows = (
        await db.execute(
            select(Regimen)
            .where(Regimen.kind != "diet")
            .where(or_(Regimen.start_date.is_(None), Regimen.start_date <= d))
            .where(or_(Regimen.end_date.is_(None), Regimen.end_date >= d))
            .order_by(Regimen.kind.asc(), Regimen.name.asc())
        )
    ).scalars().all()
    return list(rows)


async def _fetch_diet_plan(d: date_cls) -> dict | None:
    """Recupera il piano alimentare attivo nel giorno dal diario-alimentare.

    L'autorita' e' `daily-totals?from=d&to=d`: il diario ritorna
    `kcal_target` solo per giorni in cui c'era un piano attivo (snapshot
    storico). Se per quel giorno il diario non ha record / non ha un
    `kcal_target`, *non c'era piano*: ritorniamo None.

    `active-plan` ci da' il NOME e i grammi-target del piano CORRENTE; lo
    usiamo solo quando il `kcal_target` storico del giorno combacia col
    piano corrente (allora siamo confidenti che e' lo stesso piano).
    Altrimenti mostriamo "Piano alimentare" generico, segnalando che il
    nome storico non e' conosciuto.

    Ritorna None se: diario irraggiungibile, oppure nessun piano in vigore
    quel giorno.
    """
    iso = d.isoformat()
    target: float | None = None
    name: str | None = None
    plan_kcal: float | None = None
    macros: dict[str, float | None] = {"protein_g": None, "fat_g": None, "carbs_g": None}

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r1 = await client.get(
                f"{DIARIO_BASE_URL}/api/external/daily-totals",
                params={"from": iso, "to": iso},
            )
            if r1.status_code == 200:
                arr = r1.json()
                if isinstance(arr, list) and arr:
                    target = arr[0].get("kcal_target")
            r2 = await client.get(f"{DIARIO_BASE_URL}/api/external/active-plan")
            if r2.status_code == 200:
                p = r2.json()
                if isinstance(p, dict):
                    name = p.get("name")
                    plan_kcal = p.get("kcal_target")
                    macros["protein_g"] = p.get("protein_g")
                    macros["fat_g"] = p.get("fat_g")
                    macros["carbs_g"] = p.get("carbs_g")
    except Exception:
        return None

    # Niente target storico → due casi:
    #  - giorno passato senza registrazioni → nessun piano attivo, return None
    #  - giorno >= oggi → l'utente non ha ancora registrato nulla MA il piano
    #    corrente e' attivo. Cadiamo sui dati di `active-plan` come fallback
    #    (altrimenti la card "Piano alimentare" sotto Regimi attivi sparisce
    #    su /day/<oggi> finche' non si mangia il primo boccone).
    if target is None:
        if d >= date_cls.today() and plan_kcal is not None:
            return {
                "name": name or "Piano alimentare",
                "kcal_target": plan_kcal,
                "protein_g": macros["protein_g"],
                "fat_g": macros["fat_g"],
                "carbs_g": macros["carbs_g"],
                "name_is_historic_guess": False,
            }
        return None

    # Stesso target del piano corrente? probabile sia lo stesso piano:
    # mostriamo nome + macros. Altrimenti generico, senza nome.
    same_as_current = (
        plan_kcal is not None and abs(target - plan_kcal) < 1e-3
    )
    return {
        "name": name if same_as_current else "Piano alimentare",
        "kcal_target": target,
        "protein_g": macros["protein_g"] if same_as_current else None,
        "fat_g": macros["fat_g"] if same_as_current else None,
        "carbs_g": macros["carbs_g"] if same_as_current else None,
        "name_is_historic_guess": not same_as_current,
    }


@router.get("/{day_str}")
async def get_day(day_str: str, db: AsyncSession = Depends(get_db)):
    try:
        d = date_cls.fromisoformat(day_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date, expected YYYY-MM-DD")

    # NB: AsyncSession non e' concurrency-safe; tutte le query DB sono
    # serializzate. Anche le chiamate HTTP (diario) le facciamo in
    # sequenza per evitare interazioni col session lifecycle.
    activity = await _fetch_activity(db, d)
    body = await _fetch_body(db, d)
    vitals = await _fetch_vitals(db, d)
    nutrition = await _fetch_nutrition(db, d)
    sleep = await _fetch_sleep(db, d)
    workouts = await _fetch_workouts(db, d)
    lab_panels = await _fetch_lab_panels(db, d)
    regimens = await _fetch_regimens_active(db, d)
    diet_plan = await _fetch_diet_plan(d)
    health_notes = await _fetch_health_notes(db, d)
    journal_entries = await _fetch_journal(db, d)

    regimens_active: list[dict] = [
        {
            "id": r.id,
            "kind": r.kind,
            "name": r.name,
            "start_date": r.start_date.isoformat() if r.start_date else None,
            "end_date": r.end_date.isoformat() if r.end_date else None,
            "dose": r.dose,
            "notes": r.notes,
            "source": r.source,
        }
        for r in regimens
    ]

    # Inietta il piano alimentare dal diario come regimen sintetico
    # (id=-1, source='diario'). L'UI lo mostra sotto "Piano alimentare"
    # senza permetterne l'edit (l'editing avviene nel diario-alimentare).
    if diet_plan is not None:
        kcal = diet_plan.get("kcal_target")
        dose_parts: list[str] = []
        if kcal is not None:
            dose_parts.append(f"{round(kcal)} kcal/die")
        if diet_plan.get("protein_g") is not None:
            dose_parts.append(f"P {round(diet_plan['protein_g'])}g")
        if diet_plan.get("fat_g") is not None:
            dose_parts.append(f"F {round(diet_plan['fat_g'])}g")
        if diet_plan.get("carbs_g") is not None:
            dose_parts.append(f"C {round(diet_plan['carbs_g'])}g")
        notes = None
        if diet_plan.get("name_is_historic_guess"):
            notes = "Nome del piano corrente (il diario non espone i piani storici)."
        regimens_active.append({
            "id": -1,
            "kind": "diet",
            "name": diet_plan["name"],
            "start_date": None,
            "end_date": None,
            "dose": " · ".join(dose_parts) or None,
            "notes": notes,
            "source": "diario",
        })

    health_notes_out: list[dict] = [
        {
            "id": n.id,
            "category": n.category,
            "body_zone": n.body_zone,
            "text": n.text,
            "start_date": n.start_date.isoformat(),
            "end_date": n.end_date.isoformat(),
            "created_at": n.created_at.isoformat() if n.created_at else None,
            "updated_at": n.updated_at.isoformat() if n.updated_at else None,
        }
        for n in health_notes
    ]

    return {
        "date": d.isoformat(),
        "activity": activity,
        "body": body,
        "vitals": vitals,
        "nutrition": nutrition,
        "sleep": sleep,
        "workouts": workouts,
        "lab_panels": lab_panels,
        "regimens_active": regimens_active,
        "health_notes": health_notes_out,
        "journal": [
            {
                "id": j.id,
                "date": j.date.isoformat(),
                "content_html": j.content_html,
                "content_text": j.content_text,
                "tags": j.tags or [],
                "created_at": j.created_at.isoformat() if j.created_at else None,
                "updated_at": j.updated_at.isoformat() if j.updated_at else None,
            }
            for j in journal_entries
        ],
    }
