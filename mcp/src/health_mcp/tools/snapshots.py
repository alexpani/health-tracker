"""Tool di sintesi: thin wrapper su FastAPI per scenari ricorrenti."""
from __future__ import annotations

from datetime import date as date_type
from typing import Any

import httpx

from ..api_client import api_get
from ..db import get_pool


async def get_day(day: str) -> dict[str, Any]:
    """Snapshot completo di un giorno: attivita', vitali, corpo, sonno, workout, lab, nutrizione, regimi.

    Args:
        day: data ISO YYYY-MM-DD.
    """
    try:
        return await api_get(f"/api/v1/day/{day}")
    except httpx.HTTPStatusError as e:
        return {"error": f"HTTP {e.response.status_code}", "detail": e.response.text}


async def get_active_regimens(on_date: str | None = None) -> dict[str, Any]:
    """Regimi attivi a una data (default: oggi). Include farmaci, integratori, diete, training, gear."""
    params = {"active_on": on_date} if on_date else {"active_on": date_type.today().isoformat()}
    try:
        rows = await api_get("/api/v1/regimens", params=params)
        return {"date": params["active_on"], "regimens": rows}
    except httpx.HTTPStatusError as e:
        return {"error": f"HTTP {e.response.status_code}", "detail": e.response.text}


async def get_health_profile() -> dict[str, Any]:
    """Profilo: anagrafica, peso/altezza recenti, BMI, regimi attivi oggi, baselines RHR/HRV.

    Combinazione di query SQL su catalogo + chiamate API. Anagrafica hardcoded da CLAUDE.md.
    """
    pool = await get_pool()
    profile: dict[str, Any] = {
        "name": "Alessandro Pani",
        "birthdate": "1969-06-23",
    }

    today = date_type.today()
    age = today.year - 1969 - ((today.month, today.day) < (6, 23))
    profile["age"] = age

    async with pool.acquire() as con:
        # Ultimo peso
        weight = await con.fetchrow(
            """
            SELECT value, unit, start_date, source_name
            FROM health_samples
            WHERE type = 'HKQuantityTypeIdentifierBodyMass'
            ORDER BY start_date DESC LIMIT 1
            """
        )
        if weight:
            profile["last_weight_kg"] = float(weight["value"])
            profile["last_weight_at"] = weight["start_date"].isoformat()

        # Ultima altezza
        height = await con.fetchrow(
            """
            SELECT value FROM health_samples
            WHERE type = 'HKQuantityTypeIdentifierHeight'
            ORDER BY start_date DESC LIMIT 1
            """
        )
        if height:
            h_m = float(height["value"])
            profile["height_m"] = h_m
            if weight:
                profile["bmi"] = round(float(weight["value"]) / (h_m * h_m), 2)

        # Ultimo body fat
        bf = await con.fetchrow(
            """
            SELECT value FROM health_samples
            WHERE type = 'HKQuantityTypeIdentifierBodyFatPercentage'
            ORDER BY start_date DESC LIMIT 1
            """
        )
        if bf:
            profile["last_body_fat_pct"] = round(float(bf["value"]) * 100, 1)

        # Baseline 60g RHR
        rhr = await con.fetchrow(
            """
            SELECT AVG(value)::float AS avg_rhr, COUNT(*) AS n
            FROM health_samples
            WHERE type = 'HKQuantityTypeIdentifierRestingHeartRate'
              AND start_date >= NOW() - INTERVAL '60 days'
            """
        )
        if rhr and rhr["avg_rhr"]:
            profile["rhr_baseline_60d"] = round(rhr["avg_rhr"], 1)
            profile["rhr_baseline_n"] = rhr["n"]

        # Baseline 60g HRV
        hrv = await con.fetchrow(
            """
            SELECT AVG(value)::float AS avg_hrv, COUNT(*) AS n
            FROM health_samples
            WHERE type = 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'
              AND start_date >= NOW() - INTERVAL '60 days'
            """
        )
        if hrv and hrv["avg_hrv"]:
            profile["hrv_baseline_60d_ms"] = round(hrv["avg_hrv"], 1)

    # Regimi attivi oggi via API
    try:
        regimens = await api_get(
            "/api/v1/regimens", params={"active_on": today.isoformat()}
        )
        profile["active_regimens"] = [
            {"kind": r["kind"], "name": r["name"], "dose": r.get("dose")}
            for r in regimens
        ]
    except Exception as e:
        profile["active_regimens_error"] = str(e)

    return profile
