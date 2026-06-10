"""Enrich existing workouts with GPS routes / calories / heart-rate from a
Garmin Connect export (GDPR zip).

Garmin recorded many runs that were ALSO logged by Endomondo (already in the DB
with distance + duration, but no GPS route, no calories, no HR). This script
reads the original `.fit` files from the Garmin export, matches each one to the
existing workout by start time, and backfills:

  - the GPS route       -> POST /api/v1/workouts/by-uuid/{uuid}/route   (idempotent UPSERT)
  - calories            -> PATCH /api/v1/workouts/by-uuid/{uuid}        (only if currently NULL/0)
  - per-second HR        -> POST /api/v1/samples/batch (HKQuantityTypeIdentifierHeartRate)
  - per-second speed     -> POST /api/v1/samples/batch (HKQuantityTypeIdentifierRunningSpeed,
                            m/s, GPS spikes > 10 m/s dropped) so the workout-detail
                            speed chart renders for these old runs too
    (samples: source_name='Garmin', deterministic uuid5 -> ON CONFLICT DO NOTHING)
  - source_name          -> PATCH to 'Endomondo (Garmin)' to mark the enriched workout

Matching is by START TIME (median offset observed: ~2s); distance is only used
to reject false-start FIT fragments (a short file recorded right before the real
one). The workout's stored distance/duration are NEVER modified.

Dry-run by default. Re-run with --commit to actually write.

Usage:
    python3 scripts/import_garmin_routes.py \
        --zip /path/to/garmin_export.zip \
        --api http://192.168.68.166:8000 \
        [--start-year 2013] [--end-year 2014] \
        [--time-tol 300] [--commit]

    # or, if the .fit files are already extracted into a directory:
    python3 scripts/import_garmin_routes.py --fit-dir /path/to/fits --api ... [--commit]

Requires: fitdecode, requests.
"""
from __future__ import annotations

import argparse
import io
import sys
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone

import fitdecode
import requests

SOURCE_NAME = "Garmin"
SOURCE_BUNDLE_ID = "com.garmin.connect"
# source_name stamped on enriched workouts so they stay filterable/re-selectable.
ENRICHED_SOURCE = "Endomondo (Garmin)"
UUID_PREFIX = "garmin-fit"
HR_TYPE = "HKQuantityTypeIdentifierHeartRate"
SPEED_TYPE = "HKQuantityTypeIdentifierRunningSpeed"
# Drop per-second speed readings above this (m/s) as GPS spikes — 10 m/s = 36 km/h,
# well beyond any sustained human running speed, so anything higher is noise.
MAX_RUNNING_SPEED_MS = 10.0
SEMICIRCLE_TO_DEG = 180.0 / 2**31

# Inner zip inside the Garmin export holding the raw .fit uploads.
UPLOADED_FILES_PREFIX = "DI_CONNECT/DI-Connect-Uploaded-Files/"


