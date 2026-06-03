"""Layer IA per annotare le candidate di correlazione esame ↔ regime/nota.

Riceve una candidata (prodotta dal motore deterministico in
`lab_correlations.py`) e chiede a Claude di valutarne la **plausibilita'
farmacologica/fisiologica**, con una breve spiegazione del meccanismo noto.

INQUADRAMENTO: sono IPOTESI da verificare con un medico, mai diagnosi o
consigli. Il prompt vieta esplicitamente consigli/posologie.

La chiamata e' isolata dietro `call_llm()` per poter essere mockata nei test
(come `medical_docs_ingest.call_llm`).
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

MAX_LLM_TOKENS = 400
PLAUSIBILITY_VALUES = ("none", "low", "medium", "high")

_CHANGE_LABELS = {
    "started": "iniziato",
    "stopped": "sospeso",
    "dose_increase": "dose aumentata",
    "dose_decrease": "dose ridotta",
    "dose_changed": "dose cambiata",
    "note_started": "comparsa",
    "note_resolved": "risolta",
}
_DIR_LABELS = {"up": "in aumento", "down": "in calo", "flat": "stabile"}


SYSTEM_PROMPT = """Sei un assistente che valuta la PLAUSIBILITA' di una possibile
associazione temporale fra la variazione di un esame di laboratorio e un evento
di terapia/integrazione/stile di vita o una nota di salute.

NON sei un medico: NON dare diagnosi, NON dare consigli, NON suggerire dosaggi o
modifiche di terapia. Tratta tutto come IPOTESI da verificare con un medico.

Rispondi SOLO con questo JSON (niente testo prima/dopo, niente markdown):
- plausibility: "none" | "low" | "medium" | "high" — quanto e' plausibile, in
  base alla letteratura nota, che quel fattore causi quella variazione
  dell'analita. "none" se non esiste un nesso fisiopatologico noto.
- is_known_association: true/false — true se e' un'associazione ben documentata
  (es. allopurinolo → rialzo transaminasi; statine → CK; diuretici → potassio).
- mechanism_text: stringa in italiano, max 4 righe, fattuale, che spiega il
  meccanismo noto oppure dichiara l'incertezza. Niente consigli, niente "dovresti".

Regole: non inventare nessi inesistenti; se incerto usa plausibility bassa e
dillo nel mechanism_text."""


@dataclass
class Annotation:
    plausibility: str
    is_known_association: bool
    mechanism_text: str | None


def build_user_message(c: dict[str, Any]) -> str:
    f = c.get("factor", {})
    change = _CHANGE_LABELS.get(f.get("change_type", ""), f.get("change_type", ""))
    direction = _DIR_LABELS.get(c.get("direction", ""), c.get("direction", ""))
    dose_bit = ""
    if f.get("old_dose") or f.get("new_dose"):
        dose_bit = f" (da {f.get('old_dose') or '?'} a {f.get('new_dose') or '?'})"
    oor_bit = {
        "crossed_in": " ed e' uscito dal range di riferimento",
        "left": " ed e' rientrato nel range",
        "stayed_oor": " (resta fuori range)",
        "stayed_in": "",
    }.get(c.get("oor_transition", ""), "")
    rel = c.get("rel_delta")
    rel_bit = f" ({rel*100:+.0f}%)" if isinstance(rel, (int, float)) else ""
    src = "farmaco/integratore/regime" if f.get("source") == "regimen" else "nota di salute"
    return (
        f"Analita: {c.get('analyte_name')} (categoria: {c.get('analyte_category')}).\n"
        f"Variazione fra due prelievi a {c.get('interval_days')} giorni di distanza: "
        f"da {c.get('prev_value')} a {c.get('cur_value')} {c.get('unit') or ''}{rel_bit}, "
        f"{direction}{oor_bit}.\n"
        f"Evento concomitante ({src}): \"{f.get('name')}\" {change}{dose_bit} "
        f"il {f.get('event_date')}.\n"
        f"Valuta la plausibilita' che l'evento spieghi la variazione dell'analita."
    )


def call_llm(candidate: dict[str, Any]) -> dict[str, Any]:
    """Chiama Anthropic e ritorna il dict JSON. Solleva RuntimeError su errore."""
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY non configurata")
    from anthropic import Anthropic

    client = Anthropic(api_key=settings.anthropic_api_key)
    resp = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=MAX_LLM_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": build_user_message(candidate)}],
    )
    body = "".join(
        b.text for b in resp.content if getattr(b, "type", None) == "text"
    ).strip()
    if body.startswith("```"):
        body = body.strip("`")
        nl = body.find("\n")
        if nl != -1 and not body[:nl].strip().startswith("{"):
            body = body[nl + 1:]
        body = body.rsplit("```", 1)[0].strip()
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Risposta LLM non JSON: {exc}\nBody: {body[:300]!r}") from exc


def parse_annotation(payload: dict[str, Any]) -> Annotation:
    p = str(payload.get("plausibility", "none")).strip().lower()
    if p not in PLAUSIBILITY_VALUES:
        p = "none"
    mech = payload.get("mechanism_text")
    mech = str(mech).strip() if mech else None
    return Annotation(
        plausibility=p,
        is_known_association=bool(payload.get("is_known_association", False)),
        mechanism_text=mech or None,
    )
