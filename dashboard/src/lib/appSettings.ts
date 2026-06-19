import { useCallback, useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPut } from "@/lib/api"

interface SettingResponse<T> {
  key: string
  value: T | null
}

/**
 * Hook generico per una preferenza dell'app persistita **lato server** nella
 * tabella key-value `app_settings` (condivisa tra dispositivi/browser, al
 * posto di localStorage). Ritorna:
 * - `value`: il valore corrente (o `fallback` mentre carica / se mai impostato)
 * - `rawValue`: il valore grezzo dal server (`null` se la chiave non esiste —
 *    utile per distinguere "mai impostato" da "impostato a un valore vuoto")
 * - `isLoaded`: true quando la GET e' andata a buon fine
 * - `set`: scrive il nuovo valore (PUT) con update ottimistico
 */
export function useAppSetting<T>(key: string, fallback: T) {
  const qc = useQueryClient()
  const queryKey = useMemo(() => ["appSetting", key], [key])

  const query = useQuery({
    queryKey,
    queryFn: () => apiGet<SettingResponse<T>>(`/api/v1/settings/${key}`),
    staleTime: 60_000,
  })

  const mutation = useMutation({
    mutationFn: (next: T) => apiPut(`/api/v1/settings/${key}`, { value: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  })

  const set = useCallback(
    (next: T) => {
      // Update ottimistico: lo stato locale riflette subito la scrittura.
      qc.setQueryData(queryKey, { key, value: next })
      mutation.mutate(next)
    },
    [key, queryKey, mutation, qc],
  )

  const rawValue = query.data?.value ?? null
  return {
    value: (rawValue ?? fallback) as T,
    rawValue: rawValue as T | null,
    isLoaded: query.isSuccess,
    set,
  }
}
