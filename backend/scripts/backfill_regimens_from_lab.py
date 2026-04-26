"""Backfill della tabella `regimens` dai campi context dei panel lab confermati.

Per ogni `lab_panels` con `status='confirmed'` e `test_date IS NOT NULL`,
i campi text di contesto (`medications_text`, `supplements_text`,
`diet_text`, `nutrition_text`, `workout_text`) vengono splittati su
newline / `;` / `,`, ogni voce viene parsata best-effort in (name, dose)
e inserita come `regimens(source='lab_backfill', start_date=NULL,
end_date=panel.test_date)`.

L'UNIQUE index parziale `uq_regimens_lab_backfill` (kind, name, end_date)
WHERE source='lab_backfill' rende il re-run idempotente: la seconda
esecuzione fa 0 insert.

Uso:
    cd backend
    python -m scripts.backfill_regimens_from_lab [--dry-run|--commit]

Default: --dry-run (scrive solo il report). Output:
`backfill_regimens_report.tsv` accanto allo script con
(panel_id, panel_date, field, raw_entry, parsed_kind, parsed_name,
parsed_dose, action).
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session as default_session_factory
from app.models import Regimen
from app.models.lab import LabPanel


FIELD_TO_KIND = {
    "medications_text": "medication",
    "supplements_text": "supplement",
    "diet_text": "diet",
    "nutrition_text": "diet",
    "workout_text": "training",
}

# Regex dose-split. Cattura name (greedy minimo) seguito da
# numero+unita' o frequenze tipo "1cp/die".
_DOSE_RE = re.compile(
    r"^\s*(?P<name>.+?)\s+(?P<dose>"
    r"\d+[\.,]?\d*\s*"                    # numero
    r"(?:mg|g|mcg|µg|ug|kg|ml|l|cl|"      # unita' di massa/volume
    r"UI|IU|"                             # unita' internazionali
    r"cp|cps|capsule|compresse?|"         # forma farmaceutica
    r"gtt|gocce|spruzzi?|puff|"
    r"%|"
    r"x\d+|/(?:die|d|day|giorno|h|hour|sett|mese))" # frequenze
    r"[\w/.,\-\s]*"                       # coda libera
    r")\s*$",
    re.IGNORECASE,
)

# Splitter "voce per voce"
_SPLIT_RE = re.compile(r"[\n;,]+")


@dataclass
class ReportRow:
    panel_id: int
    panel_date: str
    field: str
    raw_entry: str
    parsed_kind: str
    parsed_name: str
    parsed_dose: str | None
    action: str  # 'insert' | 'skip-dup' | 'skip-empty'


def parse_entry(entry: str) -> tuple[str, str | None] | None:
    """Splitta una singola voce in (name, dose). None se troppo corta."""
    s = entry.strip()
    if len(s) < 3:
        return None
    m = _DOSE_RE.match(s)
    if m:
        return m.group("name").strip(), m.group("dose").strip()
    return s, None


def split_field(raw: str | None) -> list[str]:
    if not raw:
        return []
    parts = _SPLIT_RE.split(raw)
    return [p.strip() for p in parts if p and p.strip()]


async def backfill(commit: bool, report_path: Path) -> tuple[int, int, int]:
    rows: list[ReportRow] = []
    inserted = 0
    skipped_dup = 0
    skipped_empty = 0

    session_factory = default_session_factory
    async with session_factory() as db:  # type: AsyncSession
        panels = (
            await db.execute(
                select(LabPanel)
                .where(LabPanel.status == "confirmed")
                .where(LabPanel.test_date.is_not(None))
                .order_by(LabPanel.test_date.asc())
            )
        ).scalars().all()

        for p in panels:
            for field, kind in FIELD_TO_KIND.items():
                raw = getattr(p, field, None)
                entries = split_field(raw)
                if not entries:
                    continue
                for entry in entries:
                    parsed = parse_entry(entry)
                    if parsed is None:
                        rows.append(ReportRow(
                            p.id, p.test_date.isoformat(), field, entry,
                            kind, "", None, "skip-empty",
                        ))
                        skipped_empty += 1
                        continue
                    name, dose = parsed

                    # Check idempotenza (kind, name, end_date) WHERE source='lab_backfill'
                    existing = (
                        await db.execute(
                            select(Regimen.id)
                            .where(Regimen.source == "lab_backfill")
                            .where(Regimen.kind == kind)
                            .where(Regimen.name == name)
                            .where(Regimen.end_date == p.test_date)
                        )
                    ).first()
                    if existing:
                        rows.append(ReportRow(
                            p.id, p.test_date.isoformat(), field, entry,
                            kind, name, dose, "skip-dup",
                        ))
                        skipped_dup += 1
                        continue

                    if commit:
                        db.add(Regimen(
                            kind=kind, name=name, dose=dose,
                            start_date=None, end_date=p.test_date,
                            source="lab_backfill",
                            notes=f"Importato dal panel lab #{p.id} "
                                  f"({p.test_date.isoformat()}, campo {field})",
                        ))
                    rows.append(ReportRow(
                        p.id, p.test_date.isoformat(), field, entry,
                        kind, name, dose, "insert",
                    ))
                    inserted += 1

        if commit:
            await db.commit()

    # Scrivi report TSV
    with report_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, dialect="excel-tab")
        w.writerow([
            "panel_id", "panel_date", "field", "raw_entry",
            "kind", "name", "dose", "action",
        ])
        for r in rows:
            w.writerow([
                r.panel_id, r.panel_date, r.field, r.raw_entry,
                r.parsed_kind, r.parsed_name, r.parsed_dose or "", r.action,
            ])

    return inserted, skipped_dup, skipped_empty


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true",
                   help="Default. Genera solo il report, niente DB write.")
    g.add_argument("--commit", action="store_true",
                   help="Inserisce davvero nel DB.")
    ap.add_argument("--report", default="backfill_regimens_report.tsv")
    args = ap.parse_args()

    commit = bool(args.commit)
    report_path = Path(args.report)

    inserted, skipped_dup, skipped_empty = asyncio.run(
        backfill(commit=commit, report_path=report_path)
    )

    mode = "COMMIT" if commit else "DRY-RUN"
    print(f"[{mode}] inserted={inserted}, skip-dup={skipped_dup}, "
          f"skip-empty={skipped_empty}")
    print(f"Report: {report_path.resolve()}")


if __name__ == "__main__":
    main()
