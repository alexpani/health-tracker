"""Read-only proxy for the `diario-alimentare` external API
(https://github.com/alexpani/diario-alimentare, LAN: 192.168.68.173:3000)
+ diario → Apple Health sync orchestration.

The dashboard goes through the proxy rather than calling the diario
directly so the browser has a single origin, CORS isn't a concern, and
the diario URL stays configurable server-side via `DIARIO_BASE_URL`.
"""
from __future__ import annotations

import os
from datetime import date as date_cls, datetime, time, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DiarioHkSync, PendingDeletion, PendingWrite

DIARIO_BASE_URL = os.environ.get("DIARIO_BASE_URL", "http://192.168.68.173:3000")
TIMEOUT = 10.0

router = APIRouter(prefix="/api/v1/diario", tags=["diario"])

# Dietary types we push, with (diario_field, HK unit).
_DIETARY_SYNC_MAP = [
    ("kcal",      "HKQuantityTypeIdentifierDietaryEnergyConsumed", "kcal"),
    ("protein_g", "HKQuantityTypeIdentifierDietaryProtein",        "g"),
    ("fat_g",     "HKQuantityTypeIdentifierDietaryFatTotal",       "g"),
    ("carbs_g",   "HKQuantityTypeIdentifierDietaryCarbohydrates",  "g"),
]
_VALUE_TOLERANCE = 0.5  # don't enqueue delete+rewrite for rounding noise


@router.get("/active-plan")
async def active_plan():
    """Forward to `GET /api/external/active-plan`. Returns the active nutrition
    plan, or 404 if the diario has no active plan, or 502 if the diario is
    unreachable."""
    url = f"{DIARIO_BASE_URL}/api/external/active-plan"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(url)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"diario-alimentare unreachable: {e}")
    if r.status_code == 404:
        raise HTTPException(404, "no_active_plan")
    if r.status_code >= 400:
        raise HTTPException(502, f"diario-alimentare error {r.status_code}")
    return r.json()


@router.get("/daily-totals")
async def daily_totals(
    from_: str = Query(..., alias="from", description="YYYY-MM-DD"),
    to: str = Query(..., description="YYYY-MM-DD"),
):
    """Forward to `GET /api/external/daily-totals?from=&to=`. Returns one entry
    per day that has at least one diary record."""
    url = f"{DIARIO_BASE_URL}/api/external/daily-totals"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(url, params={"from": from_, "to": to})
    except httpx.HTTPError as e:
        raise HTTPException(502, f"diario-alimentare unreachable: {e}")
    if r.status_code >= 400:
        # bubble up the diario error payload when possible
        try:
            body = r.json()
        except Exception:
            body = {"error": f"diario-alimentare error {r.status_code}"}
        raise HTTPException(r.status_code if r.status_code != 404 else 502, body.get("error", "diario-alimentare error"))
    return r.json()


@router.post("/sync-to-hk")
async def sync_to_hk(
    from_: str | None = Query(None, alias="from", description="YYYY-MM-DD, default 2010-01-01 (all history)"),
    to: str | None = Query(None, description="YYYY-MM-DD, default today"),
    db: AsyncSession = Depends(get_db),
):
    """
    Reconcile the diario-alimentare daily totals against what we've already
    written to Apple Health (tracked in `diario_hk_sync`). For every diff
    between the current diary value and the tracked value, enqueue a
    PendingDeletion (for the old hk_uuid, if any) and a PendingWrite (for
    the new value). The iOS Health Tracker app will process these via its
    existing pending-write/pending-delete loop at the next sync.

    This endpoint is idempotent: re-running it when nothing has changed
    produces no new queue entries.
    """
    # Date range
    end_date = to or datetime.now(timezone.utc).date().isoformat()
    start_date = from_ or "2010-01-01"

    # 1. Fetch diario daily totals
    url = f"{DIARIO_BASE_URL}/api/external/daily-totals"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(url, params={"from": start_date, "to": end_date})
    except httpx.HTTPError as e:
        raise HTTPException(502, f"diario-alimentare unreachable: {e}")
    if r.status_code >= 400:
        raise HTTPException(502, f"diario-alimentare error {r.status_code}")
    diary_rows: list[dict] = r.json()

    # 2. Load existing tracking rows into a dict for quick lookup
    tracked_stmt = select(DiarioHkSync)
    tracked_rows = (await db.execute(tracked_stmt)).scalars().all()
    tracked: dict[tuple[date_cls, str], DiarioHkSync] = {
        (row.date, row.type): row for row in tracked_rows
    }

    queued_writes = 0
    queued_deletes = 0
    unchanged = 0

    for entry in diary_rows:
        day_str = entry["date"]
        day = date_cls.fromisoformat(day_str)
        # Build aware datetimes for the whole day (used for HK sample start/end).
        start_dt = datetime.combine(day, time(0, 0, 0), tzinfo=timezone.utc)
        end_dt = datetime.combine(day, time(23, 59, 59), tzinfo=timezone.utc)

        for diary_field, hk_type, unit in _DIETARY_SYNC_MAP:
            value = float(entry.get(diary_field) or 0.0)
            if value <= 0:
                continue  # don't create zero-value samples

            track = tracked.get((day, hk_type))

            # Unchanged within tolerance? skip.
            if track is not None and abs(track.value - value) < _VALUE_TOLERANCE:
                unchanged += 1
                continue

            # Need to (re)write. Queue delete of the previous one if present.
            if track is not None and track.hk_uuid is not None:
                db.add(PendingDeletion(
                    hk_uuid=track.hk_uuid,
                    type=hk_type,
                    source_sample_id=None,  # HK-only, no backend health_samples row
                    status="pending",
                ))
                queued_deletes += 1

            # Queue the new write.
            pw = PendingWrite(
                type=hk_type,
                value=value,
                unit=unit,
                start_date=start_dt,
                end_date=end_dt,
                source_name="Diario Alimentare",
                notes=f"diario-alimentare totals for {day_str}",
                status="pending",
            )
            db.add(pw)
            # Need pw.id before committing → flush
            await db.flush()
            queued_writes += 1

            # Upsert the tracking row: clear hk_uuid, link the new pending_write
            if track is None:
                track = DiarioHkSync(
                    date=day,
                    type=hk_type,
                    value=value,
                    hk_uuid=None,
                    pending_write_id=pw.id,
                )
                db.add(track)
            else:
                track.value = value
                track.hk_uuid = None
                track.pending_write_id = pw.id

    await db.commit()

    return {
        "queued_writes": queued_writes,
        "queued_deletions": queued_deletes,
        "unchanged": unchanged,
        "days_considered": len(diary_rows),
    }
