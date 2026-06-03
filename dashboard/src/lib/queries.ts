import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from "./api"
import type {
  MedicalDoc,
  MedicalDocCategory,
  MedicalDocFilters,
  MedicalDocListResponse,
  MedicalDocSection,
  MedicalDocStatus,
} from "./types"
import type {
  Aggregation,
  BlacklistEntry,
  CategorySample,
  ClinicalFacets,
  ClinicalFilters,
  ClinicalRecord,
  ClinicalRecordDetail,
  CorrelatedSample,
  DailyStatPoint,
  DaySnapshot,
  DiarioDailyTotal,
  DiarioPlan,
  DiarioPlanSegment,
  HealthNote,
  HealthNoteCategory,
  HealthNoteFilters,
  JournalEntry,
  JournalFilters,
  LabAliasIn,
  LabAnalyte,
  LabConfirmResponse,
  LabCorrelationsResponse,
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
  Regimen,
  RegimenKind,
  RulesSummary,
  Sample,
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
  WorkoutRoute,
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
    refetchInterval: 30 * 60_000, // 30 min polling
    placeholderData: keepPreviousData,
  })
}

// --- Day snapshot ---

export function useDaySnapshot(date: string, enabled = true) {
  return useQuery({
    queryKey: ["daySnapshot", date],
    queryFn: () => apiGet<DaySnapshot>(`/api/v1/day/${date}`),
    enabled: enabled && !!date,
    staleTime: 30_000,
    refetchInterval: 30 * 60_000, // 30 min polling
    placeholderData: keepPreviousData,
  })
}

// --- Regimens ---

export interface RegimenInput {
  kind: RegimenKind
  name: string
  start_date?: string | null
  end_date?: string | null
  dose?: string | null
  notes?: string | null
}

export interface RegimensFilters {
  kind?: RegimenKind
  active_on?: string
  include_ended?: boolean
  source?: "manual" | "lab_backfill"
}

export function useRegimens(filters: RegimensFilters = {}) {
  return useQuery({
    queryKey: ["regimens", filters],
    queryFn: () =>
      apiGet<Regimen[]>("/api/v1/regimens", {
        kind: filters.kind,
        active_on: filters.active_on,
        include_ended: filters.include_ended === undefined ? undefined : (filters.include_ended ? "true" : "false"),
        source: filters.source,
      }),
    staleTime: 30_000,
  })
}

export function useCreateRegimen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RegimenInput) => apiPost<Regimen>("/api/v1/regimens", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["regimens"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
      qc.invalidateQueries({ queryKey: ["labCorrelations"] })
    },
  })
}

export function useUpdateRegimen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<RegimenInput> }) =>
      apiPatch<Regimen>(`/api/v1/regimens/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["regimens"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
      qc.invalidateQueries({ queryKey: ["labCorrelations"] })
    },
  })
}

export function useDeleteRegimen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => apiDelete<{ ok: boolean; id: number }>(`/api/v1/regimens/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["regimens"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
      qc.invalidateQueries({ queryKey: ["labCorrelations"] })
    },
  })
}

/** Hook per ottenere il piano alimentare (kind='diet') attivo in una data specifica.
 * Ritorna il primo regimen di tipo 'diet' attivo, oppure null.
 * Il metadata del regimen contiene: kcal_target?, protein_pct?, fat_pct?, carbs_pct?
 */
export function useActiveDietPlan(date?: string, enabled = true) {
  const regimens = useRegimens({ kind: "diet", active_on: date, include_ended: true })
  return {
    ...regimens,
    data: regimens.data?.[0] ?? null,
  }
}

// --- Health notes ---

interface HealthNoteInput {
  category: HealthNoteCategory
  body_zone?: string | null
  text: string
  start_date: string
  end_date?: string | null
}

export function useHealthNotes(filters: HealthNoteFilters = {}) {
  return useQuery({
    queryKey: ["healthNotes", filters],
    queryFn: () =>
      apiGet<HealthNote[]>("/api/v1/health-notes", {
        category: filters.category,
        body_zone: filters.body_zone,
        text_contains: filters.text_contains,
        start: filters.start,
        end: filters.end,
        active_on: filters.active_on,
      }),
    staleTime: 30_000,
  })
}

