import { useEffect, useMemo, useRef, useState } from "react"
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
import { Filter, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BodyFiltersSidebar } from "@/components/BodyFiltersSidebar"
import { WeightCalculator } from "@/components/WeightCalculator"
import { fetchCorrelated, useBulkDeleteSamples, useSampleFacets, useSamples } from "@/lib/queries"
import { CATEGORIES, getMeta } from "@/lib/healthkit"
import { formatDateTime } from "@/lib/utils"
import type { BodyFilters, CorrelatedSample, Sample } from "@/lib/types"

const BODY_TYPES = CATEGORIES.body.types
const STORAGE_KEY = "body_filters_v3"
const PAGE_SIZE = 50

interface MergedRow {
  id?: number
  uuid: string
  type: string
  value: number
  start_date: string
  source_name: string | null
}

function bucketFloor(t: number, agg: string): number {
  const d = new Date(t)
  if (agg === "hourly") { d.setMinutes(0, 0, 0); return d.getTime() }
  if (agg === "daily")  { d.setHours(0, 0, 0, 0); return d.getTime() }
  if (agg === "weekly") {
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  if (agg === "monthly") { return new Date(d.getFullYear(), d.getMonth(), 1).getTime() }
  return t
}

interface WeightStat {
  first: number
  last: number
  delta: number
  firstDate: string
  lastDate: string
  n: number
}

function WeightDeltaCard({ label, stat }: { label: string; stat: WeightStat | null }) {
  if (!stat) {
    return (
      <Card>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold text-muted-foreground">—</p>
          <p className="text-[11px] text-muted-foreground mt-1">Nessun dato</p>
        </CardContent>
      </Card>
    )
  }
  const sign = stat.delta > 0 ? "+" : ""
  const color =
    Math.abs(stat.delta) < 0.05 ? "text-muted-foreground"
    : stat.delta > 0 ? "text-red-500"
    : "text-green-500"
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-semibold tabular-nums ${color}`}>
          {sign}{stat.delta.toFixed(1)} <span className="text-sm text-muted-foreground font-normal">kg</span>
        </p>
        <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
          {stat.first.toFixed(1)} → {stat.last.toFixed(1)} kg
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {fmtDate(stat.firstDate)} → {fmtDate(stat.lastDate)}
        </p>
      </CardContent>
    </Card>
  )
}

export default function BodyBrowser() {
  const saved = useMemo<any>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }, [])

  const defaultFilters = useMemo<BodyFilters>(() => {
    const end = new Date()
    const start = new Date(end.getTime() - 365 * 86400_000)
    return {
      aggregation: "daily",
      types: ["HKQuantityTypeIdentifierBodyMass"],
      start: start.toISOString(),
      end: end.toISOString(),
    }
  }, [])

  const [filters, setFilters] = useState<BodyFilters>(saved?.filters ?? defaultFilters)
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const [page, setPage] = useState(0)

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters })) } catch {}
    setPage(0)
  }, [filters])

  const selectedTypes = filters.types && filters.types.length > 0 ? filters.types : ["HKQuantityTypeIdentifierBodyMass"]
  const aggregation = filters.aggregation ?? "none"


  // All-time BodyMass samples (ignoring time filter) — used to compute
  // the "variazione peso" cards (ultimo mese / anno / tutto). Respects
  // sources filter for consistency with the main view.
  const allBodyMassQ = useSamples({
    type: "HKQuantityTypeIdentifierBodyMass",
    aggregation: "none",
    sources: filters.sources,
    limit: 10000,
  })

  // Always fetch RAW (aggregation=none) — table must always show raw samples,
  // and the chart aggregation happens client-side.
  const q = {
    BodyMass:          useSamples({ type: "HKQuantityTypeIdentifierBodyMass",          start: filters.start, end: filters.end, aggregation: "none", sources: filters.sources, limit: 10000 }),
    BodyMassIndex:     useSamples({ type: "HKQuantityTypeIdentifierBodyMassIndex",     start: filters.start, end: filters.end, aggregation: "none", sources: filters.sources, limit: 10000 }),
    BodyFatPercentage: useSamples({ type: "HKQuantityTypeIdentifierBodyFatPercentage", start: filters.start, end: filters.end, aggregation: "none", sources: filters.sources, limit: 10000 }),
    LeanBodyMass:      useSamples({ type: "HKQuantityTypeIdentifierLeanBodyMass",      start: filters.start, end: filters.end, aggregation: "none", sources: filters.sources, limit: 10000 }),
    Height:            useSamples({ type: "HKQuantityTypeIdentifierHeight",            start: filters.start, end: filters.end, aggregation: "none", sources: filters.sources, limit: 10000 }),
    Waist:             useSamples({ type: "HKQuantityTypeIdentifierWaistCircumference",start: filters.start, end: filters.end, aggregation: "none", sources: filters.sources, limit: 10000 }),
  }

  const typeKey: Record<string, keyof typeof q> = {
    HKQuantityTypeIdentifierBodyMass: "BodyMass",
    HKQuantityTypeIdentifierBodyMassIndex: "BodyMassIndex",
    HKQuantityTypeIdentifierBodyFatPercentage: "BodyFatPercentage",
    HKQuantityTypeIdentifierLeanBodyMass: "LeanBodyMass",
    HKQuantityTypeIdentifierHeight: "Height",
    HKQuantityTypeIdentifierWaistCircumference: "Waist",
  }

  const rawFor = (type: string): Sample[] => {
    const d = q[typeKey[type]].data?.data
    if (!d || d.length === 0) return []
    return d as Sample[]
  }

  // Weight range applies only to BodyMass samples (in kg — BodyMass source unit is already kg)
  const passesWeight = (type: string, value: number) => {
    if (type !== "HKQuantityTypeIdentifierBodyMass") return true
    if (filters.weight_min !== undefined && value < filters.weight_min) return false
    if (filters.weight_max !== undefined && value > filters.weight_max) return false
    return true
  }

  // Facets (sources + years) are fetched per body type from /samples/facets
  // which is NOT filtered by time — so the sidebar chips show the full
  // historical span regardless of the current "Periodo preciso" selection.
  const facetBodyMass    = useSampleFacets("HKQuantityTypeIdentifierBodyMass")
  const facetBodyMassIdx = useSampleFacets("HKQuantityTypeIdentifierBodyMassIndex")
  const facetBodyFat     = useSampleFacets("HKQuantityTypeIdentifierBodyFatPercentage")
  const facetLean        = useSampleFacets("HKQuantityTypeIdentifierLeanBodyMass")
  const facetHeight      = useSampleFacets("HKQuantityTypeIdentifierHeight")
  const facetWaist       = useSampleFacets("HKQuantityTypeIdentifierWaistCircumference")
  const bodyFacets = [facetBodyMass, facetBodyMassIdx, facetBodyFat, facetLean, facetHeight, facetWaist]

  const availableSources = useMemo(() => {
    const set = new Set<string>()
    bodyFacets.forEach(f => f.data?.sources?.forEach(s => s && set.add(s)))
    return Array.from(set).sort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facetBodyMass.data, facetBodyMassIdx.data, facetBodyFat.data, facetLean.data, facetHeight.data, facetWaist.data])

  const availableYears = useMemo(() => {
    const set = new Set<number>()
    bodyFacets.forEach(f => f.data?.years?.forEach(y => set.add(y.year)))
    return Array.from(set).sort((a, b) => b - a)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facetBodyMass.data, facetBodyMassIdx.data, facetBodyFat.data, facetLean.data, facetHeight.data, facetWaist.data])

  // Build chart data: time-indexed points, one key per selected type (client-side aggregation if requested)
  const chartData = useMemo(() => {
    type Agg = { sum: number; n: number }
    const buckets = new Map<number, Record<string, Agg>>()

    selectedTypes.forEach(type => {
      const meta = getMeta(type)
      rawFor(type).forEach(s => {
        if (!passesWeight(type, s.value)) return
        const t0 = new Date(s.start_date).getTime()
        const bucketT = aggregation === "none" ? t0 : bucketFloor(t0, aggregation)
        if (!buckets.has(bucketT)) buckets.set(bucketT, {})
        const row = buckets.get(bucketT)!
        if (!row[type]) row[type] = { sum: 0, n: 0 }
        row[type].sum += s.value * meta.unitMultiplier
        row[type].n += 1
      })
    })

    const out = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, row]) => {
        const obj: Record<string, any> = { t, time: new Date(t).toISOString() }
        for (const [type, a] of Object.entries(row)) obj[type] = a.sum / a.n
        return obj
      })
    return out
  }, [selectedTypes, aggregation, filters.weight_min, filters.weight_max, q.BodyMass.data, q.BodyMassIndex.data, q.BodyFatPercentage.data, q.LeanBodyMass.data, q.Height.data, q.Waist.data])

  // Table: ALL raw samples for selected types (respecting year filter), sorted desc
  const tableRows = useMemo<MergedRow[]>(() => {
    const rows: MergedRow[] = []
    selectedTypes.forEach(type => {
      rawFor(type).forEach(s => {
        if (!passesWeight(type, s.value)) return
        rows.push({
          id: s.id,
          uuid: s.uuid,
          type,
          value: s.value,
          start_date: s.start_date,
          source_name: s.source_name,
        })
      })
    })
    rows.sort((a, b) => b.start_date.localeCompare(a.start_date))
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTypes, filters.weight_min, filters.weight_max, q.BodyMass.data, q.BodyMassIndex.data, q.BodyFatPercentage.data, q.LeanBodyMass.data, q.Height.data, q.Waist.data])

  // Per-type overview cards: most recent value + sample count in the
  // currently filtered window.
  const perTypeOverview = useMemo(() => {
    const out: Record<string, { count: number; lastValue: number | null; lastDate: string | null }> = {}
    selectedTypes.forEach(t => {
      const samples = rawFor(t).filter(s => passesWeight(t, s.value))
      let last: Sample | null = null
      for (const s of samples) {
        if (!last || s.start_date > last.start_date) last = s
      }
      out[t] = {
        count: samples.length,
        lastValue: last ? last.value : null,
        lastDate: last ? last.start_date : null,
      }
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTypes, filters.weight_min, filters.weight_max, q.BodyMass.data, q.BodyMassIndex.data, q.BodyFatPercentage.data, q.LeanBodyMass.data, q.Height.data, q.Waist.data])

  // Weight variation stats (last month / last year / all / selected period)
  const weightStats = useMemo(() => {
    const all = (allBodyMassQ.data?.data as Sample[] | undefined) ?? []
    if (all.length === 0) return null
    // Apply weight range filter to stay consistent with user's intent
    const filtered = all.filter(s => {
      if (filters.weight_min !== undefined && s.value < filters.weight_min) return false
      if (filters.weight_max !== undefined && s.value > filters.weight_max) return false
      return true
    })
    if (filtered.length === 0) return null
    const sorted = [...filtered].sort((a, b) => a.start_date.localeCompare(b.start_date))
    const now = Date.now()

    const deltaInRange = (startMs: number | null, endMs: number | null) => {
      const slice = sorted.filter(s => {
        const t = new Date(s.start_date).getTime()
        if (startMs !== null && t < startMs) return false
        if (endMs !== null && t > endMs) return false
        return true
      })
      if (slice.length === 0) return null
      const first = slice[0]
      const last = slice[slice.length - 1]
      return {
        first: first.value,
        last: last.value,
        delta: last.value - first.value,
        firstDate: first.start_date,
        lastDate: last.start_date,
        n: slice.length,
      }
    }

    const selStart = filters.start ? new Date(filters.start).getTime() : null
    const selEnd = filters.end ? new Date(filters.end).getTime() : null
    const hasSelected = selStart !== null || selEnd !== null

    return {
      month:    deltaInRange(now - 30 * 86400_000, null),
      year:     deltaInRange(now - 365 * 86400_000, null),
      all:      deltaInRange(null, null),
      selected: hasSelected ? deltaInRange(selStart, selEnd) : null,
    }
  }, [allBodyMassQ.data, filters.start, filters.end, filters.weight_min, filters.weight_max])

  const showWeightStats = selectedTypes.includes("HKQuantityTypeIdentifierBodyMass")

  // Delete flow
  const [deleteTarget, setDeleteTarget] = useState<MergedRow | null>(null)
  const [correlated, setCorrelated] = useState<CorrelatedSample[] | null>(null)
  const [loadingCorrelated, setLoadingCorrelated] = useState(false)
  const bulkDelete = useBulkDeleteSamples()

  const askDelete = async (r: MergedRow, ev: React.MouseEvent) => {
    ev.stopPropagation()
    if (r.id === undefined) return
    setDeleteTarget(r)
    setCorrelated(null)
    setLoadingCorrelated(true)
    try {
      const others = BODY_TYPES.filter(t => t !== r.type)
      const result = await fetchCorrelated(r.id, others, 5)
      setCorrelated(result)
    } finally {
      setLoadingCorrelated(false)
    }
  }

  const confirmDelete = async (includeCorrelated: boolean) => {
    if (!deleteTarget?.id) return
    const ids = [deleteTarget.id]
    if (includeCorrelated && correlated) correlated.forEach(c => ids.push(c.id))
    await bulkDelete.mutateAsync(ids)
    setDeleteTarget(null)
    setCorrelated(null)
  }

  // Chart formatting
  const years = new Set(chartData.map(p => new Date(p.time).getFullYear()))
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
      + " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const row = payload[0]?.payload ?? {}
    const rows = selectedTypes
      .map(t => ({ t, meta: getMeta(t), v: row[t] as number | undefined }))
      .filter(r => r.v !== undefined && r.v !== null)
    if (rows.length === 0) return null
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

  const activeFiltersCount = [
    filters.start, filters.end,
    filters.types?.length && filters.types.length < BODY_TYPES.length ? 1 : undefined,
    filters.sources?.length,
    filters.weight_min !== undefined ? 1 : undefined,
    filters.weight_max !== undefined ? 1 : undefined,
  ].filter(Boolean).length

  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE))
  const pageRows = tableRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const isLoading = selectedTypes.some(t => q[typeKey[t]].isLoading)

  // Drag-to-select a time range on the chart to compute per-metric deltas
  const [selStart, setSelStart] = useState<string | null>(null)
  const [selEnd, setSelEnd] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [popoverCoord, setPopoverCoord] = useState<{ x: number; y: number } | null>(null)

  const clearSelection = () => {
    setSelStart(null); setSelEnd(null); setIsDragging(false); setPopoverCoord(null)
  }

  // Compute deltas over [selStart, selEnd] for each selected metric
  const selectionStats = useMemo(() => {
    if (!selStart || !selEnd) return null
    const lo = selStart < selEnd ? selStart : selEnd
    const hi = selStart < selEnd ? selEnd : selStart
    return selectedTypes.map(type => {
      const meta = getMeta(type)
      const samples = rawFor(type)
        .filter(s => {
          if (!passesWeight(type, s.value)) return false
          return s.start_date >= lo && s.start_date <= hi
        })
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
      if (samples.length === 0) return { type, meta, first: null, last: null, delta: null, n: 0 }
      const first = samples[0].value * meta.unitMultiplier
      const last = samples[samples.length - 1].value * meta.unitMultiplier
      return {
        type, meta,
        first, last, delta: last - first,
        firstDate: samples[0].start_date,
        lastDate: samples[samples.length - 1].start_date,
        n: samples.length,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selStart, selEnd, selectedTypes, filters.weight_min, filters.weight_max,
      q.BodyMass.data, q.BodyMassIndex.data, q.BodyFatPercentage.data, q.LeanBodyMass.data, q.Height.data, q.Waist.data])

  return (
    <div className="flex gap-6 -m-6 p-0 min-h-[calc(100vh-0px)]">
      <aside className="hidden lg:block w-[320px] shrink-0 border-r bg-card/30 sticky top-0 h-screen overflow-hidden">
        <BodyFiltersSidebar value={filters} onChange={setFilters} availableSources={availableSources} availableYears={availableYears} />
      </aside>

      <div className="flex-1 space-y-6 min-w-0 p-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Corpo</h1>
            <p className="text-muted-foreground">Peso, BMI, massa grassa/magra, altezza, circonferenza vita</p>
          </div>
          <Button variant="outline" className="lg:hidden" onClick={() => setShowMobileFilters(true)}>
            <Filter className="h-4 w-4 mr-2" />
            Filtri {activeFiltersCount > 0 && <span className="ml-1 bg-primary text-primary-foreground rounded-full px-2 text-xs">{activeFiltersCount}</span>}
          </Button>
        </div>

        {showWeightStats && weightStats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <WeightDeltaCard label="Ultimo mese" stat={weightStats.month} />
            <WeightDeltaCard label="Ultimo anno" stat={weightStats.year} />
            <WeightDeltaCard label="Tutto" stat={weightStats.all} />
            <WeightDeltaCard label="Periodo selezionato" stat={weightStats.selected} />
          </div>
        )}

        <WeightCalculator />

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {selectedTypes.map(t => {
            const meta = getMeta(t)
            const ov = perTypeOverview[t]
            const displayValue = ov?.lastValue != null
              ? (meta.formatValue
                  ? meta.formatValue(ov.lastValue * meta.unitMultiplier)
                  : (ov.lastValue * meta.unitMultiplier).toLocaleString("it-IT", { maximumFractionDigits: 2 }))
              : null
            const dateStr = ov?.lastDate
              ? new Date(ov.lastDate).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })
              : null
            return (
              <Card key={t}>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: meta.color }} />
                    {meta.label}
                  </p>
                  {displayValue ? (
                    <p className="text-xl font-semibold tabular-nums">
                      {displayValue}
                      {meta.displayUnit && <span className="text-sm text-muted-foreground font-normal ml-1">{meta.displayUnit}</span>}
                    </p>
                  ) : (
                    <p className="text-xl font-semibold text-muted-foreground">—</p>
                  )}
                  <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                    {ov?.count ?? 0} campioni{dateStr ? ` · ${dateStr}` : ""}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              Andamento
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                — trascina orizzontalmente per calcolare la variazione nell'intervallo
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="flex items-center justify-center text-muted-foreground" style={{ height: 320 }}>
                {isLoading ? "Caricamento..." : "Nessun dato nel periodo selezionato"}
              </div>
            ) : (
              <div className="relative select-none">
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart
                    data={chartData}
                    onMouseDown={(e: any) => {
                      const lbl = e?.activeLabel
                      if (!lbl) return
                      setSelStart(lbl); setSelEnd(lbl)
                      setIsDragging(true)
                      setPopoverCoord(null)
                    }}
                    onMouseMove={(e: any) => {
                      if (!isDragging) return
                      const lbl = e?.activeLabel
                      if (!lbl) return
                      setSelEnd(lbl)
                      const coord = e?.activeCoordinate
                      if (coord) setPopoverCoord({ x: coord.x, y: coord.y })
                    }}
                    onMouseUp={() => {
                      if (!isDragging) return
                      setIsDragging(false)
                      if (!selStart || !selEnd || selStart === selEnd) {
                        clearSelection()
                      }
                    }}
                    onMouseLeave={() => {
                      if (isDragging) setIsDragging(false)
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis
                      dataKey="time"
                      tickFormatter={axisFormat}
                      minTickGap={40}
                      tick={{ fontSize: 12 }}
                      allowDataOverflow
                    />
                    {/* One hidden YAxis per type -> each series autoscales on its own range, using the full vertical space */}
                    {selectedTypes.map(t => (
                      <YAxis
                        key={t}
                        yAxisId={t}
                        hide
                        domain={["auto", "auto"]}
                      />
                    ))}
                    <Tooltip content={<CustomTooltip />} />
                    {selectedTypes.map(t => {
                      const meta = getMeta(t)
                      return (
                        <Line
                          key={t}
                          yAxisId={t}
                          type="monotone"
                          dataKey={t}
                          stroke={meta.color}
                          strokeWidth={2}
                          dot={aggregation === "none" ? { r: 2 } : false}
                          connectNulls
                          name={meta.label}
                        />
                      )
                    })}
                    {selStart && selEnd && selStart !== selEnd && (
                      <ReferenceArea
                        yAxisId={selectedTypes[0]}
                        x1={selStart < selEnd ? selStart : selEnd}
                        x2={selStart < selEnd ? selEnd : selStart}
                        strokeOpacity={0.3}
                        fill="#3b82f6"
                        fillOpacity={0.15}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>

                {/* Selection popover (after mouseUp) */}
                {!isDragging && selStart && selEnd && selStart !== selEnd && popoverCoord && selectionStats && (
                  <div
                    className="absolute z-10 bg-card border rounded-lg shadow-lg p-3 text-sm min-w-[220px]"
                    style={{
                      left: Math.min(Math.max(popoverCoord.x - 110, 8), 600),
                      top: Math.max(popoverCoord.y - 160, 8),
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {tooltipLabel(selStart < selEnd ? selStart : selEnd)}
                        <br />→ {tooltipLabel(selStart < selEnd ? selEnd : selStart)}
                      </div>
                      <button
                        type="button"
                        className="h-5 w-5 rounded hover:bg-accent inline-flex items-center justify-center shrink-0"
                        onClick={clearSelection}
                        aria-label="Chiudi"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="space-y-1 pt-1 border-t">
                      {selectionStats.map(s => {
                        if (s.delta === null || s.first === null || s.last === null) {
                          return (
                            <div key={s.type} className="flex justify-between items-center gap-4 text-xs">
                              <span className="flex items-center gap-1.5">
                                <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.meta.color }} />
                                {s.meta.label}
                              </span>
                              <span className="text-muted-foreground">nessun dato</span>
                            </div>
                          )
                        }
                        const sign = s.delta > 0 ? "+" : ""
                        const color =
                          Math.abs(s.delta) < 0.01 ? "text-muted-foreground"
                          : s.delta > 0 ? "text-red-500"
                          : "text-green-500"
                        const fmt = (v: number) =>
                          s.meta.formatValue ? s.meta.formatValue(v) : v.toLocaleString("it-IT", { maximumFractionDigits: 2 })
                        return (
                          <div key={s.type} className="flex justify-between items-center gap-4">
                            <span className="flex items-center gap-1.5 text-xs">
                              <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.meta.color }} />
                              {s.meta.label}
                            </span>
                            <span className="tabular-nums text-right">
                              <span className={`font-semibold ${color}`}>
                                {sign}{fmt(s.delta)}
                                <span className="text-muted-foreground text-[10px] font-normal ml-0.5">{s.meta.displayUnit}</span>
                              </span>
                              <span className="block text-[10px] text-muted-foreground">
                                {fmt(s.first)} → {fmt(s.last)} ({s.n})
                              </span>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Tutti i campioni
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({tableRows.length} risultati)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && <div className="h-40 animate-pulse bg-muted rounded" />}
            {!isLoading && tableRows.length === 0 && (
              <p className="text-muted-foreground py-4">Nessun campione</p>
            )}
            {!isLoading && tableRows.length > 0 && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Metrica</TableHead>
                      <TableHead className="text-right">Valore</TableHead>
                      <TableHead>Sorgente</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map(r => {
                      const meta = getMeta(r.type)
                      const v = r.value * meta.unitMultiplier
                      const formatted = meta.formatValue ? meta.formatValue(v) : v.toLocaleString("it-IT", { maximumFractionDigits: 2 })
                      return (
                        <TableRow key={`${r.uuid}-${r.type}`}>
                          <TableCell className="tabular-nums">{formatDateTime(r.start_date)}</TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="inline-block w-2 h-2 rounded-full" style={{ background: meta.color }} />
                              {meta.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {formatted} <span className="text-muted-foreground text-xs font-normal">{meta.displayUnit}</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{r.source_name ?? "-"}</TableCell>
                          <TableCell>
                            {r.id !== undefined && (
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={(e) => askDelete(r, e)} aria-label="Elimina"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-3 text-sm">
                    <span className="text-muted-foreground">
                      Pagina {page + 1} di {totalPages}
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                        Precedente
                      </Button>
                      <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>
                        Successiva
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {showMobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileFilters(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[85%] max-w-[360px] bg-background shadow-xl">
            <BodyFiltersSidebar
              value={filters}
              onChange={setFilters}
              availableSources={availableSources}
              availableYears={availableYears}
              onClose={() => setShowMobileFilters(false)}
            />
          </div>
        </div>
      )}

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
