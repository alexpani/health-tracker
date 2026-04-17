import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPost } from "./api"
import type {
  Aggregation,
  CategorySample,
  LatestSampleResponse,
  PendingWrite,
  SamplesResponse,
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

export function useTypes() {
  return useQuery({
    queryKey: ["types"],
    queryFn: () => apiGet<TypeCount[]>("/api/v1/samples/types"),
    staleTime: 300_000,
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