/** Lista di date ISO coperte da almeno una nota nel range [start, end].
 * Usato dal mini-calendario per disegnare i pallini. */
export function useHealthNoteDays(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ["healthNoteDays", start, end],
    queryFn: () => apiGet<string[]>("/api/v1/health-notes/days", { start, end }),
    enabled: enabled && !!start && !!end,
    staleTime: 60_000,
  })
}

export function useHealthNoteZones() {
  return useQuery({
    queryKey: ["healthNoteZones"],
    queryFn: () => apiGet<string[]>("/api/v1/health-notes/zones"),
    staleTime: 5 * 60_000,
  })
}

export function useCreateHealthNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: HealthNoteInput) => apiPost<HealthNote>("/api/v1/health-notes", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["healthNotes"] })
      qc.invalidateQueries({ queryKey: ["healthNoteDays"] })
      qc.invalidateQueries({ queryKey: ["healthNoteZones"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
      qc.invalidateQueries({ queryKey: ["labCorrelations"] })
    },
  })
}

export function useUpdateHealthNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<HealthNoteInput> }) =>
      apiPatch<HealthNote>(`/api/v1/health-notes/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["healthNotes"] })
      qc.invalidateQueries({ queryKey: ["healthNoteDays"] })
      qc.invalidateQueries({ queryKey: ["healthNoteZones"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
      qc.invalidateQueries({ queryKey: ["labCorrelations"] })
    },
  })
}

export function useDeleteHealthNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => apiDelete<{ ok: boolean; id: number }>(`/api/v1/health-notes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["healthNotes"] })
      qc.invalidateQueries({ queryKey: ["healthNoteDays"] })
      qc.invalidateQueries({ queryKey: ["healthNoteZones"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
      qc.invalidateQueries({ queryKey: ["labCorrelations"] })
    },
  })
}

// --- Journal entries (daily diary: rich text + tags) ---

export interface JournalCreateInput {
  date: string
  content_html: string
  tags?: string[]
}

export interface JournalUpdateInput {
  content_html?: string
  tags?: string[]
  date?: string  // editabile: sposta la nota a un altro giorno
}

/** Lista voci diario per una specifica data (puo' essere vuota). */
export function useJournalEntries(date: string, enabled = true) {
  return useQuery({
    queryKey: ["journalEntries", date],
    queryFn: () => apiGet<JournalEntry[]>(`/api/v1/journal/by-date/${date}`),
    enabled: enabled && !!date,
    staleTime: 30_000,
  })
}

export function useJournalDays(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ["journalDays", start, end],
    queryFn: () => apiGet<string[]>("/api/v1/journal/days", { start, end }),
    enabled: enabled && !!start && !!end,
    staleTime: 60_000,
  })
}

export function useJournalTags() {
  return useQuery({
    queryKey: ["journalTags"],
    queryFn: () => apiGet<string[]>("/api/v1/journal/tags"),
    staleTime: 5 * 60_000,
  })
}

export function useJournalList(filters: JournalFilters = {}) {
  return useQuery({
    queryKey: ["journalList", filters],
    queryFn: () =>
      apiGet<JournalEntry[]>("/api/v1/journal", {
        start: filters.start,
        end: filters.end,
        tag: filters.tag,
        text_contains: filters.text_contains,
        limit: filters.limit,
        offset: filters.offset,
      }),
    staleTime: 30_000,
  })
}

export function useCreateJournal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: JournalCreateInput) =>
      apiPost<JournalEntry>("/api/v1/journal", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journalEntries"] })
      qc.invalidateQueries({ queryKey: ["journalDays"] })
      qc.invalidateQueries({ queryKey: ["journalTags"] })
      qc.invalidateQueries({ queryKey: ["journalList"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
    },
  })
}

