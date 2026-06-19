import { useCallback } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiGet, apiPut } from "@/lib/api"

/** Impostazioni del promemoria regimi in home (pagina di oggi). Persistite
 * **lato server** (tabella `app_settings`, chiave `regimen_reminders`) cosi'
 * sono condivise tra dispositivi/browser. Orizzonti separati inizio/fine. */
export interface RegimenReminderSettings {
  /** Giorni di anticipo per i regimi che stanno per cominciare (1–30). */
  startDays: number
  /** Giorni di anticipo per i regimi che stanno per finire (1–30). */
  endDays: number
}

const SETTING_KEY = "regimen_reminders"
const QUERY_KEY = ["appSetting", SETTING_KEY]
const DEFAULTS: RegimenReminderSettings = { startDays: 7, endDays: 7 }

export const REMINDER_MIN_DAYS = 1
export const REMINDER_MAX_DAYS = 30

function clampDays(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return DEFAULTS.startDays
  return Math.min(REMINDER_MAX_DAYS, Math.max(REMINDER_MIN_DAYS, v))
}

function normalize(value: unknown): RegimenReminderSettings {
  const p = (value ?? {}) as Partial<RegimenReminderSettings>
  return {
    startDays: clampDays(p.startDays ?? DEFAULTS.startDays),
    endDays: clampDays(p.endDays ?? DEFAULTS.endDays),
  }
}

/**
 * Hook reattivo: ritorna `[settings, update]`. Le impostazioni sono lette dal
 * backend (con default mentre carica) e l'updater fa un PUT + invalidazione,
 * cosi' tutte le istanze montate si aggiornano. Cross-dispositivo: ogni
 * browser legge gli stessi valori dal server.
 */
export function useRegimenReminderSettings() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiGet<{ key: string; value: unknown }>(`/api/v1/settings/${SETTING_KEY}`),
    staleTime: 60_000,
    select: res => normalize(res.value),
  })

  const mutation = useMutation({
    mutationFn: (next: RegimenReminderSettings) =>
      apiPut(`/api/v1/settings/${SETTING_KEY}`, { value: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })

  const settings = query.data ?? DEFAULTS

  const update = useCallback(
    (patch: Partial<RegimenReminderSettings>) => {
      const next: RegimenReminderSettings = {
        startDays: clampDays(patch.startDays ?? settings.startDays),
        endDays: clampDays(patch.endDays ?? settings.endDays),
      }
      // Aggiornamento ottimistico: la tendina riflette subito la scelta.
      qc.setQueryData(QUERY_KEY, { key: SETTING_KEY, value: next })
      mutation.mutate(next)
    },
    [settings, mutation, qc],
  )

  return [settings, update] as const
}
