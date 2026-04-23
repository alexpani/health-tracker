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
  years: { year: number; count: number }[]
  distance_min: number | null
  distance_max: number | null
  duration_min: number | null
  duration_max: number | null
}

export interface RecordEntry {
  uuid: string
  start_date: string
  total_distance: number | null
  duration: number | null
  total_energy_burned?: number | null
  pace_s_per_km?: number | null
}

export interface AtDistanceRecord extends RecordEntry {
  target_km: number
}

export interface BestSingleKm {
  uuid: string
  start_date: string
  n: number
  pace_s_per_km: number
  avg_heart_rate: number | null
}

export interface EffectiveTypeRecords {
  effective_type: string
  activity_type: number
  activity_name: string | null
  count: number
  overall: {
    longest_distance: RecordEntry | null
    longest_duration: RecordEntry | null
    fastest_pace: RecordEntry | null
    most_calories: RecordEntry | null
  }
  at_distance: AtDistanceRecord[]
  best_single_km: BestSingleKm | null
}

export interface WorkoutRecords {
  by_effective_type: EffectiveTypeRecords[]
}

export interface WorkoutRecordsFacets {
  years: { year: number; count: number }[]
  sources: { name: string; count: number }[]
  indoor_count: number
  outdoor_count: number
}

export interface RecordsFilters {
  years?: number[]
  sources?: string[]
  indoor?: boolean
}

export interface WorkoutFilters {
  start?: string
  end?: string
  years?: number[]
  effective_types?: string[]
  sources?: string[]
  distance_min?: number     // meters
  distance_max?: number     // meters
  duration_min?: number     // seconds
  duration_max?: number     // seconds
  pace_min?: number         // seconds per km
  pace_max?: number         // seconds per km
  notes_contains?: string
  title_contains?: string
}

export interface WorkoutActivity {
  n: number
  kind: "work" | "rest" | "lap" | "segment" | "pause"
  name: string | null
  activity_type: number | null  // HKWorkoutActivityType.rawValue of the sub-activity
  activity_name: string | null  // display name, e.g. "Running", "Walking"
  start: string
  end: string
  duration_s: number
  distance_m: number | null
  avg_hr: number | null
  max_hr: number | null
  kcal: number | null
  pace_s_per_km: number | null
  metadata: Record<string, string> | null
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
  title: string | null
  notes: string | null
  activities: WorkoutActivity[] | null
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
  title: string | null
  notes: string | null
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
  years: { year: number; count: number }[]
}

export interface AdvancedFilters {
  start?: string
  end?: string
  sources?: string[]
  devices?: string[]
  value_min?: number
  value_max?: number
}

export interface DiarioPlan {
  name: string
  kcal_target: number
  protein_pct: number
  fat_pct: number
  carbs_pct: number
  protein_g: number
  fat_g: number
  carbs_g: number
  updated_at: string | null
}

export interface DiarioDailyTotal {
  date: string
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  kcal_target: number | null
}

export interface StretchingSession {
  id: number | string
  routine_id: number | string | null
  routine_name: string
  started_at: string       // ISO UTC
  ended_at: string         // ISO UTC
  duration_sec: number
  items_total: number
  items_skipped: number
  notes: string | null
  workout_activity_type: "flexibility"
}

export interface StretchingRoutine {
  id: number | string
  name: string
  description: string | null
  items_total: number
  duration_sec: number
}

export interface NutritionFilters {
  start?: string  // ISO date or datetime
  end?: string
  years?: number[]
  kcal_min?: number
  kcal_max?: number
  adherence?: "under" | "on_target" | "over"  // ±10% tolerance for on_target
}

export interface BodyFilters {
  start?: string
  end?: string
  types?: string[]
  sources?: string[]
  aggregation?: Aggregation
  years?: number[]
  weight_min?: number
  weight_max?: number
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

// --- Lab Results ---

export type LabSpecimen = "blood" | "urine" | "other"
export type LabValueType = "numeric" | "semi_quantitative" | "qualitative" | "textual"
export type LabPanelStatus = "draft" | "confirmed"

export interface LabAnalyte {
  id: number
  slug: string
  display_name_it: string
  category: string
  specimen: LabSpecimen
  value_type: LabValueType
  unit_canonical: string | null
  ref_low: number | null
  ref_high: number | null
  ref_text: string | null
  aliases?: string[]
}

export interface LabPanelSummary {
  id: number
  test_date: string
  lab_name: string | null
  specimen_types: string[]
  status: LabPanelStatus
  notes: string | null
  document_id: number | null
  confirmed_at: string | null
  results_count: number
  unmapped_count: number
}

export interface LabPanelListResponse {
  total: number
  offset: number
  limit: number
  items: LabPanelSummary[]
}

export interface LabResult {
  id: number
  analyte_id: number | null
  raw_name: string
  value_numeric: number | null
  value_text: string | null
  unit_raw: string | null
  unit_normalized: string | null
  ref_low_raw: number | null
  ref_high_raw: number | null
  ref_text_raw: string | null
  out_of_range: boolean | null
  needs_review: boolean
  notes: string | null
}

export interface LabBodyHkSample {
  value: number
  unit: string
  start_date: string
}

export interface LabBodySnapshot {
  weight: LabBodyHkSample | null
  body_fat: LabBodyHkSample | null
  bmi: LabBodyHkSample | null
}

export interface LabPanelDetail extends LabPanelSummary {
  activity_text: string | null
  medications_text: string | null
  supplements_text: string | null
  nutrition_text: string | null
  diet_text: string | null
  workout_text: string | null
  body_snapshot?: LabBodySnapshot
  results: LabResult[]
}

export interface LabIngestResponse {
  panel_id: number
  status: LabPanelStatus
  test_date: string | null
  lab_name: string | null
  specimen_types: string[]
  analytes_count: number
  unmatched_count: number
  parsing_failed: boolean
  document_id: number | null
  deduplicated?: boolean
  message?: string
}

export interface LabConfirmResponse {
  panel_id: number
  status: LabPanelStatus
  confirmed_at: string
  results_count: number
  out_of_range_count: number
  still_needs_review: number
  unmapped_count: number
}

export interface LabResultPatch {
  analyte_id?: number | null
  value_numeric?: number | null
  value_text?: string | null
  unit_raw?: string | null
  notes?: string | null
}

export interface LabAliasIn {
  analyte_id: number
  alias: string
}

export interface LabMatrixCell {
  value_numeric: number | null
  value_text: string | null
  unit: string | null
  out_of_range: boolean | null
  needs_review: boolean
}

export interface LabMatrixPanel {
  id: number
  test_date: string
  lab_name: string | null
}

export interface LabMatrixResponse {
  analytes: LabAnalyte[]
  panels: LabMatrixPanel[]
  // Keys are stringified ids (JSON object).
  cells: Record<string, Record<string, LabMatrixCell>>
  // Ultimo peso corporeo noto alla data di ciascun panel (HK BodyMass).
  // Chiave: panel_id stringificato.
  panel_weights?: Record<string, LabMatrixCell>
}

export interface LabTimeseriesPoint {
  panel_id: number
  test_date: string
  value_numeric: number | null
  value_text: string | null
  unit: string | null
  out_of_range: boolean | null
}

export interface LabTimeseriesResponse {
  analyte: LabAnalyte
  points: LabTimeseriesPoint[]
}

export interface LabRecentOutOfRange {
  result_id: number
  panel_id: number
  test_date: string
  analyte_slug: string | null
  display_name: string
  raw_name: string
  value_numeric: number | null
  value_text: string | null
  unit: string | null
  ref_low: number | null
  ref_high: number | null
}
