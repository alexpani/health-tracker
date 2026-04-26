"""Daily statistics router.

Espone i totali per giorno pre-calcolati da `HKStatisticsCollectionQuery`
lato iOS (una query aggregata di HealthKit che deduplica internamente
Apple Watch + iPhone — gli stessi numeri dei widget di Apple Salute).

Il flusso:
  iOS HKStatisticsCollectionQuery (per i 9 tipi cumulative) ->
  POST /api/v1/daily-stats/batch (upsert) ->
  Dashboard GET /api/v1/daily-stats?type=...&start=...&end=...

I sample raw restano in `health_samples` per workout splits, "Esplora",
correlazione body, ecc. — questa tabella e' additiva.
"""
from datetime import date as date_cls

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DailyStat
from app.schemas import (
    DailyStatOut,
    DailyStatsBatchIn,
    DailyStatsBatchResult,
)

router = APIRouter(prefix="/api/v1/daily-stats", tags=["daily_stats"])


@router.post("/batch", response_model=DailyStatsBatchResult)
async def upsert_daily_stats(
    payload: DailyStatsBatchIn,
    db: AsyncSession = Depends(get_db),
):
    """Upsert batch su (type, date, COALESCE(source, '_all_')).
    Sovrascrive `value` e aggiorna `updated_at`."""
    if not payload.items:
        return DailyStatsBatchResult(upserted=0)

    # Build VALUES list. asyncpg fa il binding di params NULL → SQL NULL,
    # quindi COALESCE(source, '_all_') riporta correttamente in conflitto.
    rows = [
        {
            "type": it.type,
            "date": it.date,
            "value": float(it.value),
            "source": it.source,
        }
        for it in payload.items
    ]

    # INSERT ... ON CONFLICT su unique index (type, date, COALESCE(source, '_all_')).
    # Usiamo UNNEST per fare il batch in una singola query (asyncpg-friendly).
    sql = text("""
        INSERT INTO daily_stats (type, date, value, source)
        SELECT * FROM UNNEST(
            CAST(:types  AS varchar[]),
            CAST(:dates  AS date[]),
            CAST(:values AS double precision[]),
            CAST(:sources AS varchar[])
        ) AS t(type, date, value, source)
        ON CONFLICT (type, date, (COALESCE(source, '_all_')))
        DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = now()
    """)

    await db.execute(
        sql,
        {
            "types":   [r["type"] for r in rows],
            "dates":   [r["date"] for r in rows],
            "values":  [r["value"] for r in rows],
            "sources": [r["source"] for r in rows],
        },
    )
    await db.commit()
    return DailyStatsBatchResult(upserted=len(rows))


@router.get("", response_model=list[DailyStatOut])
async def list_daily_stats(
    type: str,
    start: date_cls | None = Query(None),
    end: date_cls | None = Query(None),
    source: str | None = Query(None, description="Default: '_all_' (cross-source HK total)"),
    db: AsyncSession = Depends(get_db),
):
    """Range di totali giornalieri per un tipo. Default: solo source='_all_'
    (il totale aggregato cross-source che HealthKit espone — quello che
    appare nei widget di Apple Salute)."""
    stmt = select(DailyStat).where(DailyStat.type == type)
    if start:
        stmt = stmt.where(DailyStat.date >= start)
    if end:
        stmt = stmt.where(DailyStat.date <= end)
    if source is None:
        # Default: totale aggregato (NULL o "_all_")
        stmt = stmt.where(
            (DailyStat.source.is_(None)) | (DailyStat.source == "_all_")
        )
    else:
        stmt = stmt.where(DailyStat.source == source)
    stmt = stmt.order_by(DailyStat.date.asc())

    rows = (await db.execute(stmt)).scalars().all()
    return [
        DailyStatOut(date=r.date, value=r.value, source=r.source)
        for r in rows
    ]
