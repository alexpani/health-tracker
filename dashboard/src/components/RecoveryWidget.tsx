import { useMemo } from "react"
import { useSamples, useWorkouts } from "@/lib/queries"
import { computeRecoveryStatus, type FlagStatus, type RecoveryFlag } from "@/lib/recoveryScore"
import { computeWorkloadStatus } from "@/lib/readinessScore"
import type { Sample } from "@/lib/types"

const HRV = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
const RHR = "HKQuantityTypeIdentifierRestingHeartRate"

function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

const STATUS_DOT: Record<FlagStatus, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
}
const STATUS_TEXT: Record<FlagStatus, string> = {
  green: "text-emerald-600",
  amber: "text-amber-600",
  red: "text-rose-600",
}

/** Variante compatta dello "Stato di recupero" + "Carico settimanale"
 *  pensata per il widget giornaliero del Calendario. Click → /vitals. */
export function RecoveryWidget() {
  const { todayISO, startISO, endISO, workoutStartISO } = useMemo(() => {
    const t = new Date()
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate())
    const start = new Date(today); start.setDate(start.getDate() - 75)
    const wStart = new Date(today); wStart.setDate(wStart.getDate() - 35)
    const end = new Date(today); end.setDate(end.getDate() + 1)
    return {
      todayISO: localISODate(today),
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      workoutStartISO: wStart.toISOString(),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [new Date().toDateString()])

  const hrvQ = useSamples({ type: HRV, start: startISO, end: endISO, aggregation: "none", limit: 10000 })
  const rhrQ = useSamples({ type: RHR, start: startISO, end: endISO, aggregation: "none", limit: 2000 })
  const workoutsQ = useWorkouts({ start: workoutStartISO, end: endISO })

  const recovery = useMemo(() => {
    if (!hrvQ.data || !rhrQ.data) return null
    return computeRecoveryStatus(
      todayISO,
      hrvQ.data.data as Sample[],
      rhrQ.data.data as Sample[],
    )
  }, [hrvQ.data, rhrQ.data, todayISO])

  const workload = useMemo(() => {
    if (!workoutsQ.data) return null
    return computeWorkloadStatus(todayISO, workoutsQ.data)
  }, [workoutsQ.data, todayISO])

  const loading = hrvQ.isLoading || rhrQ.isLoading || workoutsQ.isLoading

  if (loading) return <div className="h-32 animate-pulse bg-muted rounded" />
  if (!recovery && !workload) {
    return <p className="text-xs text-muted-foreground">Dati insufficienti.</p>
  }

  return (
    <a href="/vitals" className="block group space-y-3" title="Apri lo stato completo in /vitals">
      {recovery && (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Recupero</div>
            <div className={`text-sm font-semibold ${recovery.color}`}>
              {recovery.verdict}
              {recovery.partial && <span className="ml-1 text-[10px] text-amber-600">parziale</span>}
            </div>
          </div>
          <div className="mt-1 space-y-0.5">
            {recovery.flags.map(f => <FlagLine key={f.key} f={f} />)}
          </div>
        </div>
      )}

      {workload && (
        <div className="pt-2 border-t">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Carico</div>
            <div className={`text-sm font-semibold ${STATUS_TEXT[workload.status]}`}>
              {workload.verdict}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[workload.status]}`} />
            <span className="text-muted-foreground">7g</span>
            <span className="tabular-nums font-medium">{Math.round(workload.acuteKcal)} kcal</span>
            {workload.acwr != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">ACWR</span>
                <span className={`tabular-nums font-medium ${STATUS_TEXT[workload.status]}`}>{workload.acwr.toFixed(2)}</span>
              </>
            )}
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">
        Apri →
      </div>
    </a>
  )
}

function FlagLine({ f }: { f: RecoveryFlag }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[f.status]}`} />
      <span className="text-muted-foreground flex-shrink-0">{shortLabel(f.key)}</span>
      <span className={`tabular-nums font-medium ${STATUS_TEXT[f.status]}`}>{f.value}</span>
    </div>
  )
}

function shortLabel(key: RecoveryFlag["key"]): string {
  switch (key) {
    case "hrv_rolling": return "HRV 7g"
    case "rhr_delta": return "FC riposo"
    case "hrv_streak": return "Streak HRV"
  }
}
