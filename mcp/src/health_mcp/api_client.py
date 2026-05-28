"""Thin httpx async client verso il FastAPI backend interno."""
from __future__ import annotations

from typing import Any

import httpx

from .config import settings

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=settings.api_url,
            timeout=httpx.Timeout(15.0, connect=3.0),
        )
    return _client


async def api_get(path: str, params: dict[str, Any] | None = None) -> Any:
    """GET su FastAPI backend. Solleva su 4xx/5xx."""
    r = await _get_client().get(path, params=params)
    r.raise_for_status()
    return r.json()


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
