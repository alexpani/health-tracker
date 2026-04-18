import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiDelete, apiGet, apiPatch, apiPost } from "./api"
import type {
  Aggregation,
  BlacklistEntry,
  CategorySample,
  CorrelatedSample,
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
    staleTime: 60_000,
  })
}

export function useLatest(type: string, enabled = true) {
  return useQuery({
    queryKey: ["latest", type],
    queryFn: () => apiGet<LatestSampleResponse>("/api/v1/samples/latest", { type }),
    enabled,
    staleTime: 60_000,
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

export function useWorkouts(activityType?: number, start?: string, end?: string) {
  return useQuery({
    queryKey: ["workouts", activityType, start, end],
    queryFn: () =>
      apiGet<Workout[]>("/api/v1/workouts", {
        activity_type: activityType,
        start,
        end,
        limit: 1000,
      }),
    staleTime: 60_000,
  })
}
