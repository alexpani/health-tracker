from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


# --- Ingest schemas (iOS -> Backend) ---


class SampleIn(BaseModel):
    uuid: UUID
    type: str
    value: float
    unit: str
    start_date: datetime
    end_date: datetime
    source_name: str | None = None
    source_bundle_id: str | None = None
    device: str | None = None
    metadata: dict | None = None


class SampleBatchIn(BaseModel):
    device_id: str | None = None
    samples: list[SampleIn] = Field(max_length=1000)


class CategorySampleIn(BaseModel):
    uuid: UUID
    type: str
    value: int
    start_date: datetime
    end_date: datetime
    source_name: str | None = None
    source_bundle_id: str | None = None
    metadata: dict | None = None


class CategoryBatchIn(BaseModel):
    device_id: str | None = None
    samples: list[CategorySampleIn] = Field(max_length=1000)


class WorkoutIn(BaseModel):
    uuid: UUID
    activity_type: int
    activity_name: str | None = None
    duration: float | None = None
    total_energy_burned: float | None = None
    total_distance: float | None = None
    start_date: datetime
    end_date: datetime
    source_name: str | None = None
    metadata: dict | None = None


class WorkoutBatchIn(BaseModel):
    device_id: str | None = None
    workouts: list[WorkoutIn] = Field(max_length=1000)


class BatchResult(BaseModel):
    inserted: int
    duplicates_skipped: int


# --- Query schemas (Web Apps -> Backend) ---


class SampleOut(BaseModel):
    id: int | None = None
    uuid: UUID
    type: str
    value: float
    unit: str
    start_date: datetime
    end_date: datetime
    source_name: str | None
    device: str | None

    model_config = {"from_attributes": True}


class AggregatedPoint(BaseModel):
    period_start: datetime
    avg: float
    min: float
    max: float
    count: int


class SamplesQueryResponse(BaseModel):
    type: str
    unit: str | None = None
    aggregation: str
    data: list[SampleOut] | list[AggregatedPoint]
    total_count: int


class CategorySampleOut(BaseModel):
    uuid: UUID
    type: str
    value: int
    start_date: datetime
    end_date: datetime
    source_name: str | None

    model_config = {"from_attributes": True}


class WorkoutOut(BaseModel):
    uuid: UUID
    activity_type: int
    activity_name: str | None
    duration: float | None
    total_energy_burned: float | None
    total_distance: float | None
    start_date: datetime
    end_date: datetime
    source_name: str | None

    model_config = {"from_attributes": True}


class TypeCount(BaseModel):
    type: str
    count: int
    latest: datetime | None = None


class SyncStatus(BaseModel):
    total_samples: int
    total_categories: int
    total_workouts: int
    types: list[TypeCount]
    last_sync: datetime | None = None


# --- Write to Apple Health ---


class WriteIn(BaseModel):
    type: str
    value: float
    unit: str
    start_date: datetime
    end_date: datetime
    source_name: str | None = "Web Dashboard"
    notes: str | None = None


class PendingWriteOut(BaseModel):
    id: int
    type: str
    value: float
    unit: str
    start_date: datetime
    end_date: datetime
    source_name: str | None
    notes: str | None
    status: str
    error_message: str | None
    created_at: datetime
    written_at: datetime | None
    hk_uuid: UUID | None

    model_config = {"from_attributes": True}


class ConfirmIn(BaseModel):
    hk_uuid: UUID


class FailIn(BaseModel):
    error: str


# --- Deletions ---


class DeletionPlanIn(BaseModel):
    """Plan to delete samples matching criteria.

    At least one filter must be provided.
    """
    types: list[str]
    source_name: str | None = None
    value_min: float | None = None
    value_max: float | None = None
    start_after: datetime | None = None
    start_before: datetime | None = None
    also_correlated_at_same_instant: bool = False
    correlated_types: list[str] = Field(default_factory=list)


class DeletionPlanOut(BaseModel):
    total: int
    by_type: dict[str, int]


class PendingDeletionOut(BaseModel):
    id: int
    hk_uuid: UUID
    type: str
    source_sample_id: int | None
    status: str
    error_message: str | None
    created_at: datetime
    deleted_at: datetime | None

    model_config = {"from_attributes": True}
