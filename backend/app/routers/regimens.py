"""Regimens router.

Periodi (farmaci / integratori / dieta / allenamento) con start/end date.
Alimentati dalla dashboard (`source='manual'`) o dallo script di backfill
dai panel lab confermati (`source='lab_backfill'`).
"""
from datetime import date as date_cls
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Regimen
from app.schemas import RegimenIn, RegimenOut, RegimenPatch

router = APIRouter(prefix="/api/v1/regimens", tags=["regimens"])

ALLOWED_KINDS = {"medication", "supplement", "diet", "training"}


def _validate_kind(kind: str) -> None:
    if kind not in ALLOWED_KINDS:
        raise HTTPException(
            status_code=400,
            detail=f"kind must be one of {sorted(ALLOWED_KINDS)}, got '{kind}'",
        )


@router.post("", response_model=RegimenOut, status_code=201)
async def create_regimen(payload: RegimenIn, db: AsyncSession = Depends(get_db)):
    _validate_kind(payload.kind)
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="name cannot be empty")
    if (
        payload.start_date is not None
        and payload.end_date is not None
        and payload.end_date < payload.start_date
    ):
        raise HTTPException(status_code=400, detail="end_date < start_date")

    row = Regimen(
        kind=payload.kind,
        name=payload.name.strip(),
        start_date=payload.start_date,
        end_date=payload.end_date,
        dose=payload.dose,
        notes=payload.notes,
        source="manual",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("", response_model=list[RegimenOut])
async def list_regimens(
    kind: str | None = Query(None),
    active_on: date_cls | None = Query(None, description="YYYY-MM-DD"),
    include_ended: bool = Query(True, description="Include regimens with end_date < today"),
    source: str | None = Query(None),
    limit: int = Query(500, le=2000),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Regimen)
    if kind:
        _validate_kind(kind)
        stmt = stmt.where(Regimen.kind == kind)
    if source:
        stmt = stmt.where(Regimen.source == source)
    if active_on is not None:
        # active = (start IS NULL OR start <= D) AND (end IS NULL OR end >= D)
        stmt = stmt.where(
            or_(Regimen.start_date.is_(None), Regimen.start_date <= active_on),
            or_(Regimen.end_date.is_(None), Regimen.end_date >= active_on),
        )
    elif not include_ended:
        from datetime import date as _d
        today = _d.today()
        stmt = stmt.where(or_(Regimen.end_date.is_(None), Regimen.end_date >= today))

    # NULLS LAST su start_date (in corso da prima del tracking → in fondo ai recenti)
    stmt = stmt.order_by(
        Regimen.start_date.desc().nulls_last(),
        Regimen.id.desc(),
    ).offset(offset).limit(limit)

    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.get("/{regimen_id}", response_model=RegimenOut)
async def get_regimen(regimen_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(Regimen).where(Regimen.id == regimen_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    return row


@router.patch("/{regimen_id}", response_model=RegimenOut)
async def update_regimen(
    regimen_id: int,
    patch: RegimenPatch,
    db: AsyncSession = Depends(get_db),
):
    row = (await db.execute(select(Regimen).where(Regimen.id == regimen_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")

    data = patch.model_dump(exclude_unset=True)
    if "kind" in data and data["kind"] is not None:
        _validate_kind(data["kind"])
    if "name" in data:
        if data["name"] is None or not str(data["name"]).strip():
            raise HTTPException(status_code=400, detail="name cannot be empty")
        data["name"] = data["name"].strip()

    # Nuovi end vs nuovi start coerenti (consideriamo i valori effettivi finali).
    new_start = data.get("start_date", row.start_date)
    new_end = data.get("end_date", row.end_date)
    if new_start is not None and new_end is not None and new_end < new_start:
        raise HTTPException(status_code=400, detail="end_date < start_date")

    for k, v in data.items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{regimen_id}")
async def delete_regimen(regimen_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(Regimen).where(Regimen.id == regimen_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="not found")
    await db.delete(row)
    await db.commit()
    return {"ok": True, "id": regimen_id}