# --------------------------------------------------------------------------- #
# FIT parsing
# --------------------------------------------------------------------------- #
def parse_fit(raw: bytes, name: str) -> dict | None:
    """Parse one FIT file into a normalized dict, or None if unreadable.

    Returns:
        {
          "name": str,
          "start": datetime (UTC),
          "distance_m": float | None,   # session total_distance
          "calories": int | None,       # session total_calories
          "sport": str | None,
          "points": [{lat, lon, ts, alt?, speed?}, ...],   # GPS track
          "hr": [{ts, bpm}, ...],                          # per-second HR (may be empty)
          "speed": [{ts, mps}, ...],                       # per-second running speed (m/s)
        }
    """
    session: dict = {}
    points: list[dict] = []
    hr: list[dict] = []
    speed: list[dict] = []
    first_ts: datetime | None = None

    try:
        with fitdecode.FitReader(io.BytesIO(raw)) as fr:
            for frame in fr:
                if not isinstance(frame, fitdecode.FitDataMessage):
                    continue
                if frame.name == "session" and not session:
                    session = {fl.name: fl.value for fl in frame.fields}
                elif frame.name == "record":
                    d = {fl.name: fl.value for fl in frame.fields}
                    ts = d.get("timestamp")
                    if ts is None:
                        continue
                    if first_ts is None:
                        first_ts = ts
                    lat = d.get("position_lat")
                    lon = d.get("position_long")
                    if lat is not None and lon is not None:
                        pt: dict = {
                            "lat": round(lat * SEMICIRCLE_TO_DEG, 7),
                            "lon": round(lon * SEMICIRCLE_TO_DEG, 7),
                            "ts": _iso(ts),
                        }
                        alt = d.get("enhanced_altitude")
                        if alt is None:
                            alt = d.get("altitude")
                        if alt is not None:
                            pt["alt"] = round(float(alt), 2)
                        spd = d.get("enhanced_speed")
                        if spd is None:
                            spd = d.get("speed")
                        if spd is not None:
                            pt["speed"] = round(float(spd), 3)
                        points.append(pt)
                    bpm = d.get("heart_rate")
                    if bpm is not None:
                        hr.append({"ts": ts, "bpm": int(bpm)})
                    mps = d.get("enhanced_speed")
                    if mps is None:
                        mps = d.get("speed")
                    if mps is not None and float(mps) <= MAX_RUNNING_SPEED_MS:
                        speed.append({"ts": ts, "mps": round(float(mps), 3)})
    except Exception as exc:  # noqa: BLE001 - corrupt/partial FIT, skip gracefully
        print(f"  ! skip {name}: parse error: {exc}", file=sys.stderr)
        return None

    start = session.get("start_time") or first_ts
    if start is None:
        return None
    start = _to_utc(start)

    return {
        "name": name,
        "start": start,
        "distance_m": _f(session.get("total_distance")),
        "calories": _i(session.get("total_calories")),
        "sport": session.get("sport"),
        "points": points,
        "hr": hr,
        "speed": speed,
    }


