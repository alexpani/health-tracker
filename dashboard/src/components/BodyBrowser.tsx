import { useMemo, useState } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { SampleTable } from "@/components/SampleTable"
import { FilterBar } from "@/components/FilterBar"
import {
  TimeRangeSelector,
  suggestAggregation,
  timeRangeToDates,
} from "@/components/controls/TimeRangeSelector"
import { AggregationSelector } from "@/components/controls/AggregationSelector"
import { fetchCorrelated, useBulkDeleteSamples, useSamples } from "@/lib/queries"
import { CATEGORIES, getMeta } from "@/lib/healthkit"
import { formatDateTime } from "@/lib/utils"
import type { AdvancedFilters, AggregatedPoint, Aggregation, CorrelatedSample, Sample, TimeRange } from "@/lib/types"

const BODY_TYPES = CATEGORIES.body.types

interface SeriesPoint {
  time: string
  t: number // epoch ms for sorting/matching
  values: Record<string, number | undefined>
}

function isAggregated(data: any[]): data is AggregatedPoint[] {
  return data.length > 0 && "period_start" in data[0]
}

export default function BodyBrowser() {
  const [activeType, setActiveType] = useState(BODY_TYPES[0])
  const [range, setRange] = useState<TimeRange>("30d")
  const [aggregation, setAggregation] = useState<Aggregation>(suggestAggregation("30d"))
  const [advanced, setAdvanced] = useState<AdvancedFilters>({})

  // Delete flow
  const [deleteTarget, setDeleteTarget] = useState<Sample | null>(null)
  const [correlated, setCorrelated] = useState<CorrelatedSample[] | null>(null)
  const [loadingCorrelated, setLoadingCorrelated] = useState(false)
  const bulkDelete = useBulkDeleteSamples()

  const askDelete = async (s: Sample) => {
    if (s.id === undefined) return
    setDeleteTarget(s)
    setCorrelated(null)
    setLoadingCorrelated(true)
    try {
      const others = BODY_TYPES.filter(t => t !== s.type)
      const result = await fetchCorrelated(s.id, others, 5)
      setCorrelated(result)
    } finally {
      setLoadingCorrelated(false)
    }
  }

  const confirmDelete = async (includeCorrelated: boolean) => {
    if (!deleteTarget?.id) return
    const ids = [deleteTarget.id]
    if (includeCorrelated && correlated) {
      correlated.forEach(c => ids.push(c.id))
    }
    await bulkDelete.mutateAsync(ids)
    setDeleteTarget(null)
    setCorrelated(null)
  }

  const dates = useMemo(() => timeRangeToDates(range), [range])
  const effectiveStart = advanced.start ?? dates.start
  const effectiveEnd = advanced.end ?? dates.end

  // Fetch all body types in parallel (only value_min/max/sources/devices apply to the active type for raw)
  const weight = useSamples({ type: "HKQuantityTypeIdentifierBodyMass", start: effectiveStart, end: effectiveEnd, aggregation, limit: 2000 })
  const bmi = useSamples({ type: "HKQuantityTypeIdentifierBodyMassIndex", start: effectiveStart, end: effectiveEnd, aggregation, limit: 2000 })
  const fat = useSamples({ type: "HKQuantityTypeIdentifierBodyFatPercentage", start: effectiveStart, end: effectiveEnd, aggregation, limit: 2000 })
  const lean = useSamples({ type: "HKQuantityTypeIdentifierLeanBodyMass", start: effectiveStart, end: effectiveEnd, aggregation, limit: 2000 })
  const height = useSamples({ type: "HKQuantityTypeIdentifierHeight", start: effectiveStart, end: effectiveEnd, aggregation, limit: 2000 })
  const waist = useSamples({ type: "HKQuantityTypeIdentifierWaistCircumference", start: effectiveStart, end: effectiveEnd, aggregation, limit: 2000 })

  const rawQuery = useSamples({
    type: activeType,
    start: effectiveStart,
    end: effectiveEnd,
    aggregation: "none",
    sources: advanced.sources,
    devices: advanced.devices,
    value_min: advanced.value_min,
    value_max: advanced.value_max,
    limit: 100,
  })

  // Merge all type data into a single time-indexed series
  const merged = useMemo<SeriesPoint[]>(() => {
    const map = new Map<number, SeriesPoint>()

    const addData = (type: string, data: any[] | undefined) => {
      if (!data) return
      const meta = getMeta(type)
      const isAgg = isAggregated(data)
      for (const d of data) {
        const iso = isAgg ? d.period_start : d.start_date
        const t = new Date(iso).getTime()
        // Bucket at minute precision so points at the same instant merge
        const key = Math.floor(t / 60_000)
        const val = (isAgg ? d.avg : d.value) * meta.unitMultiplier
        if (!map.has(key)) {
          map.set(key, { time: iso, t, values: {} })
        }
        map.get(key)!.values[type] = val
      }
    }

    addData("HKQuantityTypeIdentifierBodyMass", weight.data?.data)
    addData("HKQuantityTypeIdentifierBodyMassIndex", bmi.data?.data)
    addData("HKQuantityTypeIdentifierBodyFatPercentage", fat.data?.data)
    addData("HKQuantityTypeIdentifierLeanBodyMass", lean.data?.data)
    addData("HKQuantityTypeIdentifierHeight", height.data?.data)
    addData("HKQuantityTypeIdentifierWaistCircumference", waist.data?.data)

    return Array.from(map.values()).sort((a, b) => a.t - b.t)
  }, [weight.data, bmi.data, fat.data, lean.data, height.data, waist.data])

  const onRangeChange = (r: TimeRange) => {
    setRange(r)
    setAggregation(suggestAggregation(r))
  }

  // Build chart data for the active type only (one line)
  const chartData = useMemo(
    () => merged.map(p => ({ time: p.time, t: p.t, value: p.values[activeType], __all: p.values })).filter(p => p.value !== undefined),
    [merged, activeType]
  )

  const activeMeta = getMeta(activeType)

  // Y domain tight around active values
  const vals = chartData.map(d => d.value as number).filter(v => Number.isFinite(v))
  const dMin = vals.length ? Math.min(...vals) : 0
  const dMax = vals.length ? Math.max(...vals) : 1
  const range_ = dMax - dMin || Math.abs(dMax) || 1
  const pad = range_ * 0.08
  const yDomain: [number, number] = [Math.max(0, dMin - pad), dMax + pad]

  const years = new Set(chartData.map(d => new Date(d.time).getFullYear()))
  const multiYear = years.size > 1

  const axisFormat = (iso: string) => {
    const d = new Date(iso)
    if (aggregation === "hourly") return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    if (aggregation === "monthly") return d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" })
    if (multiYear) return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
  }

  const tooltipLabel = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })
  }

  // Custom tooltip: show ALL body values at that point
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const all = payload[0]?.payload?.__all as Record<string, number | undefined> | undefined
    if (!all) return null

    const rows = BODY_TYPES
      .map(t => ({ t, meta: getMeta(t), v: all[t] }))
      .filter(r => r.v !== undefined)

    return (
      <div className="bg-card border rounded-lg shadow-md p-3 text-sm space-y-1">
        <div className="font-medium">{tooltipLabel(label)}</div>
        {rows.map(r => {
          const formatted = r.meta.formatValue ? r.meta.formatValue(r.v!) : (r.v as number).toLocaleString("it-IT", { maximumFractionDigits: 2 })
          return (
            <div key={r.t} className="flex justify-between gap-4 items-center">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: r.meta.color }} />
                {r.meta.label}
              </span>
              <span className="tabular-nums font-medium">
                {formatted} <span className="text-muted-foreground text-xs">{r.meta.displayUnit}</span>
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Corpo</h1>
        <p className="text-muted-foreground">Peso, BMI, massa grassa e magra</p>
      </div>

      <Tabs value={activeType} onValueChange={setActiveType}>
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            {BODY_TYPES.map(t => (
              <TabsTrigger key={t} value={t}>
                {getMeta(t).label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {BODY_TYPES.map(t => (
          <TabsContent key={t} value={t} className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <TimeRangeSelector value={range} onChange={onRangeChange} />
              <AggregationSelector value={aggregation} onChange={setAggregation} />
            </div>
            <FilterBar type={t} value={advanced} onChange={setAdvanced} />

            <Card>
              <CardHeader>
                <CardTitle>
                  {activeMeta.label}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({activeMeta.displayUnit || "-"})
                  </span>
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    — hover per vedere tutti i valori del giorno
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {chartData.length === 0 ? (
                  <div className="flex items-center justify-center text-muted-foreground" style={{ height: 320 }}>
                    Nessun dato nel periodo selezionato
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="time" tickFormatter={axisFormat} minTickGap={40} tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} domain={yDomain} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line dataKey="value" stroke={activeMeta.color} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ultimi 100 campioni</CardTitle>
              </CardHeader>
              <CardContent>
                {rawQuery.data && (
                  <SampleTable type={t} samples={rawQuery.data.data as Sample[]} onDelete={askDelete} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-card rounded-lg shadow-lg max-w-md w-full p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div>
              <h3 className="text-lg font-semibold">Elimina campione</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {getMeta(deleteTarget.type).label}: {" "}
                <span className="font-medium">
                  {(deleteTarget.value * getMeta(deleteTarget.type).unitMultiplier).toLocaleString("it-IT", { maximumFractionDigits: 2 })}
                  {" "}{getMeta(deleteTarget.type).displayUnit}
                </span>
                {" - "}{formatDateTime(deleteTarget.start_date)}
              </p>
            </div>

            <div className="border-t pt-3">
              {loadingCorrelated ? (
                <p className="text-sm text-muted-foreground">Cerco dati correlati...</p>
              ) : correlated && correlated.length > 0 ? (
                <>
                  <p className="text-sm font-medium">
                    Trovati {correlated.length} dati correlati nello stesso istante (±5 min):
                  </p>
                  <ul className="text-sm text-muted-foreground mt-1 space-y-0.5">
                    {correlated.map(c => {
                      const m = getMeta(c.type)
                      const v = c.value * m.unitMultiplier
                      return (
                        <li key={c.id}>
                          • {m.label}: {v.toLocaleString("it-IT", { maximumFractionDigits: 2 })} {m.displayUnit}
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Nessun dato correlato trovato nello stesso istante.</p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={bulkDelete.isPending}>
                Annulla
              </Button>
              {correlated && correlated.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => confirmDelete(false)}
                  disabled={bulkDelete.isPending}
                >
                  Elimina solo questo
                </Button>
              )}
              <Button
                variant="destructive"
                onClick={() => confirmDelete(true)}
                disabled={bulkDelete.isPending || loadingCorrelated}
              >
                {bulkDelete.isPending
                  ? "Elimino..."
                  : correlated && correlated.length > 0
                  ? `Elimina tutti (${correlated.length + 1})`
                  : "Elimina"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
