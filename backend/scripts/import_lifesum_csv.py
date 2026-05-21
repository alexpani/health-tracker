"""Import Lifesum CSV export into the Health Tracker backend as daily dietary totals.

Aggregates per-meal rows by date and POSTs one HK-style quantity sample per
(day, dietary type) with source_name='Lifesum'. Idempotent via UUID5.

Usage:
    python3 scripts/import_lifesum_csv.py \
        --file /path/to/food.csv \
        --api  http://192.168.68.166:8000 \
        [--min-kcal 200] [--commit]
"""
from __future__ import annotations

import argparse
import csv
import sys
import uuid
from collections import defaultdict
from datetime import date as date_cls, datetime, time
from zoneinfo import ZoneInfo

import requests

TZ = ZoneInfo("Europe/Rome")
SOURCE_NAME = "Lifesum"
SOURCE_BUNDLE_ID = "com.sillens.shapeupclub"
UUID_PREFIX = "lifesum-csv"

# CSV column -> (HKQuantityTypeIdentifier, unit)
MAPPING = {
    "calories":      ("HKQuantityTypeIdentifierDietaryEnergyConsumed", "kcal"),
    "carbs":         ("HKQuantityTypeIdentifierDietaryCarbohydrates",  "g"),
    "carbs_fiber":   ("HKQuantityTypeIdentifierDietaryFiber",          "g"),
    "carbs_sugar":   ("HKQuantityTypeIdentifierDietarySugar",          "g"),
    "cholesterol":   ("HKQuantityTypeIdentifierDietaryCholesterol",    "mg"),
    "fat":           ("HKQuantityTypeIdentifierDietaryFatTotal",       "g"),
    "fat_saturated": ("HKQuantityTypeIdentifierDietaryFatSaturated",   "g"),
    "potassium":     ("HKQuantityTypeIdentifierDietaryPotassium",      "mg"),
    "protein":       ("HKQuantityTypeIdentifierDietaryProtein",        "g"),
    "sodium":        ("HKQuantityTypeIdentifierDietarySodium",         "mg"),
}


def aggregate(csv_path: str) -> dict[date_cls, dict[str, float]]:
    """Return {date: {csv_field: sum}} from the per-meal CSV."""
    agg: dict[date_cls, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                d = date_cls.fromisoformat(row["date"])
            except (KeyError, ValueError):
                continue
            for field in MAPPING:
                v = row.get(field, "")
                if not v:
                    continue
                try:
                    agg[d][field] += float(v)
                except ValueError:
                    pass
    return agg


def fetch_existing_lifesum_days(api: str) -> set[date_cls]:
    """Days that already have at least one Lifesum DietaryEnergyConsumed sample."""
    url = f"{api}/api/v1/samples"
    params = {
        "type": "HKQuantityTypeIdentifierDietaryEnergyConsumed",
        "sources": SOURCE_NAME,
        "start": "2010-01-01",
        "end": "2030-12-31",
        "aggregation": "none",
        "limit": 10000,
    }
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    data = r.json()
    points = data.get("samples") or data.get("data") or data
    days: set[date_cls] = set()
    for p in points:
        ts = p.get("start_date") or p.get("startDate") or p.get("date")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            continue
        days.add(dt.astimezone(TZ).date())
    return days


def build_samples(
    agg: dict[date_cls, dict[str, float]],
    skip_days: set[date_cls],
    min_kcal: float,
) -> tuple[list[dict], dict[str, int]]:
    samples: list[dict] = []
    stats = {"skipped_existing": 0, "skipped_low_kcal": 0, "days_imported": 0}
    per_type_counts: dict[str, int] = defaultdict(int)

    for d in sorted(agg.keys()):
        if d in skip_days:
            stats["skipped_existing"] += 1
            continue
        kcal = agg[d].get("calories", 0.0)
        if kcal < min_kcal:
            stats["skipped_low_kcal"] += 1
            continue
        stats["days_imported"] += 1

        ts_local = datetime.combine(d, time(12, 0, 0), tzinfo=TZ)
        ts_utc = ts_local.astimezone(ZoneInfo("UTC"))
        iso = ts_utc.isoformat()

        for field, (hk_type, unit) in MAPPING.items():
            value = agg[d].get(field, 0.0)
            if value <= 0:
                continue
            sample_uuid = uuid.uuid5(
                uuid.NAMESPACE_URL, f"{UUID_PREFIX}:{d.isoformat()}:{hk_type}"
            )
            samples.append({
                "uuid": str(sample_uuid),
                "type": hk_type,
                "value": round(value, 4),
                "unit": unit,
                "start_date": iso,
                "end_date": iso,
                "source_name": SOURCE_NAME,
                "source_bundle_id": SOURCE_BUNDLE_ID,
                "metadata": {"import": "lifesum_csv_v1"},
            })
            per_type_counts[hk_type] += 1

    stats["per_type"] = dict(per_type_counts)
    return samples, stats


def post_batches(api: str, samples: list[dict], chunk: int = 500) -> dict[str, int]:
    url = f"{api}/api/v1/samples/batch"
    inserted = 0
    duplicates = 0
    for i in range(0, len(samples), chunk):
        batch = samples[i : i + chunk]
        payload = {"device_id": "lifesum-csv-import", "samples": batch}
        r = requests.post(url, json=payload, timeout=60)
        r.raise_for_status()
        result = r.json()
        inserted += result.get("inserted", 0)
        duplicates += result.get("duplicates_skipped", 0)
        print(
            f"  batch {i // chunk + 1}/{(len(samples) + chunk - 1) // chunk}: "
            f"{len(batch)} sent, {result.get('inserted', 0)} inserted, "
            f"{result.get('duplicates_skipped', 0)} duplicates"
        )
    return {"inserted": inserted, "duplicates": duplicates}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True, help="Path to Lifesum food.csv")
    ap.add_argument("--api", required=True, help="Backend base URL (e.g. http://192.168.68.166:8000)")
    ap.add_argument("--min-kcal", type=float, default=200.0,
                    help="Skip days whose total kcal is below this threshold (default: 200)")
    ap.add_argument("--commit", action="store_true",
                    help="Actually POST. Without this flag the script is a dry-run.")
    args = ap.parse_args()

    print(f"Reading {args.file}...")
    agg = aggregate(args.file)
    print(f"  parsed days in CSV: {len(agg)} "
          f"({min(agg):%Y-%m-%d} -> {max(agg):%Y-%m-%d})")

    print(f"Querying backend for existing Lifesum days at {args.api}...")
    existing = fetch_existing_lifesum_days(args.api)
    print(f"  days already present (source=Lifesum, kcal): {len(existing)}")

    samples, stats = build_samples(agg, existing, args.min_kcal)
    print()
    print(f"Days to import:  {stats['days_imported']}")
    print(f"Days skipped (already in DB):     {stats['skipped_existing']}")
    print(f"Days skipped (kcal < {args.min_kcal:g}):       {stats['skipped_low_kcal']}")
    print(f"Total samples to send:             {len(samples)}")
    print("Per-type breakdown:")
    for hk_type, n in sorted(stats["per_type"].items()):
        print(f"  {hk_type:55s} {n:>5}")

    if not samples:
        print("\nNothing to import.")
        return 0

    if not args.commit:
        print("\n(dry-run) Re-run with --commit to actually POST.")
        return 0

    print("\nPosting batches...")
    result = post_batches(args.api, samples)
    print()
    print(f"Inserted:   {result['inserted']}")
    print(f"Duplicates: {result['duplicates']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
