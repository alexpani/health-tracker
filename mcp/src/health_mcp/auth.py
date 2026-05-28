"""Bearer-token Starlette middleware.

Confronto in tempo costante (hmac.compare_digest) per evitare timing attacks.
Whitelist degli endpoint health-check fuori auth.
"""
from __future__ import annotations

import hmac

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .config import settings

_PUBLIC_PATHS = {"/healthz", "/livez"}


class BearerAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        if request.url.path in _PUBLIC_PATHS:
            return await call_next(request)

        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            return JSONResponse(
                {"error": "missing or invalid Authorization header"}, status_code=401
            )

        token = header[7:].strip()
        if not hmac.compare_digest(token, settings.bearer_token):
            return JSONResponse({"error": "invalid token"}, status_code=403)

        return await call_next(request)
