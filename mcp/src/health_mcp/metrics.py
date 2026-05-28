"""Catalogo metriche caricato da YAML.

Ogni metric e' una subquery che ritorna `(t, v)`. I tool analitici
wrappano queste subquery con date_trunc + aggregati standard.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# Cerca metrics.yaml in due location: cwd e accanto al package (per dev).
_CANDIDATES = [
    Path("/opt/health-mcp/metrics.yaml"),
    Path(__file__).parent.parent.parent / "metrics.yaml",
    Path.cwd() / "metrics.yaml",
]


@dataclass
class Metric:
    slug: str
    query: str  # subquery che ritorna (t, v)
    unit: str = ""
    category: str = ""
    description: str = ""

    def cte_sql(self, alias: str = "m") -> str:
        """Restituisce il SELECT della metrica wrappato come subquery."""
        return f"({self.query.strip()}) AS {alias}"


_CACHE: dict[str, Metric] | None = None
_PATH: Path | None = None


def _find_yaml() -> Path:
    for p in _CANDIDATES:
        if p.exists():
            return p
    raise FileNotFoundError(
        f"metrics.yaml non trovato in nessuna location: {[str(p) for p in _CANDIDATES]}"
    )


def load_catalog(force: bool = False) -> dict[str, Metric]:
    global _CACHE, _PATH
    if _CACHE is not None and not force:
        return _CACHE
    path = _find_yaml()
    with path.open() as f:
        raw: dict[str, dict[str, Any]] = yaml.safe_load(f) or {}
    catalog: dict[str, Metric] = {}
    for slug, spec in raw.items():
        if not isinstance(spec, dict) or "query" not in spec:
            continue
        catalog[slug] = Metric(
            slug=slug,
            query=spec["query"],
            unit=spec.get("unit", ""),
            category=spec.get("category", ""),
            description=spec.get("description", ""),
        )
    _CACHE = catalog
    _PATH = path
    return catalog


def get(slug: str) -> Metric:
    catalog = load_catalog()
    if slug not in catalog:
        raise KeyError(f"Metrica '{slug}' non in catalogo. Slug disponibili: {sorted(catalog)[:10]}...")
    return catalog[slug]


def all_slugs() -> list[str]:
    return sorted(load_catalog().keys())


def by_category() -> dict[str, list[Metric]]:
    cats: dict[str, list[Metric]] = {}
    for m in load_catalog().values():
        cats.setdefault(m.category or "other", []).append(m)
    for v in cats.values():
        v.sort(key=lambda m: m.slug)
    return dict(sorted(cats.items()))


def catalog_path() -> Path | None:
    load_catalog()
    return _PATH
