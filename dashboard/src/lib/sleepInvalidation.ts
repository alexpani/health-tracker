import { useCallback, useMemo } from "react"
import { useAppSetting } from "@/lib/appSettings"

const SETTING_KEY = "sleep_invalid_nights"

/**
 * Notti di sonno marcate come "non valide" (es. Apple Watch non indossato →
 * dati inaffidabili). Persistite **lato server** nella chiave `app_settings`
 * `sleep_invalid_nights` = array di date ISO `YYYY-MM-DD` (la "wake-up date"
 * della notte, cioe' il giorno di `end_date`, stessa convenzione di
 * `Sleep.tsx`/`day.py:_fetch_sleep`). Condivise tra dispositivi/browser.
 *
 * I dati grezzi restano nel DB: l'invalidazione esclude solo la notte dalle
 * viste (grafici, medie/score, card del giorno) ed e' reversibile.
 */
export function useSleepInvalidation() {
  const { value, set, isLoaded } = useAppSetting<string[]>(SETTING_KEY, [])

  const invalidSet = useMemo(() => new Set(value), [value])

  const isInvalid = useCallback((ymd: string) => invalidSet.has(ymd), [invalidSet])

  const toggle = useCallback(
    (ymd: string) => {
      const next = new Set(value)
      if (next.has(ymd)) next.delete(ymd)
      else next.add(ymd)
      set(Array.from(next).sort())
    },
    [value, set],
  )

  return { invalidNights: value, isInvalid, toggle, isLoaded }
}