export function useUpdateJournal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: JournalUpdateInput }) =>
      apiPatch<JournalEntry>(`/api/v1/journal/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journalEntries"] })
      qc.invalidateQueries({ queryKey: ["journalDays"] })
      qc.invalidateQueries({ queryKey: ["journalTags"] })
      qc.invalidateQueries({ queryKey: ["journalList"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
    },
  })
}

export function useDeleteJournal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiDelete<{ ok: boolean; id: number }>(`/api/v1/journal/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journalEntries"] })
      qc.invalidateQueries({ queryKey: ["journalDays"] })
      qc.invalidateQueries({ queryKey: ["journalTags"] })
      qc.invalidateQueries({ queryKey: ["journalList"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
    },
  })
}

export type JournalBulkAction = "delete" | "add_tag" | "remove_tag"

export function useJournalBulk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { ids: number[]; action: JournalBulkAction; tag?: string }) =>
      apiPost<{ updated?: number; deleted?: number }>("/api/v1/journal/bulk", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journalEntries"] })
      qc.invalidateQueries({ queryKey: ["journalDays"] })
      qc.invalidateQueries({ queryKey: ["journalTags"] })
      qc.invalidateQueries({ queryKey: ["journalList"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
    },
  })
}

export function useRenameJournalTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { old: string; new: string | null }) =>
      apiPost<{ updated: number; old: string; new: string | null }>(
        "/api/v1/journal/tags/rename",
        input,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journalEntries"] })
      qc.invalidateQueries({ queryKey: ["journalDays"] })
      qc.invalidateQueries({ queryKey: ["journalTags"] })
      qc.invalidateQueries({ queryKey: ["journalList"] })
      qc.invalidateQueries({ queryKey: ["daySnapshot"] })
    },
  })
}

export function useDailyStats(type: string, start?: string, end?: string, enabled = true) {
  return useQuery({
    queryKey: ["dailyStats", type, start, end],
    queryFn: () => apiGet<DailyStatPoint[]>("/api/v1/daily-stats", { type, start, end }),
    enabled: enabled && !!type,
    staleTime: 60_000,
    refetchInterval: 30 * 60_000, // 30 min polling
    placeholderData: keepPreviousData,
  })
}

export function useLatest(type: string, enabled = true) {
  return useQuery({
    queryKey: ["latest", type],
    queryFn: () => apiGet<LatestSampleResponse>("/api/v1/samples/latest", { type }),
    enabled,
    staleTime: 30_000,
    refetchInterval: 30 * 60_000, // 30 min polling
  })
}

export function useSampleFacets(type: string, enabled = true) {
  return useQuery({
    queryKey: ["sampleFacets", type],
    queryFn: () => apiGet<SampleFacets>("/api/v1/samples/facets", { type }),
    enabled: enabled && !!type,
    staleTime: 5 * 60_000,
    refetchInterval: 30 * 60_000, // 30 min polling
  })
}

export function useTypes() {
  return useQuery({
    queryKey: ["types"],
    queryFn: () => apiGet<TypeCount[]>("/api/v1/samples/types"),
    staleTime: 300_000,
    refetchInterval: 30 * 60_000, // 30 min polling
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
    refetchInterval: 30 * 60_000, // 30 min polling
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
    refetchInterval: 30 * 60_000, // 30 min polling
  })
}

export function useWorkoutSplits(uuid: string | undefined, distanceKm = 1.0) {
  return useQuery({
    queryKey: ["workoutSplits", uuid, distanceKm],
    queryFn: () => apiGet<WorkoutSplits>(`/api/v1/workouts/by-uuid/${uuid}/splits`, { distance_km: distanceKm }),
    enabled: !!uuid,
    staleTime: 5 * 60_000,
    refetchInterval: 30 * 60_000, // 30 min polling
  })
}

