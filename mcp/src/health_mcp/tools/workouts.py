"""Tool dedicati al dettaglio workouts — accesso ai segmenti/intervalli.

I workout strutturati (Intervals Pro, Apple Workout custom, Strava interval, ecc.)
scrivono la loro struttura interna in `workouts.activities` come JSONB array.
Ogni elemento ha (kind, n, start, end, duration_s, distance_m, avg_hr, max_hr, kcal, pace_s_per_km).

I tool analitici di base operano a livello di workout intero; questi tool
espongono il livello sotto.
"""
from __future__ import annotations

import json
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Any

import asyncpg

from ..db import get_pool

# Soglie euristiche pace_s_per_km per classificare i segmenti.
# Sotto 480 s/km (8 min/km) -> corsa, sopra 600 s/km (10 min/km) -> camminata, in mezzo -> transizione.
_RUN_MAX_PACE_S_KM = 480
_WALK_MIN_PACE_S_KM = 600


def _serialize(rows: list[asyncpg.Record]) -> list[dict[str, Any]]:
    def _default(o: Any) -> Any:
        if isinstance(o, (datetime, date_type)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return float(o)
        raise TypeError(f"non serializable: {type(o).__name__}")

    return json.loads(json.dumps([dict(r) for r in rows], default=_default))


def _classify_segment(pace_s_km: float | None) -> str:
    if pace_s_km is None or pace_s_km <= 0:
        return "unknown"
    if pace_s_km <= _RUN_MAX_PACE_S_KM:
        return "run"
    if pace_s_km >= _WALK_MIN_PACE_S_KM:
        return "walk"
    return "mixed"


async def get_workout_intervals(uuid: str) -> dict[str, Any]:
    """Ritorna i segmenti/intervalli interni di un workout.

    Args:
        uuid: HKWorkoutActivity UUID (chiave primaria di workouts).

    Returns: {
      workout: {uuid, activity_type, effective_type, start, end, duration_s,
                distance_km, kcal, source_name, title, notes},
      intervals: [{n, kind, segment_type, start, end, duration_s, distance_m,
                   pace_s_per_km, avg_hr, max_hr, kcal}],
      summary: {n_intervals, n_run, n_walk, n_mixed,
                run_share_pct, walk_share_pct,
                run_avg_pace_s_km, walk_avg_pace_s_km,
                run_distance_km, walk_distance_km}
    }
    Restituisce {error} se il workout non esiste o non ha activities.
    """
    pool = await get_pool()
    async with pool.acquire() as con:
        row = await con.fetchrow(
            """
            SELECT
              uuid,
              activity_type,
              start_date,
              end_date,
              duration,
              total_distance,
              total_energy_burned,
              source_name,
              title,
              notes,
              metadata,
              activities
            FROM workouts
            WHERE uuid = $1
            """,
            uuid,
        )
    if row is None:
        return {"error": f"workout uuid={uuid!r} non trovato"}

    md = row["metadata"] or {}
    if isinstance(md, str):
        try:
            md = json.loads(md)
        except json.JSONDecodeError:
            md = {}
    # Derivazione effective_type semplificata (allineata a CLAUDE.md)
    at = row["activity_type"]
    indoor = str(md.get("HKIndoorWorkout", "")).lower() in ("1", "true")
    swim_loc = md.get("HKSwimmingLocationType")
    if at == 37 and indoor:
        eff = "treadmill_run"
    elif at == 52 and indoor:
        eff = "treadmill_walk"
    elif at == 13 and indoor:
        eff = "cyclette"
    elif at == 46 and str(swim_loc) == "1":
        eff = "swim_pool"
    elif at == 46 and str(swim_loc) == "2":
        eff = "swim_open_water"
    else:
        eff = f"type_{at}"

    workout_summary = {
        "uuid": str(row["uuid"]),
        "activity_type": at,
        "effective_type": eff,
        "start": row["start_date"].isoformat() if row["start_date"] else None,
        "end": row["end_date"].isoformat() if row["end_date"] else None,
        "duration_s": float(row["duration"]) if row["duration"] is not None else None,
        "distance_km": (
            float(row["total_distance"]) / 1000.0
            if row["total_distance"] is not None
            else None
        ),
        "kcal": (
            float(row["total_energy_burned"])
            if row["total_energy_burned"] is not None
            else None
        ),
        "source_name": row["source_name"],
        "title": row["title"],
        "notes": row["notes"],
    }

    raw_activities = row["activities"] or []
    if isinstance(raw_activities, str):
        try:
            raw_activities = json.loads(raw_activities)
        except json.JSONDecodeError:
            raw_activities = []
    if not isinstance(raw_activities, list) or not raw_activities:
        return {
            "workout": workout_summary,
            "intervals": [],
            "summary": {"n_intervals": 0},
            "note": "Questo workout non ha dati di intervalli strutturati in `activities`. "
            "Potrebbe essere un workout continuo (non strutturato) o da una sorgente "
            "che non scrive HKWorkoutActivity/HKWorkoutEvent.",
        }

    intervals: list[dict[str, Any]] = []
    for i, a in enumerate(raw_activities):
        if not isinstance(a, dict):
            continue
        pace = a.get("pace_s_per_km")
        try:
            pace_val = float(pace) if pace is not None else None
        except (TypeError, ValueError):
            pace_val = None
        intervals.append({
            "n": a.get("n", i + 1),
            "kind": a.get("kind"),
            "segment_type": _classify_segment(pace_val),
            "start": a.get("start"),
            "end": a.get("end"),
            "duration_s": a.get("duration_s"),
            "distance_m": a.get("distance_m"),
            "pace_s_per_km": pace_val,
            "avg_hr": a.get("avg_hr"),
            "max_hr": a.get("max_hr"),
            "kcal": a.get("kcal"),
        })

    # Summary
    total_dur = sum((i["duration_s"] or 0) for i in intervals)
    by_type: dict[str, list[dict[str, Any]]] = {"run": [], "walk": [], "mixed": [], "unknown": []}
    for iv in intervals:
        by_type[iv["segment_type"]].append(iv)

    def _avg_pace(ivs: list[dict[str, Any]]) -> float | None:
        weighted = [(iv["pace_s_per_km"], iv["duration_s"]) for iv in ivs
                    if iv["pace_s_per_km"] and iv["duration_s"]]
        if not weighted:
            return None
        return round(sum(p * d for p, d in weighted) / sum(d for _, d in weighted), 1)

    def _share_pct(ivs: list[dict[str, Any]]) -> float | None:
        if total_dur <= 0:
            return None
        return round(100 * sum((iv["duration_s"] or 0) for iv in ivs) / total_dur, 1)

    def _km(ivs: list[dict[str, Any]]) -> float | None:
        m = sum((iv["distance_m"] or 0) for iv in ivs)
        return round(m / 1000.0, 3) if m else None

    summary = {
        "n_intervals": len(intervals),
        "n_run": len(by_type["run"]),
        "n_walk": len(by_type["walk"]),
        "n_mixed": len(by_type["mixed"]),
        "n_unknown": len(by_type["unknown"]),
        "total_duration_s": total_dur or None,
        "run_share_pct": _share_pct(by_type["run"]),
        "walk_share_pct": _share_pct(by_type["walk"]),
        "run_avg_pace_s_km": _avg_pace(by_type["run"]),
        "walk_avg_pace_s_km": _avg_pace(by_type["walk"]),
        "run_distance_km": _km(by_type["run"]),
        "walk_distance_km": _km(by_type["walk"]),
        "classification_thresholds": {
            "run_max_pace_s_km": _RUN_MAX_PACE_S_KM,
            "walk_min_pace_s_km": _WALK_MIN_PACE_S_KM,
            "note": "soglie euristiche basate sul pace medio del segmento",
        },
    }

    return {
        "workout": workout_summary,
        "intervals": intervals,
        "summary": summary,
    }


async def list_recent_workouts(
    activity_type: int | None = None,
    source_contains: str | None = None,
    only_with_intervals: bool = False,
    days_back: int | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Elenca workout recenti con sommario e flag `has_intervals`.

    Utile per "quali workout di corsa ho fatto col tool X negli ultimi 30 giorni
    e quali avevano intervalli strutturati?". Restituisce gli UUID per drilldown
    via `get_workout_intervals`.

    Args:
        activity_type: HKWorkoutActivityType int (37=running, 13=cycling, ecc.).
        source_contains: filtra source_name con ILIKE %x% (es. 'Intervals' per Intervals Pro).
        only_with_intervals: se True ritorna solo workout con activities non vuote.
        days_back: limita agli ultimi N giorni.
        limit: max righe (max 500).

    Returns: {n_workouts, rows: [{uuid, start, activity_type, effective_type,
              distance_km, duration_s, pace_s_per_km, kcal, source_name,
              title, has_intervals, n_intervals}]}.
    """
    limit = max(1, min(int(limit), 500))
    where = []
    params: list[Any] = []

    if activity_type is not None:
        params.append(int(activity_type))
        where.append(f"activity_type = ${len(params)}")
    if source_contains:
        params.append(f"%{source_contains}%")
        where.append(f"source_name ILIKE ${len(params)}")
    if days_back is not None and days_back > 0:
        params.append(int(days_back))
        where.append(f"start_date >= NOW() - make_interval(days => ${len(params)})")
    if only_with_intervals:
        where.append("jsonb_typeof(activities) = 'array' AND jsonb_array_length(activities) > 1")
    where_clause = f"WHERE {' AND '.join(where)}" if where else ""

    sql = f"""
SELECT
  uuid,
  activity_type,
  start_date,
  duration,
  total_distance,
  total_energy_burned,
  source_name,
  title,
  CASE
    WHEN metadata->>'HKIndoorWorkout' IN ('1','true','True') AND activity_type = 37 THEN 'treadmill_run'
    WHEN metadata->>'HKIndoorWorkout' IN ('1','true','True') AND activity_type = 52 THEN 'treadmill_walk'
    WHEN metadata->>'HKIndoorWorkout' IN ('1','true','True') AND activity_type = 13 THEN 'cyclette'
    WHEN activity_type = 46 AND metadata->>'HKSwimmingLocationType' = '1' THEN 'swim_pool'
    WHEN activity_type = 46 AND metadata->>'HKSwimmingLocationType' = '2' THEN 'swim_open_water'
    ELSE 'type_' || activity_type::text
  END AS effective_type,
  (jsonb_typeof(activities) = 'array' AND jsonb_array_length(activities) > 1) AS has_intervals,
  COALESCE(jsonb_array_length(activities), 0) AS n_intervals
FROM workouts
{where_clause}
ORDER BY start_date DESC
LIMIT {limit}
"""

    pool = await get_pool()
    async with pool.acquire() as con:
        try:
            rows = await con.fetch(sql, *params)
        except asyncpg.PostgresError as e:
            return {"error": f"{type(e).__name__}: {e}", "sql": sql}

    out = []
    for r in rows:
        d = r["total_distance"]
        dur = r["duration"]
        pace = None
        if d and dur and d > 100:
            pace = round(float(dur) / (float(d) / 1000.0), 1)
        out.append({
            "uuid": str(r["uuid"]),
            "start": r["start_date"].isoformat() if r["start_date"] else None,
            "activity_type": r["activity_type"],
            "effective_type": r["effective_type"],
            "distance_km": round(float(d) / 1000.0, 3) if d else None,
            "duration_s": float(dur) if dur is not None else None,
            "pace_s_per_km": pace,
            "kcal": float(r["total_energy_burned"]) if r["total_energy_burned"] is not None else None,
            "source_name": r["source_name"],
            "title": r["title"],
            "has_intervals": r["has_intervals"],
            "n_intervals": r["n_intervals"],
        })

    return {"n_workouts": len(out), "rows": out}
