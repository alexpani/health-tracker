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
from app.services.apns import fire_and_forget_push_all

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


@router.get("/plan-history")
async def plan_history():
    """Forward to `GET /api/external/plan-history`. Returns the full history of
    nutrition plans as dated segments (collapsed daily snapshots). Returns `[]`
    if the diario doesn't expose the endpoint yet (404) so the dashboard can
    gracefully fall back to the single active plan."""
    url = f"{DIARIO_BASE_URL}/api/external/plan-history"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(url)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"diario-alimentare unreachable: {e}")
    if r.status_code == 404:
        return []
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


async def reconcile_diario_to_hk(
    db: AsyncSession,
    *,
    from_: str | None = None,
    to: str | None = None,
) -> dict:
    """Compare diario-alimentare daily totals against the `diario_hk_sync`
    tracking and enqueue PendingDeletion/PendingWrite for every drift.
    Idempotent: returns {queued_writes:0, queued_deletions:0, unchanged:N}
    when nothing has changed. Used both by the explicit POST endpoint and
    automatically by GET /api/v1/write/pending so the iOS app picks up
    diario changes without any manual button press."""
    end_date = to or datetime.now(timezone.utc).date().isoformat()
    start_date = from_ or "2010-01-01"

    url = f"{DIARIO_BASE_URL}/api/external/daily-totals"
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        r = await client.get(url, params={"from": start_date, "to": end_date})
    r.raise_for_status()
    diary_rows: list[dict] = r.json()

    tracked_rows = (await db.execute(select(DiarioHkSync))).scalars().all()
    tracked: dict[tuple[date_cls, str], DiarioHkSync] = {
        (row.date, row.type): row for row in tracked_rows
    }

    queued_writes = 0
    queued_deletes = 0
    unchanged = 0

    for entry in diary_rows:
        day_str = entry["date"]
        day = date_cls.fromisoformat(day_str)
        start_dt = datetime.combine(day, time(0, 0, 0), tzinfo=timezone.utc)
        end_dt = datetime.combine(day, time(23, 59, 59), tzinfo=timezone.utc)

        for diary_field, hk_type, unit in _DIETARY_SYNC_MAP:
            value = float(entry.get(diary_field) or 0.0)
            if value <= 0:
                continue

            track = tracked.get((day, hk_type))

            if track is not None and abs(track.value - value) < _VALUE_TOLERANCE:
                unchanged += 1
                continue

            if track is not None and track.hk_uuid is not None:
                db.add(PendingDeletion(
                    hk_uuid=track.hk_uuid,
                    type=hk_type,
                    source_sample_id=None,
                    status="pending",
                ))
                queued_deletes += 1

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
            await db.flush()
            queued_writes += 1

            if track is None:
                track = DiarioHkSync(
                    date=day, type=hk_type, value=value,
                    hk_uuid=None, pending_write_id=pw.id,
                )
                db.add(track)
            else:
                track.value = value
                track.hk_uuid = None
                track.pending_write_id = pw.id

    await db.commit()

    # Silent push solo se abbiamo accodato qualcosa: la reconcile gira
    # spesso a vuoto (auto-trigger ogni 2 min), niente push fantasma.
    if queued_writes > 0 or queued_deletes > 0:
        fire_and_forget_push_all("diario_reconcile")

    return {
        "queued_writes": queued_writes,
        "queued_deletions": queued_deletes,
        "unchanged": unchanged,
        "days_considered": len(diary_rows),
    }


# In-memory throttle for auto-reconcile triggered by /write/pending.
# Keyed on a single shared timestamp; no per-tenant key (single-user app).
_LAST_AUTO_RECONCILE_AT: datetime | None = None
_AUTO_RECONCILE_THROTTLE_SECONDS = 120  # at most once every 2 minutes


async def auto_reconcile_if_due(db: AsyncSession) -> dict | None:
    """Called by GET /write/pending. Reconciles if it hasn't happened
    in the last _AUTO_RECONCILE_THROTTLE_SECONDS, otherwise no-op.
    Swallows network errors so a temporarily-down diario doesn't break
    the iOS sync loop."""
    global _LAST_AUTO_RECONCILE_AT
    now = datetime.now(timezone.utc)
    if _LAST_AUTO_RECONCILE_AT is not None and (now - _LAST_AUTO_RECONCILE_AT).total_seconds() < _AUTO_RECONCILE_THROTTLE_SECONDS:
        return None
    try:
        result = await reconcile_diario_to_hk(db)
        _LAST_AUTO_RECONCILE_AT = now
        return result
    except Exception:
        # Diario unreachable, schema drift, etc. — don't block the iOS poll.
        # Keep the timestamp untouched so we'll retry next call.
        return None


@router.post("/sync-to-hk")
async def sync_to_hk(
    from_: str | None = Query(None, alias="from", description="YYYY-MM-DD, default 2010-01-01 (all history)"),
    to: str | None = Query(None, description="YYYY-MM-DD, default today"),
    db: AsyncSession = Depends(get_db),
):
    """Manual trigger of the same reconciliation that `auto_reconcile_if_due`
    runs automatically before each /write/pending poll. Useful for forcing
    an immediate refresh from the dashboard."""
    try:
        return await reconcile_diario_to_hk(db, from_=from_, to=to)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"diario-alimentare unreachable: {e}")