/// GPS route per workout. Restituisce 404 finché l'app iOS non ha ingestito
/// il route per quel UUID — il componente WorkoutMap mostra il fallback
/// "in attesa di sync" in quel caso. Una volta ingestito (anche con
/// `points: []`, cioè "checked, no GPS"), il 404 sparisce.
export function useWorkoutRoute(uuid: string | undefined) {
  return useQuery({
    queryKey: ["workoutRoute", uuid],
    queryFn: async () => {
      try {
        return await apiGet<WorkoutRoute>(`/api/v1/workouts/by-uuid/${uuid}/route`)
      } catch (err: any) {
        // 404 = "not yet ingested" → null così la UI mostra il placeholder
        // "in attesa di sync" invece di un errore generico. apiGet alza
        // un Error col messaggio "API 404: ...".
        if (/^API 404/.test(String(err?.message ?? ""))) return null
        throw err
      }
    },
    enabled: !!uuid,
    staleTime: 5 * 60_000,
    refetchInterval: 30 * 60_000, // 30 min polling
    retry: false,
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
    refetchInterval: 30 * 60_000, // 30 min polling
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
    refetchInterval: 30 * 60_000, // 30 min polling
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
    refetchInterval: 30 * 60_000, // 30 min polling
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

export function useDiarioPlanHistory() {
  return useQuery({
    queryKey: ["diarioPlanHistory"],
    queryFn: () => apiGet<DiarioPlanSegment[]>("/api/v1/diario/plan-history"),
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

// Totali giornalieri "consolidati" = diario + sample HK dietary di sorgenti
// esterne (non scritti da noi). Usato dal calendario e dall'istogramma cosi'
// che mostrino lo stesso totale per ogni giorno (i giorni storici pre-diario
// hanno solo dati HK, es. Lifesum). Le query sottostanti sono identiche a
// quelle in DiarioSection → TanStack Query dedup.
const DIETARY_KCAL    = "HKQuantityTypeIdentifierDietaryEnergyConsumed"
const DIETARY_PROTEIN = "HKQuantityTypeIdentifierDietaryProtein"
const DIETARY_FAT     = "HKQuantityTypeIdentifierDietaryFatTotal"
const DIETARY_CARBS   = "HKQuantityTypeIdentifierDietaryCarbohydrates"
const DIARIO_OUR_SOURCE = "Health Tracker"

function todayLocalISO_(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/// Estensione di DiarioDailyTotal con la lista delle fonti che hanno
/// contribuito al totale di quel giorno (es. ["Diario alimentare", "Lifesum"]).
export interface ConsolidatedDayTotal extends DiarioDailyTotal {
  sources: string[]
}

const DIARIO_SOURCE_LABEL = "Diario alimentare"

export function useConsolidatedDailyTotals() {
  const { data: allDaily, isLoading: dailyLoading } = useDiarioDailyTotals("2010-01-01", todayLocalISO_())
  const hkKcal    = useSamples({ type: DIETARY_KCAL,    aggregation: "none", limit: 10000 })
  const hkProtein = useSamples({ type: DIETARY_PROTEIN, aggregation: "none", limit: 10000 })
  const hkFat     = useSamples({ type: DIETARY_FAT,     aggregation: "none", limit: 10000 })
  const hkCarbs   = useSamples({ type: DIETARY_CARBS,   aggregation: "none", limit: 10000 })

  const byDate = new Map<string, DiarioDailyTotal>()
  const sourcesByDate = new Map<string, Set<string>>()
  const addSource = (date: string, src: string) => {
    let set = sourcesByDate.get(date)
    if (!set) { set = new Set(); sourcesByDate.set(date, set) }
    set.add(src)
  }
  for (const d of (allDaily ?? [])) {
    byDate.set(d.date, { ...d })
    addSource(d.date, DIARIO_SOURCE_LABEL)
  }
  const accumulate = (
    samples: SamplesResponse | undefined,
    key: "kcal" | "protein_g" | "fat_g" | "carbs_g",
  ) => {
    if (!samples?.data) return
    // aggregation: "none" → array di Sample (non AggregatedPoint).
    for (const s of samples.data as Sample[]) {
      if ((s.source_name ?? "") === DIARIO_OUR_SOURCE) continue
      const d = new Date(s.start_date)
      const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      const existing = byDate.get(localDate)
      if (existing) {
        existing[key] = (existing[key] ?? 0) + s.value
      } else {
        byDate.set(localDate, {
          date: localDate,
          kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0,
          kcal_target: null,
          [key]: s.value,
        } as DiarioDailyTotal)
      }
      addSource(localDate, s.source_name || "Sconosciuta")
    }
  }
  accumulate(hkKcal.data, "kcal")
  accumulate(hkProtein.data, "protein_g")
  accumulate(hkFat.data, "fat_g")
  accumulate(hkCarbs.data, "carbs_g")

  const consolidated: ConsolidatedDayTotal[] = Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({
      ...d,
      sources: Array.from(sourcesByDate.get(d.date) ?? []).sort((a, b) => {
        // Diario alimentare sempre per primo, poi alfabetico.
        if (a === DIARIO_SOURCE_LABEL) return -1
        if (b === DIARIO_SOURCE_LABEL) return 1
        return a.localeCompare(b)
      }),
    }))
  const isLoading = dailyLoading || hkKcal.isLoading || hkProtein.isLoading || hkFat.isLoading || hkCarbs.isLoading
  return { data: consolidated, isLoading }
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
    refetchInterval: 30 * 60_000, // 30 min polling
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
      await qc.invalidateQueries({ queryKey: ["labCorrelations"] })
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
      await qc.invalidateQueries({ queryKey: ["labCorrelations"] })
    },
  })
}

export function useLabAddResult() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ panelId, raw_name }: { panelId: number; raw_name?: string }) =>
      apiPost<{ id: number; panel_id: number; raw_name: string }>(
        `/api/v1/lab/panels/${panelId}/results`,
        { raw_name: raw_name ?? "Nuovo risultato" }
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["labPanel"] })
      await qc.invalidateQueries({ queryKey: ["labPanels"] })
      await qc.invalidateQueries({ queryKey: ["labMatrix"] })
    },
  })
}

