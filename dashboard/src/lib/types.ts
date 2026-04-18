export interface Sample {
  id?: number
  uuid: string
  type: string
  value: number
  unit: string
  start_date: string
  end_date: string
  source_name: string | null
  device: string | null
}

export interface EffectiveTypeFacet {
  slug: string
  activity_type: number
  activity_name: string | null
  count: number
}

export interface WorkoutFacets {
  effective_types: EffectiveTypeFacet[]
  sources: string[]
  distance_min: number | null
  distance_max: number | null
}

export interface WorkoutFilters {
  start?: string
  end?: string
  effective_types?: string[]
  sources?: string[]
  distance_min?: number  // meters
  distance_max?: number  // meters
}

export interface WorkoutDetail {
  id: number
  uuid: string
  activity_type: number
  activity_name: string | null
  duration: number | null
  total_energy_burned: number | null
  total_distance: number | null
  start_date: string
  end_date: string
  source_name: string | null
  metadata: Record<string, unknown> | null
}

export interface WorkoutSplit {
  n: number
  distance_km: number
  duration_seconds: number
  pace_sec_per_km: number | null
  avg_heart_rate: number | null
  partial?: boolean
}

export interface WorkoutSplits {
  splits: WorkoutSplit[]
  total_distance_meters?: number
  note?: string
}

export interface SyncSession {
  started_at: string
  ended_at: string
  duration_seconds: number
  total_samples: number
  batches: number
  device_id: string | null
}

export interface IngestRule {
  id: number
  rule_type: "value_range" | "blocked_source"
  type_identifier: string | null
  source_name: string | null
  value_min: number | null
  value_max: number | null
  active: boolean
  reason: string | null
  hits_count: number
  last_hit_at: string | null
  created_at: string
}

export interface RulesSummary {
  rules_active: number
  rules_total: number
  blacklist_size: number
  total_hits: number
  recent_hits_7d: number
}

export interface BlacklistEntry {
  id: number
  hk_uuid: string
  reason: string | null
  created_at: string
}

export interface CorrelatedSample {
  id: number
  uuid: string
  type: string
  value: number
  unit: string
  start_date: string
  source_name: string | null
}

export interface AggregatedPoint {
  period_start: string
  avg: number
  min: number
  max: number
  count: number
}

export interface SamplesResponse {
  type: string
  unit: string | null
  aggregation: "none" | "hourly" | "daily" | "weekly" | "monthly"
  data: Sample[] | AggregatedPoint[]
  total_count: number
}

export interface CategorySample {
  uuid: string
  type: string
  value: number
  start_date: string
  end_date: string
  source_name: string | null
}

export interface Workout {
  uuid: string
  activity_type: number
  activity_name: string | null
  duration: number | null
  total_energy_burned: number | null
  total_distance: number | null
  start_date: string
  end_date: string
  source_name: string | null
  metadata: Record<string, unknown> | null
}

export interface TypeCount {
  type: string
  count: number
  latest: string | null
}

export interface SyncStatus {
  total_samples: number
  total_categories: number
  total_workouts: number
  types: TypeCount[]
  last_sync: string | null
}

export interface LatestSampleResponse {
  type: string
  data: {
    uuid: string
    value: number
    unit: string
    start_date: string
    end_date: string
    source_name: string | null
    device: string | null
  } | null
}

export type Aggregation = "none" | "hourly" | "daily" | "weekly" | "monthly"
export type TimeRange = "1d" | "7d" | "30d" | "90d" | "1y" | "all"

export interface PendingWrite {
  id: number
  type: string
  value: number
  unit: string
  start_date: string
  end_date: string
  source_name: string | null
  notes: string | null
  status: "pending" | "written" | "failed"
  error_message: string | null
  created_at: string
  written_at: string | null
  hk_uuid: string | null
}

export interface SampleFacets {
  sources: string[]
  devices: string[]
  value_min: number | null
  value_max: number | null
}

export interface AdvancedFilters {
  start?: string
  end?: string
  sources?: string[]
  devices?: string[]
  value_min?: number
  value_max?: number
}

export interface WriteInput {
  type: string
  value: number
  unit: string
  start_date: string
  end_date: string
  source_name?: string
  notes?: string
}
