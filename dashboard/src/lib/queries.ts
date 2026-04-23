import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from "./api"
import type {
  Aggregation,
  BlacklistEntry,
  CategorySample,
  CorrelatedSample,
  DiarioDailyTotal,
  DiarioPlan,
  LabAliasIn,
  LabAnalyte,
  LabConfirmResponse,
  LabIngestResponse,
  LabMatrixResponse,
  LabPanelDetail,
  LabPanelListResponse,
  LabRecentOutOfRange,
  LabResultPatch,
  LabTimeseriesResponse,
  StretchingRoutine,
  StretchingSession,
  IngestRule,
  LatestSampleResponse,
  PendingWrite,
  RulesSummary,
  SampleFacets,
  SamplesResponse,
  SyncSession,
  SyncStatus,
  TypeCount,
  Workout,
  WorkoutDetail,
  WorkoutFacets,
  WorkoutFilters,
  WorkoutRecords,
  WorkoutRecordsFacets,
  WorkoutSplits,
  WriteInput,
} from "./types"

export interface SamplesQuery {
  type: string
  start?: string
  end?: string
  aggregation?: Aggregation
  limit?: number
  offset?: number
  sources?: string[]
  devices?: string[]
  value_min?: number
  value_max?: number
}

export function useSamples(opts: SamplesQuery, enabled = true) {
  return useQuery({
    queryKey: ["samples", opts],
    queryFn: () => apiGet<SamplesResponse>("/api/v1/samples", opts as any),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  })
}

export function useLatest(type: string, enabled = true) {
  return useQuery({
    queryKey: ["latest", type],
    queryFn: () => apiGet<LatestSampleResponse>("/api/v1/samples/latest", { type }),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useSampleFacets(type: string, enabled = true) {
  return useQuery({
    queryKey: ["sampleFacets", type],
    queryFn: () => apiGet<SampleFacets>("/api/v1/samples/facets", { type }),
    enabled: enabled && !!type,
    staleTime: 5 * 60_000,
  })
}

export function useTypes() {
  return useQuery({
    queryKey: ["types"],
    queryFn: () => apiGet<TypeCount[]>("/api/v1/samples/types"),
    staleTime: 300_000,
  })
}

export function useSyncSessions(limit = 10) {
  return useQuery({
    queryKey: ["syncSessions", limit],
    queryFn: () => apiGet<SyncSession[]>("/api/v1/sync/sessions", { limit }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useSyncStatus(includeTypes = true) {
  return useQuery({
    queryKey: ["syncStatus", includeTypes],
    queryFn: () => apiGet<SyncStatus>("/api/v1/sync/status", { include_types: includeTypes ? "true" : "false" }),
    staleTime: 30_000,
    // No aggressive polling - dashboard can refresh manually
    refetchInterval: 60_000,
  })
}

export function useCategories(type: string, start?: string, end?: string, enabled = true) {
  return useQuery({
    queryKey: ["categories", type, start, end],
    queryFn: () =>
      apiGet<CategorySample[]>("/api/v1/categories", {
        type,
        start,
        end,
        limit: 1000,
      }),
    enabled,
    staleTime: 60_000,
  })
}

export async function fetchCorrelated(sampleId: number, types: string[], minutes = 5): Promise<CorrelatedSample[]> {
  return apiGet<CorrelatedSample[]>(`/api/v1/samples/${sampleId}/correlated`, {
    types,
    minutes,
  })
}

export function useBulkDeleteSamples() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => apiPost<{ deleted: number }>("/api/v1/samples/bulk-delete", { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["samples"] })
      qc.invalidateQueries({ queryKey: ["sampleFacets"] })
    },
  })
}

// --- Rules / Settings ---

export function useRules() {
  return useQuery({
    queryKey: ["rules"],
    queryFn: () => apiGet<IngestRule[]>("/api/v1/rules"),
    refetchInterval: 30_000,
  })
}

export function useRulesSummary() {
  return useQuery({
    queryKey: ["rulesSummary"],
    queryFn: () => apiGet<RulesSummary>("/api/v1/rules/summary"),
    refetchInterval: 30_000,
  })
}

export function useCreateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<IngestRule>) => apiPost<IngestRule>("/api/v1/rules", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] })
      qc.invalidateQueries({ queryKey: ["rulesSummary"] })
    },
  })
}

