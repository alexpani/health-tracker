"""Read-only proxy for the `stretching` external API
(https://github.com/alexpani/stretching, LAN: 192.168.68.150:3100).

Same shape as `diario.py`: the dashboard goes through the backend so the
browser has a single origin, CORS isn't a concern, and the stretching
service URL stays configurable server-side via `STRETCHING_BASE_URL`.
"""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, HTTPException, Query

STRETCHING_BASE_URL = os.environ.get(
    "STRETCHING_BASE_URL", "http://192.168.68.150:3100"
)
TIMEOUT = 10.0

router = APIRouter(prefix="/api/v1/stretching", tags=["stretching"])


async def _forward(path: str, params: dict | None = None):
    url = f"{STRETCHING_BASE_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(url, params=params)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"stretching unreachable: {e}")
    if r.status_code >= 400:
        try:
            body = r.json()
        except Exception:
            body = {"error": f"stretching error {r.status_code}"}
        raise HTTPException(
            r.status_code if r.status_code != 404 else 502,
            body.get("error", "stretching error") if isinstance(body, dict) else "stretching error",
        )
    return r.json()


@router.get("/sessions")
async def sessions(
    from_: str | None = Query(None, alias="from", description="YYYY-MM-DD"),
    to: str | None = Query(None, description="YYYY-MM-DD"),
):
    """Forward to `GET /api/external/sessions?from=&to=`."""
    params: dict[str, str] = {}
    if from_:
        params["from"] = from_
    if to:
        params["to"] = to
    return await _forward("/api/external/sessions", params or None)


@router.get("/sessions/{session_id}")
async def session_detail(session_id: str):
    """Forward to `GET /api/external/sessions/:id`."""
    return await _forward(f"/api/external/sessions/{session_id}")


@router.get("/routines")
async def routines():
    """Forward to `GET /api/external/routines`."""
    return await _forward("/api/external/routines")


@router.get("/exercises")
async def exercises():
    """Forward to `GET /api/external/exercises`."""
    return await _forward("/api/external/exercises")
