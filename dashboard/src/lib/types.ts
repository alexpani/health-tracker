export interface Sample {
  uuid: string
  type: string
  value: number
  unit: string
  start_date: string
  end_date: string
  source_name: string | null
  device: string | null
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

export interface WriteInput {
  type: string
  value: number
  unit: string
  start_date: string
  end_date: string
  source_name?: string
  notes?: string
}
