import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useCategories, useSamples } from "@/lib/queries"
import { computeRecoveryScore, type RecoveryComponent } from "@/lib/recoveryScore"
import { computeSleepScore } from "@/lib/sleepScore"
import type { CategorySample, Sample } from "@/lib/types"

const HRV = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
const RHR = "HKQuantityTypeIdentifierRestingHeartRate"
const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis"

function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export function RecoveryCard() {
  // --- Date range: ultimi 30 giorni + oggi ---
  // Stabilizzato per giorno locale (non per millisecondo) cosi' TanStack
  // Query non re-fetcha ad ogni render col timestamp che cambia.
  const { todayISO, startISO, endISO, sleepStartISO } = useMemo(() => {
    const t = new Date()
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate())
    const start = new Date(today)
    start.setDate(start.getDate() - 31)
    const end = new Date(today)
    end.setDate(end.getDate() + 1)
    const sleepStart = new Date(today)
    sleepStart.setDate(sleepStart.getDate() - 31)
    sleepStart.setHours(16, 0, 0, 0)
    return {
      todayISO: localISODate(today),
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      sleepStartISO: sleepStart.toISOString(),
    }
    // Re-calcolato solo se cambia il giorno (key = data odierna ISO).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [new Date().toDateString()])

  const hrvQ = useSamples({ type: HRV, start: startISO, end: endISO, aggregation: "none", limit: 5000 })
  const rhrQ = useSamples({ type: RHR, start: startISO, end: endISO, aggregation: "none", limit: 1000 })
  const sleepQ = useCategories(SLEEP, sleepStartISO, endISO)

  const result = useMemo(() => {
    if (!hrvQ.data || !rhrQ.data) return null
    const hrvSamples = hrvQ.data.data as Sample[]
    const rhrSamples = rhrQ.data.data as Sample[]

    // Suddividi i sleep sample per "notte di risveglio": convenzione
    // [D-1 16:00, D 16:00) = notte del giorno D. Un sample che finisce
    // alle 03:00 appartiene al giorno stesso; uno che finisce alle 22:00
    // (raro: sonnellino o turno) appartiene al giorno successivo.
    const sleepByNight: Map<string, CategorySample[]> = new Map()
    for (const s of (sleepQ.data ?? []) as CategorySample[]) {
      const end = new Date(s.end_date)
      const night = new Date(end)
      if (end.getHours() >= 16) night.setDate(night.getDate() + 1)
      const key = localISODate(night)
      const arr = sleepByNight.get(key)
      if (arr) arr.push(s); else sleepByNight.set(key, [s])
    }

    // Score di oggi e baseline
    const todayDate = new Date(`${todayISO}T12:00:00`)
    const todaySamples = sleepByNight.get(todayISO) ?? []
    const todayScore = computeSleepScore(todaySamples)?.score ?? null

    const baseline: number[] = []
    for (let k = 1; k <= 30; k++) {
      const d = new Date(todayDate)
      d.setDate(d.getDate() - k)
      const samples = sleepByNight.get(localISODate(d)) ?? []
      const s = computeSleepScore(samples)
      if (s) baseline.push(s.score)
    }

    return computeRecoveryScore(todayISO, hrvSamples, rhrSamples, todayScore, baseline)
  }, [hrvQ.data, rhrQ.data, sleepQ.data, todayISO])

  const loading = hrvQ.isLoading || rhrQ.isLoading || sleepQ.isLoading

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recupero stimato</CardTitle>
        <CardDescription>
          Combina HRV notturna, FC a riposo e qualita' del sonno rispetto al baseline personale degli ultimi 30 giorni
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-24 animate-pulse bg-muted rounded" />
        ) : !result ? (
          <p className="text-sm text-muted-foreground">
            Dati insufficienti per oggi: servono HRV o FC a riposo della notte appena passata + almeno 7 giorni di baseline.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <div>
                <div className={`text-5xl font-bold tabular-nums ${result.color}`}>{result.score}</div>
                <div className={`text-sm font-medium ${result.color}`}>{result.label}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>su 100</div>
                {result.partial && <div className="text-amber-600 mt-1">parziale ({result.components.length}/3 segnali)</div>}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t">
              {result.components.map(c => (
                <ComponentRow key={c.key} c={c} />
              ))}
            </div>

            <p className="text-[10px] text-muted-foreground">
              Score relativo, non assoluto: confronta i tuoi valori di oggi col tuo baseline 30g. Saturazione a ±2σ.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ComponentRow({ c }: { c: RecoveryComponent }) {
  const pct = Math.round(c.contrib * 100)
  let barColor = "bg-rose-500"
  if (c.contrib >= 0.7) barColor = "bg-emerald-500"
  else if (c.contrib >= 0.5) barColor = "bg-blue-500"
  else if (c.contrib >= 0.3) barColor = "bg-amber-500"
  return (
    <div className="text-xs">
      <div className="flex justify-between items-baseline gap-2">
        <span className="font-medium">{c.label}</span>
        <span className="tabular-nums text-muted-foreground">
          oggi <span className="text-foreground font-medium">{c.value}</span>
          <span className="mx-1.5">·</span>
          base <span className="text-foreground">{c.baseline}</span>
          {c.zOrPct && (
            <>
              <span className="mx-1.5">·</span>
              <span className={c.contrib >= 0.5 ? "text-emerald-600" : "text-rose-600"}>{c.zOrPct}</span>
            </>
          )}
        </span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden mt-1">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
