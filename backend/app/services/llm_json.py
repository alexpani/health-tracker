"""Parsing tollerante delle risposte JSON dei modelli."""
from __future__ import annotations

import json
from typing import Any


def parse_llm_json(body: str, stop_reason: str | None = None) -> dict[str, Any]:
    """Estrae il primo oggetto JSON dalla risposta del modello.

    Tollera code-fence ```json, testo prima dell'oggetto e testo/dati extra
    dopo (es. un commento o un secondo oggetto). Solleva `RuntimeError` se il
    JSON non e' valido — con un messaggio esplicito se la risposta e' stata
    troncata per `max_tokens`.
    """
    body = body.strip()
    if body.startswith("```"):
        body = body.strip("`")
        first_nl = body.find("\n")
        if first_nl != -1 and not body[:first_nl].strip().startswith("{"):
            body = body[first_nl + 1:]
        body = body.rsplit("```", 1)[0].strip()
    start = body.find("{")
    try:
        if start == -1:
            raise json.JSONDecodeError("nessun oggetto JSON", body, 0)
        obj, _ = json.JSONDecoder().raw_decode(body, start)
        return obj
    except json.JSONDecodeError as exc:
        if stop_reason == "max_tokens":
            raise RuntimeError(
                f"Risposta LLM troncata (max_tokens raggiunto, {len(body)} char)"
            ) from exc
        raise RuntimeError(
            f"Risposta LLM non e' JSON valido: {exc}\nBody: {body[:500]!r}"
        ) from exc
