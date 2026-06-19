import { useCallback, useEffect, useState } from "react"

/** Impostazioni del promemoria regimi in home (pagina di oggi). Frontend-only,
 * persistite in localStorage. Orizzonti separati per inizio e fine. */
export interface RegimenReminderSettings {
  /** Giorni di anticipo per i regimi che stanno per cominciare (1–30). */
  startDays: number
  /** Giorni di anticipo per i regimi che stanno per finire (1–30). */
  endDays: number
}

const KEY = "regimen_reminder_horizon_v1"
const EVENT = "regimen-reminder-settings-changed"
const DEFAULTS: RegimenReminderSettings = { startDays: 7, endDays: 7 }

export const REMINDER_MIN_DAYS = 1
export const REMINDER_MAX_DAYS = 30

function clampDays(n: unknown): number {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return DEFAULTS.startDays
  return Math.min(REMINDER_MAX_DAYS, Math.max(REMINDER_MIN_DAYS, v))
}

export function loadRegimenReminderSettings(): RegimenReminderSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const p = JSON.parse(raw)
    return { startDays: clampDays(p.startDays), endDays: clampDays(p.endDays) }
  } catch {
    return DEFAULTS
  }
}

/**
 * Hook reattivo: ritorna le impostazioni correnti e un updater. Le modifiche
 * sono persistite e propagate live a tutte le istanze montate (anche su altre
 * pagine) via un custom event + l'evento `storage` cross-tab.
 */
export function useRegimenReminderSettings() {
  const [settings, setSettings] = useState<RegimenReminderSettings>(loadRegimenReminderSettings)

  useEffect(() => {
    const onChange = () => setSettings(loadRegimenReminderSettings())
    window.addEventListener(EVENT, onChange)
    window.addEventListener("storage", onChange)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener("storage", onChange)
    }
  }, [])

  const update = useCallback((patch: Partial<RegimenReminderSettings>) => {
    setSettings(prev => {
      const next: RegimenReminderSettings = {
        startDays: clampDays(patch.startDays ?? prev.startDays),
        endDays: clampDays(patch.endDays ?? prev.endDays),
      }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* no-op */
      }
      window.dispatchEvent(new Event(EVENT))
      return next
    })
  }, [])

  return [settings, update] as const
}
