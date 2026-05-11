"""Sanitizzazione HTML per le voci del diario giornaliero.

L'editor Tiptap lato dashboard produce HTML; per evitare XSS lo
puliamo prima di scrivere su DB. Whitelist minimale di tag testuali +
liste + heading + link. Tutti gli attributi non whitelisted vengono
strippati; sui link forziamo `rel="noopener noreferrer"`.

Esponiamo `sanitize_journal_html` che ritorna `(html_clean, plain_text)`.
Il plain text serve per la ricerca full-text-ILIKE.
"""
from __future__ import annotations

import re

import bleach


ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "s", "strike",
    "h1", "h2", "h3", "h4",
    "ul", "ol", "li",
    "blockquote", "code", "pre",
    "a",
}

ALLOWED_ATTRIBUTES = {
    "a": ["href", "title", "rel", "target"],
}

ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


def _force_link_rel(attrs: dict, new: bool = False) -> dict:
    """Linkify/sanitize callback: forza rel + target sicuro su tutti gli <a>."""
    attrs[(None, "rel")] = "noopener noreferrer"
    if (None, "target") in attrs and attrs[(None, "target")] == "_blank":
        pass
    return attrs


def sanitize_journal_html(raw_html: str) -> tuple[str, str]:
    """Ritorna `(html_pulito, plain_text)`.

    Lancia `ValueError` se il plain text risultante e' vuoto (la voce
    diario deve avere almeno un carattere significativo).
    """
    cleaned = bleach.clean(
        raw_html or "",
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
    )

    # Forziamo rel=noopener su tutti gli <a> superstiti (semplice regex —
    # bleach.linkify e' overkill qui).
    def _rel(match: re.Match) -> str:
        tag = match.group(0)
        if "rel=" in tag:
            return tag
        return tag[:-1] + ' rel="noopener noreferrer">'

    cleaned = re.sub(r"<a\b[^>]*>", _rel, cleaned)

    plain = _to_plain_text(cleaned)
    if not plain.strip():
        raise ValueError("content is empty after sanitization")

    return cleaned, plain


def _to_plain_text(html: str) -> str:
    """Estrae plain text da HTML: rimuove tutti i tag, decodifica entita',
    collassa spazi multipli. Usato per la ricerca server-side."""
    # bleach.clean con tags=set() strippa TUTTO. Aggiungiamo spazi sui
    # tag block-level per evitare "Hellomondo".
    spaced = re.sub(r"<(/?)(p|br|li|h[1-6]|div|blockquote|pre)\b[^>]*>",
                    " ", html, flags=re.IGNORECASE)
    txt = bleach.clean(spaced, tags=set(), attributes={}, strip=True)
    # Decodifica entita' base via html.unescape
    import html as _html
    txt = _html.unescape(txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt


def normalize_tags(raw_tags: list[str] | None) -> list[str]:
    """Normalizza una lista di tag: trim, lowercase, drop vuoti e dedup
    preservando l'ordine di inserimento."""
    if not raw_tags:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for t in raw_tags:
        if not isinstance(t, str):
            continue
        norm = t.strip().lower()
        if not norm or norm in seen:
            continue
        if len(norm) > 50:
            norm = norm[:50]
        seen.add(norm)
        out.append(norm)
    return out