export function useUpdateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<IngestRule> }) =>
      apiPatch<IngestRule>(`/api/v1/rules/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  })
}

export function useDeleteRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => apiDelete<{ deleted: boolean }>(`/api/v1/rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rules"] })
      qc.invalidateQueries({ queryKey: ["rulesSummary"] })
    },
  })
}

export function useResetRuleStats() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => apiPost<IngestRule>(`/api/v1/rules/${id}/reset-stats`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
  })
}

export function useBlacklist() {
  return useQuery({
    queryKey: ["blacklist"],
    queryFn: () => apiGet<BlacklistEntry[]>("/api/v1/blacklist", { limit: 500 }),
    refetchInterval: 60_000,
  })
}

export function useRemoveBlacklist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => apiDelete<{ removed: boolean }>(`/api/v1/blacklist/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blacklist"] })
      qc.invalidateQueries({ queryKey: ["rulesSummary"] })
    },
  })
}

export function useAllowedWriteTypes() {
  return useQuery({
    queryKey: ["allowedWriteTypes"],
    queryFn: () => apiGet<Record<string, string[]>>("/api/v1/write/allowed-types"),
    staleTime: Infinity,
  })
}

export function useRecentWrites(limit = 50) {
  return useQuery({
    queryKey: ["recentWrites", limit],
    queryFn: () => apiGet<PendingWrite[]>("/api/v1/write/recent", { limit }),
    refetchInterval: 15_000,
  })
}

export function useCreateWrite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: WriteInput) => apiPost<PendingWrite>("/api/v1/write", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recentWrites"] })
    },
  })
}

export function useWorkoutByUuid(uuid: string | undefined) {
  return useQuery({
    queryKey: ["workout", uuid],
    queryFn: () => apiGet<WorkoutDetail>(`/api/v1/workouts/by-uuid/${uuid}`),
    enabled: !!uuid,
    staleTime: 5 * 60_000,
  })
}

export function useWorkoutSplits(uuid: string | undefined, distanceKm = 1.0) {
  return useQuery({
    queryKey: ["workoutSplits", uuid, distanceKm],
    queryFn: () => apiGet<WorkoutSplits>(`/api/v1/workouts/by-uuid/${uuid}/splits`, { distance_km: distanceKm }),
    enabled: !!uuid,
    staleTime: 5 * 60_000,
  })
}

export function useWorkouts(filters: WorkoutFilters = {}) {
  return useQuery({
    queryKey: ["workouts", filters],
    queryFn: () =>
      apiGet<Workout[]>("/api/v1/workouts", {
        start: filters.start,
        end: filters.end,
        years: filters.years as any,
        effective_types: filters.effective_types,
        sources: filters.sources,
        distance_min: filters.distance_min,
        distance_max: filters.distance_max,
        duration_min: filters.duration_min,
        duration_max: filters.duration_max,
        pace_min: filters.pace_min,
        pace_max: filters.pace_max,
        notes_contains: filters.notes_contains,
        title_contains: filters.title_contains,
        limit: 10000,
      }),
    staleTime: 60_000,
  })
}

export function useWorkoutFacets(filters: WorkoutFilters = {}) {
  return useQuery({
    queryKey: ["workoutFacets", filters],
    queryFn: () =>
      apiGet<WorkoutFacets>("/api/v1/workouts/facets", {
        start: filters.start,
        end: filters.end,
        years: filters.years as any,
        effective_types: filters.effective_types,
        sources: filters.sources,
        distance_min: filters.distance_min,
        distance_max: filters.distance_max,
        duration_min: filters.duration_min,
        duration_max: filters.duration_max,
        pace_min: filters.pace_min,
        pace_max: filters.pace_max,
        notes_contains: filters.notes_contains,
        title_contains: filters.title_contains,
      }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}

export function useWorkoutRecords(filters: { years?: number[]; sources?: string[]; indoor?: boolean } = {}) {
  return useQuery({
    queryKey: ["workoutRecords", filters],
    queryFn: () => apiGet<WorkoutRecords>("/api/v1/workouts/records", {
      years: filters.years as any,
      sources: filters.sources,
      indoor: filters.indoor !== undefined ? (filters.indoor ? "true" : "false") : undefined,
    }),
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  })
}

// --- Diario Alimentare (proxied) ---

export function useDiarioActivePlan() {
  return useQuery({
    queryKey: ["diarioPlan"],
    queryFn: () => apiGet<DiarioPlan>("/api/v1/diario/active-plan"),
    staleTime: 5 * 60_000,
    retry: 0,
  })
}

export function useDiarioDailyTotals(from: string, to: string) {
  return useQuery({
    queryKey: ["diarioDaily", from, to],
    queryFn: () => apiGet<DiarioDailyTotal[]>("/api/v1/diario/daily-totals", { from, to }),
    staleTime: 60_000,
  })
}

export interface DiarioSyncResult {
  queued_writes: number
  queued_deletions: number
  unchanged: number
  days_considered: number
}

export function useDiarioSyncToHK() {
  return useMutation({
    mutationFn: () => apiPost<DiarioSyncResult>("/api/v1/diario/sync-to-hk", {}),
  })
}

export function useStretchingSessions(from: string, to: string) {
  return useQuery({
    queryKey: ["stretchingSessions", from, to],
    queryFn: () => apiGet<StretchingSession[]>("/api/v1/stretching/sessions", { from, to }),
    staleTime: 30_000,
  })
}

export function useStretchingRoutines() {
  return useQuery({
    queryKey: ["stretchingRoutines"],
    queryFn: () => apiGet<StretchingRoutine[]>("/api/v1/stretching/routines"),
    staleTime: 5 * 60_000,
  })
}

export function useWorkoutRecordsFacets() {
  return useQuery({
    queryKey: ["workoutRecordsFacets"],
    queryFn: () => apiGet<WorkoutRecordsFacets>("/api/v1/workouts/records/facets"),
    staleTime: 10 * 60_000,
  })
}

export function useUpdateWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ uuid, patch }: { uuid: string; patch: { title?: string; notes?: string } }) =>
      apiPatch<{ uuid: string; title: string | null; notes: string | null }>(`/api/v1/workouts/by-uuid/${uuid}`, patch),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["workout", vars.uuid] })
      qc.invalidateQueries({ queryKey: ["workouts"] })
    },
  })
}

export function useDeleteWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (uuid: string) =>
      apiDelete<{ deleted: boolean; snapshot: Record<string, unknown> }>(`/api/v1/workouts/by-uuid/${uuid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workouts"] }),
  })
}

