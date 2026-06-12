"""Enrich existing Endomondo workouts with GPS route / altitude / per-second
speed + heart-rate / calories from the original Endomondo GDPR export.

The historical Endomondo import only carried per-workout TOTALS (distance +
duration). It threw away the full track that the export actually contains. So
for those runs the dashboard has no map, no HR/speed chart, and reconstructs the
per-km splits from the iPhone pedometer (5-minute buckets, misaligned) — garbage.

But every `Workouts/<start>.json` in the export holds the real track: hundreds
of points with location, altitude, distance_km, speed_kmh and (often)
heart_rate_bpm. This script reads those JSON files, matches each to the existing
workout by start time, and backfills:

  - the GPS route        -> POST /api/v1/workouts/by-uuid/{uuid}/route   (idempotent UPSERT)
  - calories             -> PATCH /api/v1/workouts/by-uuid/{uuid}        (only if currently NULL/0)
  - per-second HR        -> POST /api/v1/samples/batch (HKQuantityTypeIdentifierHeartRate)
  - per-second speed     -> POST /api/v1/samples/batch (HKQuantityTypeIdentifierRunningSpeed,
                            m/s, GPS spikes > 10 m/s dropped) so the workout-detail
                            speed/pace chart + per-km splits render correctly
    (samples: source_name='Endomondo', deterministic uuid5 -> ON CONFLICT DO NOTHING)
  - notes                -> PATCH (only if the workout has none)

It ONLY touches workouts whose source_name is exactly 'Endomondo'. The
'Endomondo (Garmin)' runs (already enriched from the Garmin FIT, with better
data) are left untouched. The stored distance/duration are NEVER modified.

Treadmill / indoor runs with no GPS still get their HR + speed series (no route).

Matching is by START TIME within --time-tol seconds; distance only rejects
fragments. Dry-run by default; pass --commit to write.

Usage:
    python3 scripts/import_endomondo_routes.py \
        --zip /path/to/endomondo-export.zip \
        --api http://192.168.68.166:8000 \
        [--time-tol 180] [--commit]

    # or, if already extracted:
    python3 scripts/import_endomondo_routes.py --workouts-dir /path/to/Workouts --api ... [--commit]

Requires: requests.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import uuid
import zipfile
from datetime import datetime, timezone

import requests

SOURCE_NAME = "Endomondo"
SOURCE_BUNDLE_ID = "com.endomondo.android"
TARGET_SOURCE = "Endomondo"  # only enrich workouts with this exact source_name
UUID_PREFIX = "endomondo-json"
HR_TYPE = "HKQuantityTypeIdentifierHeartRate"
SPEED_TYPE = "HKQuantityTypeIdentifierRunningSpeed"
# Drop per-second speed readings above this (m/s) as GPS spikes — 10 m/s = 36 km/h.
MAX_RUNNING_SPEED_MS = 10.0
# Endomondo timestamps look like: "Mon Apr 20 04:35:40 UTC 2015"
TS_FMT = "%a %b %d %H:%M:%S UTC %Y"


# --------------------------------------------------------------------------- #
# JSON parsing
# --------------------------------------------------------------------------- #
def _kv(seq, key):
    """Endomondo stores objects as a list of single-key dicts. Pull one key."""
    if not isinstance(seq, list):
        return None
    for item in seq:
        if isinstance(item, dict) and key in item:
            return item[key]
    return None


def _parse_ts(s):
    """Parse a point timestamp ('Mon Apr 20 04:35:40 UTC 2015')."""
    try:
        return datetime.strptime(s, TS_FMT).replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _parse_start(s):
    """Parse the top-level start_time ('2015-04-20 04:35:40.0', UTC)."""
    if not isinstance(s, str):
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def parse_json(raw: bytes, name: str) -> dict | None:
    """Parse one Endomondo workout JSON into a normalized dict, or None."""
    try:
        data = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! skip {name}: json error: {exc}", file=sys.stderr)
        return None

    start = _parse_start(_kv(data, "start_time"))
    if start is None:
        return None

    distance_km = _kv(data, "distance_km")
    calories = _kv(data, "calories_kcal")
    sport = _kv(data, "sport")
    notes = _kv(data, "notes")
    raw_points = _kv(data, "points") or []

    points: list[dict] = []   # GPS track (lat/lon present)
    hr: list[dict] = []       # per-second HR
    speed: list[dict] = []    # per-second speed (m/s)

    for entry in raw_points:
        ts = _parse_ts(_kv(entry, "timestamp"))
        if ts is None:
            continue
        loc = _kv(entry, "location")
        lat = lon = None
        if loc is not None:
            # location: [[ {latitude:..}, {longitude:..} ]]
            inner = loc[0] if isinstance(loc, list) and loc else loc
            lat = _kv(inner, "latitude")
            lon = _kv(inner, "longitude")
        if lat is not None and lon is not None:
            pt: dict = {"lat": round(float(lat), 7), "lon": round(float(lon), 7), "ts": _iso(ts)}
            alt = _kv(entry, "altitude")
            if alt is not None:
                pt["alt"] = round(float(alt), 2)
            spd_kmh = _kv(entry, "speed_kmh")
            if spd_kmh is not None:
                pt["speed"] = round(float(spd_kmh) / 3.6, 3)
            points.append(pt)

        bpm = _kv(entry, "heart_rate_bpm")
        if bpm is not None:
            try:
                b = int(round(float(bpm)))
                if b > 0:
                    hr.append({"ts": _iso(ts), "bpm": b})
            except (TypeError, ValueError):
                pass

        spd_kmh = _kv(entry, "speed_kmh")
        if spd_kmh is not None:
            mps = float(spd_kmh) / 3.6
            if 0 <= mps <= MAX_RUNNING_SPEED_MS:
                speed.append({"ts": _iso(ts), "mps": round(mps, 3)})

    return {
        "name": name,
        "start": start,
        "distance_m": (float(distance_km) * 1000.0) if distance_km is not None else None,
        "calories": _i(calories),
        "sport": sport,
        "notes": notes if isinstance(notes, str) and notes.strip() else None,
        "points": points,
        "hr": hr,
        "speed": speed,
    }


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _i(v) -> int | None:
    try:
        return int(round(float(v))) if v is not None else None
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# Source iteration
# --------------------------------------------------------------------------- #
def iter_json_from_zip(zip_path: str):
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            n = info.filename
            if "/Workouts/" in n and n.lower().endswith(".json") and "__MACOSX" not in n:
                yield n, z.read(n)


def iter_json_from_dir(d: str):
    import glob
    import os

    for path in glob.glob(os.path.join(d, "**", "*.json"), recursive=True):
        with open(path, "rb") as f:
            yield os.path.basename(path), f.read()


# --------------------------------------------------------------------------- #
# Backend access
# --------------------------------------------------------------------------- #
def fetch_workouts(api: str) -> list[dict]:
    r = requests.get(
        f"{api}/api/v1/workouts",
        params={"start": "2010-01-01T00:00:00", "end": "2016-12-31T23:59:59", "limit": 10000},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def existing_routes(api: str, uuids: list[str]) -> set[str]:
    have: set[str] = set()
    for u in uuids:
        try:
            r = requests.get(f"{api}/api/v1/workouts/by-uuid/{u}/route", timeout=30)
        except requests.RequestException:
            continue
        if r.status_code == 200 and (r.json().get("point_count") or 0) > 0:
            have.add(u)
    return have


# --------------------------------------------------------------------------- #
# Matching
# --------------------------------------------------------------------------- #
def match(parsed: list[dict], workouts: list[dict], time_tol: float):
    wk = []
    for w in workouts:
        st = datetime.fromisoformat(w["start_date"].replace("Z", "+00:00")).astimezone(timezone.utc)
        wk.append((st, w))
    used: set[str] = set()
    matches: list[tuple[dict, dict]] = []
    unmatched: list[dict] = []

    for p in sorted(parsed, key=lambda x: x["start"]):
        best = None
        best_dt = time_tol + 1
        for wst, w in wk:
            if str(w["uuid"]) in used:
                continue
            dt = abs((wst - p["start"]).total_seconds())
            if dt <= time_tol and dt < best_dt:
                best_dt, best = dt, w
        if best is None:
            unmatched.append(p)
            continue
        wdist = best.get("total_distance") or 0
        fdist = p.get("distance_m") or 0
        if wdist > 500 and fdist > 0 and fdist < 0.4 * wdist:
            unmatched.append(p)
            continue
        used.add(str(best["uuid"]))
        matches.append((p, best))
    return matches, unmatched


def _build_samples(series, val_key, kind, hk_type, unit, workout_uuid):
    out = []
    for s in series:
        ts = s["ts"]
        sid = uuid.uuid5(uuid.NAMESPACE_URL, f"{UUID_PREFIX}:{kind}:{workout_uuid}:{ts}")
        out.append({
            "uuid": str(sid),
            "type": hk_type,
            "value": float(s[val_key]),
            "unit": unit,
            "start_date": ts,
            "end_date": ts,
            "source_name": SOURCE_NAME,
            "source_bundle_id": SOURCE_BUNDLE_ID,
            "metadata": {"import": "endomondo_json_v1", "workout_uuid": workout_uuid},
        })
    return out


# --------------------------------------------------------------------------- #
# Writers
# --------------------------------------------------------------------------- #
def post_route(api, wuuid, points):
    r = requests.post(f"{api}/api/v1/workouts/by-uuid/{wuuid}/route", json={"points": points}, timeout=120)
    r.raise_for_status()
    return r.json()


def patch_workout(api, wuuid, body):
    r = requests.patch(f"{api}/api/v1/workouts/by-uuid/{wuuid}", json=body, timeout=30)
    r.raise_for_status()
    return r.json()


def post_samples(api, samples, chunk=1000):
    inserted = dups = 0
    for i in range(0, len(samples), chunk):
        batch = samples[i : i + chunk]
        r = requests.post(
            f"{api}/api/v1/samples/batch",
            json={"device_id": "endomondo-json-import", "samples": batch},
            timeout=120,
        )
        r.raise_for_status()
        res = r.json()
        inserted += res.get("inserted", 0)
        dups += res.get("duplicates_skipped", 0)
    return {"inserted": inserted, "duplicates": dups}


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--zip", help="Path to the Endomondo export zip")
    src.add_argument("--workouts-dir", help="Directory with extracted Workouts/*.json")
    ap.add_argument("--api", required=True)
    ap.add_argument("--time-tol", type=float, default=180.0,
                    help="Max start-time offset (seconds) for JSON<->workout match (default 180)")
    ap.add_argument("--commit", action="store_true",
                    help="Actually write. Without this flag the script is a dry-run.")
    args = ap.parse_args()

    src_iter = iter_json_from_zip(args.zip) if args.zip else iter_json_from_dir(args.workouts_dir)

    print("Parsing Endomondo JSON files...")
    parsed: list[dict] = []
    seen = 0
    for name, raw in src_iter:
        seen += 1
        p = parse_json(raw, name)
        if p:
            parsed.append(p)
    print(f"  JSON files seen:   {seen}")
    print(f"  parsed OK:         {len(parsed)}")
    print(f"  with GPS track:    {sum(1 for p in parsed if p['points'])}")
    print(f"  with HR series:    {sum(1 for p in parsed if p['hr'])}")

    print(f"\nFetching workouts from {args.api}...")
    all_workouts = fetch_workouts(args.api)
    workouts = [w for w in all_workouts if (w.get("source_name") or "") == TARGET_SOURCE]
    print(f"  total workouts fetched:        {len(all_workouts)}")
    print(f"  target 'Endomondo' workouts:   {len(workouts)}")

    matches, unmatched = match(parsed, workouts, args.time_tol)
    print(f"\nMatched JSON<->workout:   {len(matches)}")
    print(f"Unmatched JSON (no target workout / fragment): {len(unmatched)}")

    wmap = {str(w["uuid"]): w for w in workouts}
    route_targets = [(p, w) for p, w in matches if p["points"]]
    cal_targets = [(p, w) for p, w in matches
                   if p["calories"] and not wmap[str(w["uuid"])].get("total_energy_burned")]
    notes_targets = [(p, w) for p, w in matches
                     if p["notes"] and not (wmap[str(w["uuid"])].get("notes") or "").strip()]
    hr_targets = [(p, w) for p, w in matches if p["hr"]]
    speed_targets = [(p, w) for p, w in matches if p["speed"]]
    total_hr = sum(len(p["hr"]) for p, _ in hr_targets)
    total_sp = sum(len(p["speed"]) for p, _ in speed_targets)

    print(f"\nRoutes to write:          {len(route_targets)} (GPS)  | indoor/no-GPS matched: {len(matches) - len(route_targets)}")
    print(f"Calories to backfill:     {len(cal_targets)}")
    print(f"Notes to backfill:        {len(notes_targets)}")
    print(f"Workouts w/ HR series:    {len(hr_targets)}  ({total_hr} HR samples)")
    print(f"Workouts w/ speed series: {len(speed_targets)}  ({total_sp} RunningSpeed samples)")

    if not args.commit:
        print("\n(dry-run) Re-run with --commit to actually write.")
        return 0

    print("\nWriting routes...")
    ok = 0
    for p, w in route_targets:
        try:
            post_route(args.api, str(w["uuid"]), p["points"])
            ok += 1
        except requests.RequestException as e:
            print(f"  ! route failed for {w['uuid']}: {e}", file=sys.stderr)
    print(f"  routes written: {ok}/{len(route_targets)}")

    print("Backfilling calories...")
    ok = 0
    for p, w in cal_targets:
        try:
            patch_workout(args.api, str(w["uuid"]), {"total_energy_burned": float(p["calories"])})
            ok += 1
        except requests.RequestException as e:
            print(f"  ! calories failed for {w['uuid']}: {e}", file=sys.stderr)
    print(f"  calories backfilled: {ok}/{len(cal_targets)}")

    print("Backfilling notes...")
    ok = 0
    for p, w in notes_targets:
        try:
            patch_workout(args.api, str(w["uuid"]), {"notes": p["notes"]})
            ok += 1
        except requests.RequestException as e:
            print(f"  ! notes failed for {w['uuid']}: {e}", file=sys.stderr)
    print(f"  notes backfilled: {ok}/{len(notes_targets)}")

    if hr_targets:
        print("Writing HR samples...")
        all_hr = []
        for p, w in hr_targets:
            all_hr.extend(_build_samples(p["hr"], "bpm", "hr", HR_TYPE, "count/min", str(w["uuid"])))
        res = post_samples(args.api, all_hr)
        print(f"  HR samples: {res['inserted']} inserted, {res['duplicates']} duplicates")

    if speed_targets:
        print("Writing RunningSpeed samples...")
        all_sp = []
        for p, w in speed_targets:
            all_sp.extend(_build_samples(p["speed"], "mps", "speed", SPEED_TYPE, "m/s", str(w["uuid"])))
        res = post_samples(args.api, all_sp)
        print(f"  speed samples: {res['inserted']} inserted, {res['duplicates']} duplicates")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
