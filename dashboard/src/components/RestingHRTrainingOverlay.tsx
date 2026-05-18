import { useMemo } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useRegimens, useSamples } from "@/lib/queries"
import type { AggregatedPoint, Regimen } from "@/lib/types"

const RHR_TYPE = "HKQuantityTypeIdentifierRestingHeartRate"
const TRAINING_FILL = "#f59e0b" // amber-500
const TRAINING_STROKE = "#d97706" // amber-600
const LINE_COLOR = "#dc2626"

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function isAggregated(data: any[]): data is AggregatedPoint[] {
  return data.length > 0 && "period_start" in data[0]
}

export function RestingHRTrainingOverlay() {
  const samplesQ = useSamples({ type: RHR_TYPE, aggregation: "monthly", limit: 500 })
  const regimensQ = useRegimens({ kind: "training", include_ended: true })

  const { chartData, bands, stats, xDomain } = useMemo(() => {
    const raw = samplesQ.data?.data ?? []
    if (!isAggregated(raw) || raw.length === 0) {
      return { chartData: [], bands: [], stats: null, xDomain: undefined as any }
    }
    // API returns most-recent-first; ascending for charting.
    const points = [...raw]
      .reverse()
      .map(p => {
        const d = new Date(p.period_start)
        return {
          ts: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
          mk: monthKey(d),
          avg: p.avg,
          min: p.min,
          max: p.max,
          count: p.count,
        }
      })

    const firstTs = points[0].ts
    const lastTs = points[points.length - 1].ts

    const regimens = (regimensQ.data ?? []) as Regimen[]
    const bands = regimens
      .filter(r => r.start_date)
      .map(r => {
        const s = new Date(r.start_date as string)
        const e = r.end_date ? new Date(r.end_date) : new Date()
        const x1 = Math.max(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1), firstTs)
        const x2 = Math.min(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 28), lastTs)
        return { id: r.id, x1, x2, name: r.name, start: r.start_date, end: r.end_date }
      })
      .filter(b => b.x2 >= b.x1)

    // Stats: training-month vs off-month split
    const trainingMonths = new Set<string>()
    for (const r of regimens) {
      if (!r.start_date) continue
      const s = new Date(r.start_date)
      const e = r.end_date ? new Date(r.end_date) : new Date()
      let y = s.getUTCFullYear()
      let m = s.getUTCMonth()
      const endY = e.getUTCFullYear()
      const endM = e.getUTCMonth()
      while (y < endY || (y === endY && m <= endM)) {
        trainingMonths.add(`${y}-${String(m + 1).padStart(2, "0")}`)
        m += 1
        if (m === 12) { m = 0; y += 1 }
      }
    }
    const tr: number[] = []
    const off: number[] = []
    for (const p of points) {
      ;(trainingMonths.has(p.mk) ? tr : off).push(p.avg)
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
    const stats = {
      trN: tr.length,
      offN: off.length,
      trAvg: avg(tr),
      offAvg: avg(off),
      delta: tr.length && off.length ? (avg(tr) as number) - (avg(off) as number) : null,
    }

    return { chartData: points, bands, stats, xDomain: [firstTs, lastTs] as [number, number] }
  }, [samplesQ.data, regimensQ.data])

  const loading = samplesQ.isLoading || regimensQ.isLoading

  return (
    <Card>
      <CardHeader>
        <CardTitle>FC a riposo vs periodi di allenamento</CardTitle>
        <CardDescription>
          Battito a riposo medio mensile con sovrapposte le fasce di allenamento autodetect
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stats && stats.trAvg !== null && stats.offAvg !== null && (
          <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">In allenamento</div>
              <div className="text-lg font-semibold tabular-nums">{stats.trAvg.toFixed(1)} bpm</div>
              <div className="text-xs text-muted-foreground tabular-nums">{stats.trN} mesi</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">OFF</div>
              <div className="text-lg font-semibold tabular-nums">{stats.offAvg.toFixed(1)} bpm</div>
              <div className="text-xs text-muted-foreground tabular-nums">{stats.offN} mesi</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Δ (training − off)</div>
              <div
                className={`text-lg font-semibold tabular-nums ${stats.delta! < 0 ? "text-emerald-600" : "text-rose-600"}`}
              >
                {stats.delta! >= 0 ? "+" : ""}
                {stats.delta!.toFixed(1)} bpm
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex h-[340px] items-center justify-center text-muted-foreground">Caricamento…</div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[340px] items-center justify-center text-muted-foreground">
            Nessun dato di battito a riposo
          </div>
        ) : (
          <div style={{ width: "100%", height: 340 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={xDomain as any}
                  tickFormatter={(v: number) =>
                    new Date(v).toLocaleDateString("it-IT", { year: "numeric", month: "short" })
                  }
                  tick={{ fontSize: 11 }}
                  minTickGap={40}
                />
                <YAxis
                  domain={["dataMin - 3", "dataMax + 3"]}
                  tick={{ fontSize: 11 }}
                  width={50}
                  label={{ value: "bpm", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                />
                {bands.map(b => (
                  <ReferenceArea
                    key={b.id}
                    x1={b.x1}
                    x2={b.x2}
                    fill={TRAINING_FILL}
                    fillOpacity={0.12}
                    stroke={TRAINING_STROKE}
                    strokeOpacity={0.35}
                    strokeDasharray="2 2"
                    ifOverflow="visible"
                  />
                ))}
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload as (typeof chartData)[number]
                    const overlapping = bands.filter(b => p.ts >= b.x1 && p.ts <= b.x2)
                    return (
                      <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                        <div className="font-medium mb-1 tabular-nums">
                          {new Date(p.ts).toLocaleDateString("it-IT", { year: "numeric", month: "long" })}
                        </div>
                        <div className="tabular-nums">
                          <span className="text-muted-foreground">avg </span>
                          <span className="font-semibold">{p.avg.toFixed(1)} bpm</span>
                          <span className="text-muted-foreground"> ({p.min.toFixed(0)}–{p.max.toFixed(0)})</span>
                        </div>
                        {overlapping.length > 0 && (
                          <div className="mt-1.5 pt-1.5 border-t space-y-0.5">
                            {overlapping.map(b => (
                              <div key={b.id} className="text-amber-700 dark:text-amber-400">
                                <span className="opacity-60">●</span> {b.name}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="avg"
                  stroke={LINE_COLOR}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  activeDot={{ r: 5 }}
                  name="RHR avg"
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: LINE_COLOR }} />
            FC a riposo (media mensile)
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-4 border border-dashed"
              style={{ background: TRAINING_FILL + "20", borderColor: TRAINING_STROKE }}
            />
            Periodo di allenamento autodetect
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
