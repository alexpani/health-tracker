import uuid as uuid_mod
from datetime import date as date_cls, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Double, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class HealthSample(Base):
    __tablename__ = "health_samples"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[uuid_mod.UUID] = mapped_column(UUID(as_uuid=True), unique=True, nullable=False)
    type: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[float] = mapped_column(Double, nullable=False)
    unit: Mapped[str] = mapped_column(String(50), nullable=False)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(200))
    source_bundle_id: Mapped[str | None] = mapped_column(String(300))
    device: Mapped[str | None] = mapped_column(String(200))
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("idx_samples_type_start", "type", "start_date"),
        Index("idx_samples_start_date", "start_date"),
    )


class CategorySample(Base):
    __tablename__ = "category_samples"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[uuid_mod.UUID] = mapped_column(UUID(as_uuid=True), unique=True, nullable=False)
    type: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[int] = mapped_column(Integer, nullable=False)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(200))
    source_bundle_id: Mapped[str | None] = mapped_column(String(300))
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("idx_categories_type_start", "type", "start_date"),
        Index("idx_categories_start_date", "start_date"),
    )


class Workout(Base):
    __tablename__ = "workouts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    uuid: Mapped[uuid_mod.UUID] = mapped_column(UUID(as_uuid=True), unique=True, nullable=False)
    activity_type: Mapped[int] = mapped_column(Integer, nullable=False)
    activity_name: Mapped[str | None] = mapped_column(String(100))
    duration: Mapped[float | None] = mapped_column(Double)
    total_energy_burned: Mapped[float | None] = mapped_column(Double)
    total_distance: Mapped[float | None] = mapped_column(Double)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(200))
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB)
    title: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    activities_: Mapped[list | None] = mapped_column("activities", JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("idx_workouts_activity_start", "activity_type", "start_date"),
        Index("idx_workouts_start_date", "start_date"),
    )


class PendingWrite(Base):
    __tablename__ = "pending_writes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[float] = mapped_column(Double, nullable=False)
    unit: Mapped[str] = mapped_column(String(50), nullable=False)
    start_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    written_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hk_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(UUID(as_uuid=True))

    __table_args__ = (
        Index("idx_pending_writes_status_created", "status", "created_at"),
    )


class PendingDeletion(Base):
    __tablename__ = "pending_deletions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hk_uuid: Mapped[uuid_mod.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    type: Mapped[str] = mapped_column(String(100), nullable=False)
    source_sample_id: Mapped[int | None] = mapped_column(BigInteger)  # id in health_samples
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("idx_pending_deletions_status", "status"),
    )


class IngestRule(Base):
    """Configurable ingest rules. Replaces hardcoded SAMPLE_FILTERS/BLOCKED_SOURCES."""
    __tablename__ = "ingest_rules"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # 'value_range' = discard if value outside [value_min, value_max] for type_identifier
    # 'blocked_source' = discard if source_name matches (type_identifier optional for per-type)
    rule_type: Mapped[str] = mapped_column(String(30), nullable=False)
    type_identifier: Mapped[str | None] = mapped_column(String(100))
    source_name: Mapped[str | None] = mapped_column(String(200))
    value_min: Mapped[float | None] = mapped_column(Double)
    value_max: Mapped[float | None] = mapped_column(Double)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    hits_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_hit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (
        Index("idx_ingest_rules_active_type", "active", "type_identifier"),
    )


class IngestBlacklist(Base):
    """UUIDs that must never be inserted into health_samples.
    Used to prevent re-syncing of deleted/spurious samples from Apple Health."""
    __tablename__ = "ingest_blacklist"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    hk_uuid: Mapped[uuid_mod.UUID] = mapped_column(UUID(as_uuid=True), unique=True, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class SyncLog(Base):
    __tablename__ = "sync_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    device_id: Mapped[str | None] = mapped_column(String(100))
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class DiarioHkSync(Base):
    """Mapping of (diary day, dietary type) → HKSample UUID written via our
    pending-write queue. Used for idempotent diario-alimentare → Apple Health
    sync: when a day's total changes we delete+recreate; when unchanged we skip.
    """
    __tablename__ = "diario_hk_sync"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    date: Mapped[datetime] = mapped_column(Date, nullable=False)
    type: Mapped[str] = mapped_column(String(100), nullable=False)  # HKQuantityTypeIdentifier*
    value: Mapped[float] = mapped_column(Double, nullable=False)
    hk_uuid: Mapped[uuid_mod.UUID | None] = mapped_column(UUID(as_uuid=True))
    pending_write_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("pending_writes.id", ondelete="SET NULL")
    )
    posted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("date", "type", name="uq_diario_hk_sync_date_type"),
        Index("idx_diario_hk_sync_pending", "pending_write_id"),
    )


class DailyStat(Base):
    """Daily totals pre-calcolati da HKStatisticsCollectionQuery lato iOS.
    Una riga per (type, date, source). source='_all_' o NULL = totale
    cross-source che HealthKit deduplica internamente fra Watch e iPhone
    (questi sono i numeri che appaiono nei widget di Apple Salute)."""
    __tablename__ = "daily_stats"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(100), nullable=False)
    date: Mapped[datetime] = mapped_column(Date, nullable=False)
    value: Mapped[float] = mapped_column(Double, nullable=False)
    source: Mapped[str | None] = mapped_column(String(200))
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_daily_stats_type_date", "type", "date"),
    )


class Regimen(Base):
    """Periodi di farmaci, integratori, piani alimentari, piani di
    allenamento. Una riga per "ho preso/seguito X dal giorno A al giorno B".
    `start_date=NULL` = "iniziato prima del tracking / ignoto".
    `end_date=NULL`   = "in corso adesso".
    `source='manual'` per l'inserimento dall'UI, `'lab_backfill'` per gli
    import retroattivi dai campi context dei panel lab confermati.
    """
    __tablename__ = "regimens"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    start_date: Mapped[date_cls | None] = mapped_column(Date)
    end_date: Mapped[date_cls | None] = mapped_column(Date)
    dose: Mapped[str | None] = mapped_column(String(150))
    notes: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="manual", server_default="manual"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("idx_regimens_kind", "kind"),
        Index("idx_regimens_dates", "start_date", "end_date"),
    )


class WorkoutRoute(Base):
    """GPS route per workout outdoor. Una riga per workout. I punti sono
    persistiti come array JSONB di {lat, lon, alt, ts, hAcc, vAcc, speed, course}
    (campi opzionali). PK = workout_uuid (1 route per workout, idempotente).
    Sorgente: HKWorkoutRoute via HKWorkoutRouteQuery letto dall'app iOS;
    cancellato a cascata col workout."""
    __tablename__ = "workout_routes"

    workout_uuid: Mapped[uuid_mod.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workouts.uuid", ondelete="CASCADE"),
        primary_key=True,
    )
    points: Mapped[list] = mapped_column(JSONB, nullable=False)
    point_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


from . import lab  # noqa: E402, F401  — registra i modelli lab su Base.metadata
