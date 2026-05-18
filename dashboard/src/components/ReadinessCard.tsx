import { useMemo } from "react"
import { AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useCategories, useSamples, useWorkouts } from "@/lib/queries"
import { computeReadiness } from "@/lib/readinessScore"
import { computeRecoveryScore } from "@/lib/recoveryScore"
import { computeSleepScore } from "@/lib/sleepScore"
import type { CategorySample, Sample } from "@/lib/types"

const HRV = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
const RHR = "HKQuantityTypeIdentifierRestingHeartRate"
const RR = "HKQuantityTypeIdentifierRespiratoryRate"
const SPO2 = "HKQuantityTypeIdentifierOxygenSaturation"
const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis"

function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export function ReadinessCard() {
  // Stabilizzazione: date cambiano solo a mezzanotte
  const { todayISO, startISO, endISO, sleepStartISO, workoutStartISO } = useMemo(() => {
    const t = new Date()
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate())
    const start = new Date(today); start.setDate(start.getDate() - 31)
    const end = new Date(today); end.setDate(end.getDate() + 1)
    const sleepStart = new Date(today); sleepStart.setDate(sleepStart.getDate() - 31); sleepStart.setHours(16, 0, 0, 0)
    const workoutStart = new Date(today); workoutStart.setDate(workoutStart.getDate() - 35)
    return {
      todayISO: localISODate(today),
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      sleepStartISO: sleepStart.toISOString(),
      workoutStartISO: workoutStart.toISOString(),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [new Date().toDateString()])

  const hrvQ = useSamples({ type: HRV, start: startISO, end: endISO, aggregation: "none", limit: 5000 })
  const rhrQ = useSamples({ type: RHR, start: startISO, end: endISO, aggregation: "none", limit: 1000 })
  const rrQ  = useSamples({ type: RR,  start: startISO, end: endISO, aggregation: "none", limit: 5000 })
  const spo2Q = useSamples({ type: SPO2, start: startISO, end: endISO, aggregation: "none", limit: 5000 })
  const sleepQ = useCategories(SLEEP, sleepStartISO, endISO)
  const workoutsQ = useWorkouts({ start: workoutStartISO, end: endISO })

  const result = useMemo(() => {
    if (!hrvQ.data || !rhrQ.data || !rrQ.data || !spo2Q.data || !workoutsQ.data) return null
    const hrvSamples = hrvQ.data.data as Sample[]
    const rhrSamples = rhrQ.data.data as Sample[]
    const rrSamples = rrQ.data.data as Sample[]
    const spo2Samples = spo2Q.data.data as Sample[]

    // Recovery score di oggi (riusa la stessa logica della card sopra)
    const sleepByNight = new Map<string, CategorySample[]>()
    for (const s of (sleepQ.data ?? []) as CategorySample[]) {
      const end = new Date(s.end_date)
      const night = new Date(end)
      if (end.getHours() >= 16) night.setDate(night.getDate() + 1)
      const key = localISODate(night)
      const arr = sleepByNight.get(key)
      if (arr) arr.push(s); else sleepByNight.set(key, [s])
    }
    const todayDate = new Date(`${todayISO}T12:00:00`)
    const todaySleep = sleepByNight.get(todayISO) ?? []
    const todaySleepScore = computeSleepScore(todaySleep)?.score ?? null
    const sleepBaseline: number[] = []
    for (let k = 1; k <= 30; k++) {
      const d = new Date(todayDate); d.setDate(d.getDate() - k)
      const s = computeSleepScore(sleepByNight.get(localISODate(d)) ?? [])
      if (s) sleepBaseline.push(s.score)
    }
    const recovery = computeRecoveryScore(todayISO, hrvSamples, rhrSamples, rrSamples, spo2Samples, todaySleepScore, sleepBaseline)

    return computeReadiness(todayISO, recovery?.score ?? null, workoutsQ.data, hrvSamples)
  }, [hrvQ.data, rhrQ.data, rrQ.data, spo2Q.data, sleepQ.data, workoutsQ.data, todayISO])

  const loading = hrvQ.isLoading || rhrQ.isLoading || rrQ.isLoading || spo2Q.isLoading || sleepQ.isLoading || workoutsQ.isLoading

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pronto per domani?</CardTitle>
        <CardDescription>
          Combina recupero attuale, carico settimanale (ACWR) e trend HRV per stimare se sei pronto a un allenamento intenso
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-24 animate-pulse bg-muted rounded" />
        ) : !result ? (
          <p className="text-sm text-muted-foreground">Dati insufficienti.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <div>
                <div className={`text-5xl font-bold tabular-nums ${result.color}`}>{result.score}</div>
                <div className={`text-sm font-medium ${result.color}`}>{result.label}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>su 100</div>
                {result.partial && (
                  <div className="text-amber-600 mt-1">parziale</div>
                )}
              </div>
            </div>

            <ul className="space-y-1.5 pt-2 border-t">
              {result.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {r.kind === "ok" && <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />}
                  {r.kind === "warn" && <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />}
                  {r.kind === "bad" && <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />}
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>

            <div className="pt-2 border-t grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">Carico 7g</div>
                <div className="font-medium tabular-nums">{Math.round(result.acuteKcal)} kcal</div>
              </div>
              <div>
                <div className="text-muted-foreground">Media settimanale 28g</div>
                <div className="font-medium tabular-nums">{Math.round(result.chronicKcalWeekly)} kcal</div>
              </div>
              <div>
                <div className="text-muted-foreground">ACWR</div>
                <div className="font-medium tabular-nums">{result.acwr != null ? result.acwr.toFixed(2) : "—"}</div>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground">
              ACWR sweet spot 0.8–1.3 (Gabbett 2016, Hulin 2014). Carico misurato in kcal totali dei workout.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
