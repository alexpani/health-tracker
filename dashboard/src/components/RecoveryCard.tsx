import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

export function RecoveryCard() {
  // Servono ~75 giorni per coprire baseline 60g + qualche buffer.
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stato di recupero</CardTitle>
        <CardDescription>
          Tre flag indipendenti su soglie validate dalla letteratura sportiva, non un punteggio aggregato
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-24 animate-pulse bg-muted rounded" />
        ) : !result ? (
          <p className="text-sm text-muted-foreground">
            Dati insufficienti: servono almeno ~2 settimane di HRV e FC a riposo per costruire il baseline.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <div className={`text-4xl font-bold ${result.color}`}>{result.verdict}</div>
              {result.partial && (
                <span className="text-xs text-amber-600">parziale ({result.flags.length}/3 flag)</span>
              )}
            </div>

            <div className="space-y-3 pt-2 border-t">
              {result.flags.map(f => (
                <FlagRow key={f.key} f={f} />
              ))}
            </div>

            <p className="text-[10px] text-muted-foreground">
              HRV rolling 7g vs baseline 60g (Plews 2013); RHR vs baseline 60g, soglia +5 bpm (Achten 2003);
              streak HRV consecutiva sotto baseline (Plews 2013, Stanley 2013). Verdetto = peggior flag.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FlagRow({ f }: { f: RecoveryFlag }) {
  return (
    <div className="text-sm">
      <div className="flex items-start gap-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${STATUS_DOT[f.status]}`} />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline gap-2 flex-wrap">
            <span className="font-medium">{f.label}</span>
            <span className="tabular-nums text-foreground font-semibold">{f.value}</span>
          </div>
          <div className={`text-xs ${STATUS_TEXT[f.status]} mt-0.5`}>{f.detail}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Baseline: {f.baseline}
          </div>
          {f.spark && f.spark.length >= 3 && <Sparkline values={f.spark} status={f.status} />}
        </div>
      </div>
    </div>
  )
}

function Sparkline({ values, status }: { values: number[]; status: RecoveryFlag["status"] }) {
  const w = 120, h = 24
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 1
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(" ")
  const stroke = status === "green" ? "#10b981" : status === "amber" ? "#f59e0b" : "#f43f5e"
  return (
    <svg width={w} height={h} className="mt-1.5 block">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