def _iso(dt: datetime) -> str:
    return _to_utc(dt).isoformat()


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _f(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _i(v) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# FIT source iteration
# --------------------------------------------------------------------------- #
def iter_fits_from_zip(zip_path: str):
    """Yield (name, raw_bytes) for every .fit inside the Garmin export zip,
    transparently descending into the inner UploadedFiles_*.zip archives."""
    with zipfile.ZipFile(zip_path) as outer:
        for info in outer.infolist():
            n = info.filename
            if n.lower().endswith(".fit"):
                yield n, outer.read(n)
            elif n.startswith(UPLOADED_FILES_PREFIX) and n.lower().endswith(".zip"):
                inner_bytes = outer.read(n)
                with zipfile.ZipFile(io.BytesIO(inner_bytes)) as inner:
                    for fn in inner.namelist():
                        if fn.lower().endswith(".fit"):
                            yield fn, inner.read(fn)


def iter_fits_from_dir(fit_dir: str):
    import glob
    import os

    for path in glob.glob(os.path.join(fit_dir, "**", "*.fit"), recursive=True):
        with open(path, "rb") as f:
            yield os.path.basename(path), f.read()


# --------------------------------------------------------------------------- #
# Backend access
# --------------------------------------------------------------------------- #
def fetch_workouts(api: str, start_year: int, end_year: int) -> list[dict]:
    url = f"{api}/api/v1/workouts"
    params = {
        "start": f"{start_year}-01-01T00:00:00",
        "end": f"{end_year}-12-31T23:59:59",
        "limit": 10000,
    }
    r = requests.get(url, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def existing_routes(api: str, uuids: list[str]) -> set[str]:
    """UUIDs that already have a route ingested (point_count > 0)."""
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
def match_fits(fits: list[dict], workouts: list[dict], time_tol: float):
    """1:1 match FIT -> workout by nearest start time within `time_tol` seconds.
    Distance is used only to reject fragments: a candidate whose FIT distance is
    < 40% of the workout distance is rejected as a false-start.

    Returns (matches, unmatched_fits) where matches = [(fit, workout), ...].
    """
    wk = []
    for w in workouts:
        st = datetime.fromisoformat(w["start_date"].replace("Z", "+00:00"))
        wk.append((_to_utc(st), w))
    used: set[str] = set()
    matches: list[tuple[dict, dict]] = []
    unmatched: list[dict] = []

    for fit in sorted(fits, key=lambda x: x["start"]):
        best = None
        best_dt = time_tol + 1
        for wst, w in wk:
            if str(w["uuid"]) in used:
                continue
            dt = abs((wst - fit["start"]).total_seconds())
            if dt <= time_tol and dt < best_dt:
                best_dt, best = dt, w
        if best is None:
            unmatched.append(fit)
            continue
        # distance sanity: reject false-start fragments
        wdist = best.get("total_distance") or 0
        fdist = fit.get("distance_m") or 0
        if wdist > 500 and fdist > 0 and fdist < 0.4 * wdist:
            unmatched.append(fit)
            continue
        used.add(str(best["uuid"]))
        matches.append((fit, best))

    return matches, unmatched


def _build_samples(series: list[dict], val_key: str, kind: str, hk_type: str,
                   unit: str, workout_uuid: str) -> list[dict]:
    """Generic per-record quantity sample builder. `kind` namespaces the uuid5
    so HR and speed samples on the same timestamp don't collide."""
    samples = []
    for s in series:
        ts = _iso(s["ts"])
        sid = uuid.uuid5(uuid.NAMESPACE_URL, f"{UUID_PREFIX}:{kind}:{workout_uuid}:{ts}")
        samples.append({
            "uuid": str(sid),
            "type": hk_type,
            "value": float(s[val_key]),
            "unit": unit,
            "start_date": ts,
            "end_date": ts,
            "source_name": SOURCE_NAME,
            "source_bundle_id": SOURCE_BUNDLE_ID,
            "metadata": {"import": "garmin_fit_v1", "workout_uuid": workout_uuid},
        })
    return samples


def build_hr_samples(fit: dict, workout_uuid: str) -> list[dict]:
    return _build_samples(fit["hr"], "bpm", "hr", HR_TYPE, "count/min", workout_uuid)


def build_speed_samples(fit: dict, workout_uuid: str) -> list[dict]:
    return _build_samples(fit["speed"], "mps", "speed", SPEED_TYPE, "m/s", workout_uuid)


# --------------------------------------------------------------------------- #
# Writers
# --------------------------------------------------------------------------- #
def post_route(api: str, wuuid: str, points: list[dict]):
    r = requests.post(
        f"{api}/api/v1/workouts/by-uuid/{wuuid}/route",
        json={"points": points},
        timeout=120,
    )
    r.raise_for_status()
    return r.json()


def patch_calories(api: str, wuuid: str, calories: float):
    r = requests.patch(
        f"{api}/api/v1/workouts/by-uuid/{wuuid}",
        json={"total_energy_burned": calories},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def patch_source(api: str, wuuid: str, source_name: str):
    r = requests.patch(
        f"{api}/api/v1/workouts/by-uuid/{wuuid}",
        json={"source_name": source_name},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def post_samples(api: str, samples: list[dict], chunk: int = 1000) -> dict:
    inserted = dups = 0
    for i in range(0, len(samples), chunk):
        batch = samples[i : i + chunk]
        r = requests.post(
            f"{api}/api/v1/samples/batch",
            json={"device_id": "garmin-fit-import", "samples": batch},
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
    src.add_argument("--zip", help="Path to the Garmin Connect export zip")
    src.add_argument("--fit-dir", help="Directory with already-extracted .fit files")
    ap.add_argument("--api", required=True, help="Backend base URL (e.g. http://192.168.68.166:8000)")
    ap.add_argument("--start-year", type=int, default=2013)
    ap.add_argument("--end-year", type=int, default=2014)
    ap.add_argument("--time-tol", type=float, default=300.0,
                    help="Max start-time offset (seconds) for FIT<->workout match (default 300)")
    ap.add_argument("--commit", action="store_true",
                    help="Actually write. Without this flag the script is a dry-run.")
    args = ap.parse_args()

    src_iter = iter_fits_from_zip(args.zip) if args.zip else iter_fits_from_dir(args.fit_dir)

    print("Parsing FIT files...")
    fits: list[dict] = []
    total_seen = skipped_year = no_gps = 0
    for name, raw in src_iter:
        total_seen += 1
        parsed = parse_fit(raw, name)
        if not parsed:
            continue
        y = parsed["start"].year
        if not (args.start_year <= y <= args.end_year):
            skipped_year += 1
            continue
        if not parsed["points"]:
            no_gps += 1
            continue
        fits.append(parsed)

    print(f"  FIT files seen:        {total_seen}")
    print(f"  outside {args.start_year}-{args.end_year}:        {skipped_year}")
    print(f"  no GPS track (skipped): {no_gps}")
    print(f"  candidate FITs w/ GPS:  {len(fits)}")

    print(f"\nFetching workouts {args.start_year}-{args.end_year} from {args.api}...")
    workouts = fetch_workouts(args.api, args.start_year, args.end_year)
    print(f"  existing workouts in range: {len(workouts)}")

    matches, unmatched = match_fits(fits, workouts, args.time_tol)
    print(f"\nMatched FIT<->workout:    {len(matches)}")
    print(f"Unmatched FITs (no workout / fragment): {len(unmatched)}")
    for fit in unmatched:
        print(f"  - {fit['start']:%Y-%m-%d %H:%M}  {fit['name']}  "
              f"dist={fit['distance_m'] or 0:.0f}m pts={len(fit['points'])}")

    # plan calories / HR
    wmap = {str(w["uuid"]): w for w in workouts}
    cal_targets = [
        (fit, w) for fit, w in matches
        if fit["calories"] and not (wmap[str(w["uuid"])].get("total_energy_burned"))
    ]
    hr_targets = [(fit, w) for fit, w in matches if fit["hr"]]
    total_hr_pts = sum(len(fit["hr"]) for fit, _ in hr_targets)
    speed_targets = [(fit, w) for fit, w in matches if fit["speed"]]
    total_speed_pts = sum(len(fit["speed"]) for fit, _ in speed_targets)
    src_targets = [
        (fit, w) for fit, w in matches
        if (w.get("source_name") or "") != ENRICHED_SOURCE
    ]

    print(f"\nRoutes to write:          {len(matches)}")
    print(f"Calories to backfill:     {len(cal_targets)} (where workout has none)")
    print(f"Workouts with HR series:  {len(hr_targets)}  ({total_hr_pts} HR samples)")
    print(f"Workouts with speed series: {len(speed_targets)}  ({total_speed_pts} RunningSpeed samples)")
    print(f"Source -> '{ENRICHED_SOURCE}': {len(src_targets)} (already stamped: {len(matches) - len(src_targets)})")

    if not args.commit:
        print("\n(dry-run) Re-run with --commit to actually write.")
        return 0

    print("\nWriting routes...")
    route_ok = 0
    for fit, w in matches:
        try:
            post_route(args.api, str(w["uuid"]), fit["points"])
            route_ok += 1
        except requests.RequestException as e:
            print(f"  ! route failed for {w['uuid']}: {e}", file=sys.stderr)
    print(f"  routes written: {route_ok}/{len(matches)}")

    print("Backfilling calories...")
    cal_ok = 0
    for fit, w in cal_targets:
        try:
            patch_calories(args.api, str(w["uuid"]), float(fit["calories"]))
            cal_ok += 1
        except requests.RequestException as e:
            print(f"  ! calories failed for {w['uuid']}: {e}", file=sys.stderr)
    print(f"  calories backfilled: {cal_ok}/{len(cal_targets)}")

    if hr_targets:
        print("Writing HR samples...")
        all_hr: list[dict] = []
        for fit, w in hr_targets:
            all_hr.extend(build_hr_samples(fit, str(w["uuid"])))
        res = post_samples(args.api, all_hr)
        print(f"  HR samples: {res['inserted']} inserted, {res['duplicates']} duplicates")

    if speed_targets:
        print("Writing RunningSpeed samples...")
        all_sp: list[dict] = []
        for fit, w in speed_targets:
            all_sp.extend(build_speed_samples(fit, str(w["uuid"])))
        res = post_samples(args.api, all_sp)
        print(f"  speed samples: {res['inserted']} inserted, {res['duplicates']} duplicates")

    print(f"Stamping source_name '{ENRICHED_SOURCE}'...")
    src_ok = 0
    for fit, w in src_targets:
        try:
            patch_source(args.api, str(w["uuid"]), ENRICHED_SOURCE)
            src_ok += 1
        except requests.RequestException as e:
            print(f"  ! source update failed for {w['uuid']}: {e}", file=sys.stderr)
    print(f"  source updated: {src_ok}/{len(src_targets)}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