export function useRestoreWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snapshot: Record<string, unknown>) =>
      apiPost<{ inserted: number; duplicates_skipped: number }>("/api/v1/workouts/batch", {
        device_id: "dashboard-restore",
        workouts: [snapshot],
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workouts"] }),
  })
}

// --- Lab Results ---

export function useLabPanels(params?: {
  status?: "draft" | "confirmed"
  year?: number
  specimen?: "blood" | "urine"
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: ["labPanels", params],
    queryFn: () => apiGet<LabPanelListResponse>("/api/v1/lab/panels", params ?? {}),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

export function useLabPanel(panelId: number | null | undefined) {
  return useQuery({
    queryKey: ["labPanel", panelId],
    queryFn: () => apiGet<LabPanelDetail>(`/api/v1/lab/panels/${panelId}`),
    enabled: panelId != null,
    staleTime: 0,
  })
}

export function useLabAnalytes() {
  return useQuery({
    queryKey: ["labAnalytes"],
    queryFn: () => apiGet<LabAnalyte[]>("/api/v1/lab/analytes"),
    staleTime: 5 * 60_000,
  })
}

export function useLabIngest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => apiUpload<LabIngestResponse>("/api/v1/lab/ingest", file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["labPanels"] }),
  })
}

export function useLabPatchResult() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ resultId, patch }: { resultId: number; patch: LabResultPatch }) =>
      apiPatch<{ ok: boolean; id: number }>(`/api/v1/lab/results/${resultId}`, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["labPanel"] })
      await qc.invalidateQueries({ queryKey: ["labMatrix"] })
      await qc.invalidateQueries({ queryKey: ["labTimeseries"] })
      await qc.invalidateQueries({ queryKey: ["labRecentOor"] })
    },
  })
}

