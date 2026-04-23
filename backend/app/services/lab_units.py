"""Normalizzazione unità e calcolo `out_of_range` al momento del confirm (§5.3).

Strategia MVP:
- `normalize_unit` collassa varianti ortografiche comuni (µ→u, casing, spazi).
- `units_equivalent` usa la tabella `_EQUIVALENTS` per coppie note che sono la
  stessa quantità con nome diverso (es. `ng/ml == µg/l`).
- Per conversioni di valore fra unità diverse (`mg/dl ↔ mmol/l`), useremmo
  fattori analita-specifici: non li codifichiamo qui, lasciamo il result come
  `needs_review=True` con `unit_normalized=None`. Così l'utente può
  intervenire in review invece che affidarsi a una conversione silente.
- Per i qualitativi/semi-quantitativi: confronto normalizzato value_text ↔
  ref_text; `out_of_range` se il testo indica "presenza" mentre il ref
  indica "assenza".
"""
from __future__ import annotations

from decimal import Decimal


def normalize_unit(u: str | None) -> str | None:
    if u is None:
        return None
    s = u.strip().lower().replace("µ", "u").replace(" ", "")
    # Normalizza unicode slash / divisione
    s = s.replace("∕", "/").replace("⁄", "/")
    return s or None


# Coppie di unità che rappresentano la stessa quantità (valore NON va toccato).
# Sinistra e destra sono già normalizzate via normalize_unit.
_EQUIVALENTS: list[frozenset[str]] = [
    frozenset({"ng/ml", "ug/l"}),
    frozenset({"mg/l", "ug/ml"}),
    frozenset({"mui/ml", "miu/ml", "mui/l", "iu/l", "u/l"}),  # U/l ≡ IU/l
    frozenset({"uui/ml", "uiu/ml", "uiu/l"}),
    frozenset({"pg/ml", "ng/l"}),
    frozenset({"nmol/l", "nm"}),
    frozenset({"mmol/l", "mm"}),
    frozenset({"ug/dl", "ug/100ml"}),
]


def units_equivalent(a: str | None, b: str | None) -> bool:
    if a is None or b is None:
        return False
    na, nb = normalize_unit(a), normalize_unit(b)
    if na == nb:
        return True
    for group in _EQUIVALENTS:
        if na in group and nb in group:
            return True
    return False


# Set di stringhe (normalizzate) per il matching qualitativo.
_NEGATIVE_VALUES = {
    "assente", "assenti", "negativo", "negativa",
    "rare", "rari", "poche", "pochi",
    "0",
}
_POSITIVE_MARKERS = {
    "+", "++", "+++", "++++",
    "tracce", "traccia",
    "positivo", "positiva",
    "presente", "presenti",
    "molte", "molti", "numerose", "numerosi",
}


def _norm_text(s: str | None) -> str:
    return (s or "").strip().lower()


def qualitative_out_of_range(value_text: str | None, ref_text: str | None) -> bool | None:
    """Ritorna True/False se è possibile decidere, None se indecidibile.

    - Se ref_text indica "assenza" e value_text è un marker positivo → True.
    - Se ref_text indica "assenza" e value_text è uguale → False.
    - Altrimenti None (il chiamante lascerà `out_of_range` a None e/o
      `needs_review=True`).
    """
    v = _norm_text(value_text)
    r = _norm_text(ref_text)
    if not v or not r:
        return None
    if r in _NEGATIVE_VALUES:
        if v in _POSITIVE_MARKERS:
            return True
        if v in _NEGATIVE_VALUES or v == r:
            return False
    # value e ref identici → non fuori range
    if v == r:
        return False
    return None


def numeric_out_of_range(
    value: Decimal | None,
    ref_low: Decimal | None,
    ref_high: Decimal | None,
) -> bool | None:
    """True se `value < ref_low` o `value > ref_high`. None se mancano dati."""
    if value is None:
        return None
    if ref_low is None and ref_high is None:
        return None
    if ref_low is not None and value < ref_low:
        return True
    if ref_high is not None and value > ref_high:
        return True
    return False
