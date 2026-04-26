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

from app.database import get_db
from app.models import (
    CategorySample,
    DailyStat,
    HealthSample,
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


def _local_day_bounds(d: date_cls) -> tuple[datetime, datetime]:
    """[SOD, EOD) for the day. Naive datetimes — Postgres stores TIMESTAMPTZ
    so it'll cast against UTC; the client picked the date in local TZ
    already (URL is YYYY-MM-DD)."""
    sod = datetime.combine(d, time.min)
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
    asleep = _min("asleep_unspecified") + _min("core") + _min("deep") + _min("rem")
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


async def _fetch_regimens_active(db: AsyncSession, d: date_cls) -> list[Regimen]:
    rows = (
        await db.execute(
            select(Regimen)
            .where(or_(Regimen.start_date.is_(None), Regimen.start_date <= d))
            .where(or_(Regimen.end_date.is_(None), Regimen.end_date >= d))
            .order_by(Regimen.kind.asc(), Regimen.name.asc())
        )
    ).scalars().all()
    return list(rows)


@router.get("/{day_str}")
async def get_day(day_str: str, db: AsyncSession = Depends(get_db)):
    try:
        d = date_cls.fromisoformat(day_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date, expected YYYY-MM-DD")

    activity, body, vitals, nutrition, sleep, workouts, lab_panels, regimens = await asyncio.gather(
        _fetch_activity(db, d),
        _fetch_body(db, d),
        _fetch_vitals(db, d),
        _fetch_nutrition(db, d),
        _fetch_sleep(db, d),
        _fetch_workouts(db, d),
        _fetch_lab_panels(db, d),
        _fetch_regimens_active(db, d),
    )

    return {
        "date": d.isoformat(),
        "activity": activity,
        "body": body,
        "vitals": vitals,
        "nutrition": nutrition,
        "sleep": sleep,
        "workouts": workouts,
        "lab_panels": lab_panels,
        "regimens_active": [
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
        ],
    }