export function useLabDeleteResult() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (resultId: number) =>
      apiDelete<{ ok: boolean }>(`/api/v1/lab/results/${resultId}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["labPanel"] })
      await qc.invalidateQueries({ queryKey: ["labMatrix"] })
      await qc.invalidateQueries({ queryKey: ["labTimeseries"] })
      await qc.invalidateQueries({ queryKey: ["labRecentOor"] })
    },
  })
}

export function useLabConfirmPanel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (panelId: number) =>
      apiPost<LabConfirmResponse>(`/api/v1/lab/panels/${panelId}/confirm`, {}),
    onSuccess: (_data, panelId) => {
      qc.invalidateQueries({ queryKey: ["labPanel", panelId] })
      qc.invalidateQueries({ queryKey: ["labPanels"] })
    },
  })
}

export function useLabDeletePanel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (panelId: number) =>
      apiDelete<{ ok: boolean }>(`/api/v1/lab/panels/${panelId}?delete_document=true`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["labPanels"] }),
  })
}

export function useLabCreateAlias() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LabAliasIn) =>
      apiPost<{ id: number; analyte_id: number; alias: string }>("/api/v1/lab/aliases", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["labAnalytes"] }),
  })
}

export interface LabAnalyteCreate {
  slug: string
  display_name_it: string
  category: string
  specimen?: "blood" | "urine" | "other"
  value_type?: "numeric" | "semi_quantitative" | "qualitative" | "textual"
  unit_canonical?: string | null
  ref_low?: number | null
  ref_high?: number | null
  ref_text?: string | null
  aliases?: string[]
}

export function useLabCreateAnalyte() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: LabAnalyteCreate) =>
      apiPost<{
        id: number
        slug: string
        aliases_created: number
        aliases_skipped: number
        results_backfilled?: number
      }>("/api/v1/lab/analytes", body),
    onSuccess: async () => {
      // Il backend fa backfill automatico sui result col raw_name combaciante:
      // invalidiamo catalog, panels (per le righe mappate) e viste derivate.
      await qc.invalidateQueries({ queryKey: ["labAnalytes"] })
      await qc.invalidateQueries({ queryKey: ["labPanel"] })
      await qc.invalidateQueries({ queryKey: ["labPanels"] })
      await qc.invalidateQueries({ queryKey: ["labMatrix"] })
      await qc.invalidateQueries({ queryKey: ["labTimeseries"] })
      await qc.invalidateQueries({ queryKey: ["labRecentOor"] })
    },
  })
}

export function useLabMatrix(params?: {
  start?: string
  end?: string
  specimen?: "blood" | "urine"
  category?: string
}) {
  return useQuery({
    queryKey: ["labMatrix", params],
    queryFn: () => apiGet<LabMatrixResponse>("/api/v1/lab/matrix", params ?? {}),
    staleTime: 60_000,
  })
}

export function useLabTimeseries(
  analyteSlug: string | null | undefined,
  opts?: { start?: string; end?: string }
) {
  return useQuery({
    queryKey: ["labTimeseries", analyteSlug, opts],
    queryFn: () =>
      apiGet<LabTimeseriesResponse>("/api/v1/lab/timeseries", {
        analyte_slug: analyteSlug ?? "",
        ...(opts ?? {}),
      }),
    enabled: !!analyteSlug,
  })
}

export function useLabRecentOutOfRange(limit = 10) {
  return useQuery({
    queryKey: ["labRecentOor", limit],
    queryFn: () => apiGet<LabRecentOutOfRange[]>("/api/v1/lab/recent-out-of-range", { limit }),
    staleTime: 60_000,
  })
}

export function useLatestWeightBefore(
  testDate: string | null | undefined,
  windowDays = 3
) {
  return useQuery({
    queryKey: ["latestWeight", testDate, windowDays],
    queryFn: () =>
      apiGet<{ type: string; data: { value: number; unit: string; start_date: string } | null }>(
        "/api/v1/samples/latest",
        {
          type: "HKQuantityTypeIdentifierBodyMass",
          before: testDate ? `${testDate}T23:59:59Z` : undefined,
          window_days: windowDays,
        }
      ),
    enabled: !!testDate,
  })
}