export interface LabPanelPatch {
  test_date?: string
  lab_name?: string | null
  notes?: string | null
  specimen_types?: string[] | null
  activity_text?: string | null
  medications_text?: string | null
  supplements_text?: string | null
  nutrition_text?: string | null
  diet_text?: string | null
  workout_text?: string | null
}

export function useLabPatchPanel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ panelId, patch }: { panelId: number; patch: LabPanelPatch }) =>
      apiPatch<{ ok: boolean; id: number }>(`/api/v1/lab/panels/${panelId}`, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["labPanel"] })
      await qc.invalidateQueries({ queryKey: ["labPanels"] })
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
      qc.invalidateQueries({ queryKey: ["labCorrelations"] })
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
    onSuccess: async () => {
      // Il backend fa backfill dell'analita sui result non mappati che
      // combaciano col nuovo alias, anche in panel confermati (con ricalcolo
      // out_of_range): invalidiamo anche panel/matrice/andamenti.
      await qc.invalidateQueries({ queryKey: ["labAnalytes"] })
      await qc.invalidateQueries({ queryKey: ["labPanel"] })
      await qc.invalidateQueries({ queryKey: ["labMatrix"] })
      await qc.invalidateQueries({ queryKey: ["labTimeseries"] })
      await qc.invalidateQueries({ queryKey: ["labRecentOor"] })
      await qc.invalidateQueries({ queryKey: ["labCorrelations"] })
    },
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
      await qc.invalidateQueries({ queryKey: ["labCorrelations"] })
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

export function useLabCorrelations(params?: { panel_id?: number; refresh?: boolean }) {
  const query: Record<string, string | number | undefined> = {
    panel_id: params?.panel_id,
    refresh: params?.refresh ? "true" : undefined,
  }
  return useQuery({
    queryKey: ["labCorrelations", params],
    queryFn: () =>
      apiGet<LabCorrelationsResponse>("/api/v1/lab/correlations", query),
    staleTime: 60_000,
    // Polla finché qualche annotazione IA è ancora in elaborazione, poi stop.
    refetchInterval: (query) => {
      const data = query.state.data as LabCorrelationsResponse | undefined
      const pending = data?.candidates?.some(
        c => c.annotation?.status === "pending"
      )
      return pending ? 5_000 : false
    },
  })
}

// ---------- HealthKit Clinical Records (FHIR) ----------

