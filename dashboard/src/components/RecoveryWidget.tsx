import { useMemo } from "react"
import { useSamples } from "@/lib/queries"
import { computeRecoveryStatus, type RecoveryFlag } from "@/lib/recoveryScore"
import type { Sample } from "@/lib/types"

const HRV = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
const RHR = "HKQuantityTypeIdentifierRestingHeartRate"

function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

const STATUS_DOT: Record<RecoveryFlag["status"], string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
}
const STATUS_TEXT: Record<RecoveryFlag["status"], string> = {
  green: "text-emerald-600",
  amber: "text-amber-600",
  red: "text-rose-600",
}

/** Variante compatta dello "Stato di recupero" pensata per il widget
 *  giornaliero del Calendario. Mostra solo il verdetto + 3 puntini
 *  colorati con label breve. Click → naviga al tab HRV di /vitals. */
export function RecoveryWidget() {
  const { todayISO, startISO, endISO } = useMemo(() => {
    const t = new Date()
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate())
    const start = new Date(today); start.setDate(start.getDate() - 75)
    const end = new Date(today); end.setDate(end.getDate() + 1)
    return {
      todayISO: localISODate(today),
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [new Date().toDateString()])

  const hrvQ = useSamples({ type: HRV, start: startISO, end: endISO, aggregation: "none", limit: 10000 })
  const rhrQ = useSamples({ type: RHR, start: startISO, end: endISO, aggregation: "none", limit: 2000 })

  const result = useMemo(() => {
    if (!hrvQ.data || !rhrQ.data) return null
    return computeRecoveryStatus(
      todayISO,
      hrvQ.data.data as Sample[],
      rhrQ.data.data as Sample[],
    )
  }, [hrvQ.data, rhrQ.data, todayISO])

  const loading = hrvQ.isLoading || rhrQ.isLoading

  if (loading) return <div className="h-16 animate-pulse bg-muted rounded" />
  if (!result) {
    return (
      <p className="text-xs text-muted-foreground">
        Dati insufficienti (servono ~2 settimane di HRV e FC a riposo).
      </p>
    )
  }

  return (
    <a
      href="/vitals"
      className="block group"
      title="Apri lo Stato di recupero completo in /vitals"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className={`text-2xl font-bold ${result.color}`}>{result.verdict}</div>
        {result.partial && (
          <span className="text-[10px] text-amber-600">parziale</span>
        )}
      </div>

      <div className="mt-2 space-y-1">
        {result.flags.map(f => (
          <div key={f.key} className="flex items-center gap-2 text-xs">
            <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[f.status]}`} />
            <span className="text-muted-foreground flex-shrink-0">{shortLabel(f.key)}</span>
            <span className={`tabular-nums font-medium ${STATUS_TEXT[f.status]}`}>{f.value}</span>
          </div>
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground mt-2 group-hover:text-foreground transition-colors">
        Apri →
      </div>
    </a>
  )
}

function shortLabel(key: RecoveryFlag["key"]): string {
  switch (key) {
    case "hrv_rolling": return "HRV 7g"
    case "rhr_delta": return "FC riposo"
    case "hrv_streak": return "Streak HRV"
  }
}
