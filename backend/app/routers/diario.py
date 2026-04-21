"""Read-only proxy for the `diario-alimentare` external API
(https://github.com/alexpani/diario-alimentare, LAN: 192.168.68.173:3000).

The dashboard goes through this proxy rather than calling the diario
directly so the browser has a single origin, CORS isn't a concern, and
the diario URL stays configurable server-side via `DIARIO_BASE_URL`.
"""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, HTTPException, Query

DIARIO_BASE_URL = os.environ.get("DIARIO_BASE_URL", "http://192.168.68.173:3000")
TIMEOUT = 10.0

router = APIRouter(prefix="/api/v1/diario", tags=["diario"])


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