export function useClinicalRecords(filters: ClinicalFilters = {}, enabled = true) {
  return useQuery({
    queryKey: ["clinicalRecords", filters],
    queryFn: () =>
      apiGet<ClinicalRecord[]>("/api/v1/clinical", {
        category: filters.category,
        resource_type: filters.resource_type,
        source_name: filters.source_name,
        start: filters.start,
        end: filters.end,
        limit: filters.limit,
        offset: filters.offset,
      }),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 30 * 60_000, // 30 min — stesso ritmo degli altri "sync-driven"
  })
}

export function useClinicalRecord(id: number | null | undefined) {
  return useQuery({
    queryKey: ["clinicalRecord", id],
    queryFn: () => apiGet<ClinicalRecordDetail>(`/api/v1/clinical/${id}`),
    enabled: id != null,
  })
}

export function useClinicalFacets() {
  return useQuery({
    queryKey: ["clinicalFacets"],
    queryFn: () => apiGet<ClinicalFacets>("/api/v1/clinical/facets"),
    refetchInterval: 30 * 60_000,
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
    refetchInterval: 30 * 60_000, // 30 min polling
  })
}

// --- Medical Docs (Visite / Referti / Documentazione) ---

export function useMedicalDocs(section: MedicalDocSection, filters?: MedicalDocFilters) {
  return useQuery({
    queryKey: ["medicalDocs", section, filters],
    queryFn: () =>
      apiGet<MedicalDocListResponse>("/api/v1/medical-docs", {
        section,
        category_id: filters?.category_id ?? undefined,
        status: filters?.status ?? undefined,
        q: filters?.q?.trim() || undefined,
        start: filters?.start || undefined,
        end: filters?.end || undefined,
        limit: 500,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    // Se un documento ha l'analisi IA in corso, ricontrolla ogni 3s.
    refetchInterval: query =>
      query.state.data?.items.some(d => d.analysis_status === "pending")
        ? 3000
        : false,
  })
}

export function useMedicalDocCategories(section: MedicalDocSection) {
  return useQuery({
    queryKey: ["medicalDocCategories", section],
    queryFn: () =>
      apiGet<MedicalDocCategory[]>("/api/v1/medical-docs/categories", { section }),
    staleTime: 5 * 60_000,
  })
}

export function useMedicalDocIngest(section: MedicalDocSection) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) =>
      apiUpload<MedicalDoc>(`/api/v1/medical-docs/ingest?section=${section}`, file),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["medicalDocs", section] })
      await qc.invalidateQueries({ queryKey: ["medicalDocCategories", section] })
    },
  })
}

export interface MedicalDocPatch {
  title?: string | null
  doc_date?: string | null
  category_id?: number | null
  facility_name?: string | null
  doctor_name?: string | null
  notes?: string | null
  status?: MedicalDocStatus
}

export function useMedicalDocPatch(section: MedicalDocSection) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: MedicalDocPatch }) =>
      apiPatch<MedicalDoc>(`/api/v1/medical-docs/${id}`, patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["medicalDocs", section] })
      await qc.invalidateQueries({ queryKey: ["medicalDocCategories", section] })
    },
  })
}

export function useMedicalDocDelete(section: MedicalDocSection) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiDelete<{ ok: boolean }>(`/api/v1/medical-docs/${id}?delete_file=true`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["medicalDocs", section] })
      await qc.invalidateQueries({ queryKey: ["medicalDocCategories", section] })
    },
  })
}

export function useMedicalDocCategoryMutations(section: MedicalDocSection) {
  const qc = useQueryClient()
  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["medicalDocCategories", section] })
    await qc.invalidateQueries({ queryKey: ["medicalDocs", section] })
  }
  const create = useMutation({
    mutationFn: (name: string) =>
      apiPost<MedicalDocCategory>("/api/v1/medical-docs/categories", { section, name }),
    onSuccess: invalidate,
  })
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiPatch<MedicalDocCategory>(`/api/v1/medical-docs/categories/${id}`, { name }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: number) =>
      apiDelete<{ ok: boolean }>(`/api/v1/medical-docs/categories/${id}`),
    onSuccess: invalidate,
  })
  return { create, rename, remove }
}
