import { useMemo, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLabAnalytes, useLabTimeseries, useSamples } from "@/lib/queries"
import type { LabAnalyte, LabTimeseriesResponse, SamplesResponse } from "@/lib/types"
import { cn } from "@/lib/utils"

const MAX_SERIES = 5
const COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"]
const PRESETS: { label: string; months: number | null }[] = [
  { label: "Tutto", months: null },
  { label: "12 mesi", months: 12 },
  { label: "3 anni", months: 36 },
  { label: "5 anni", months: 60 },
]
const DEFAULT_PRESET_IDX = 0 // "Tutto"

// Analiti "virtuali" non-lab: vivono dentro HealthKit. Condividono il UI degli
// analiti lab per la tab Andamenti così si possono sovrapporre a valori lab.
interface BodyMetric {
  slug: string // prefisso "__hk_"
  label: string
  unit: string
  hkType: string
  multiplier?: number
}

const BODY_METRICS: BodyMetric[] = [
  {
    slug: "__hk_body_mass",
    label: "Peso corporeo",
    unit: "kg",
    hkType: "HKQuantityTypeIdentifierBodyMass",
  },
  {
    slug: "__hk_body_fat",
    label: "Massa grassa",
    unit: "%",
    hkType: "HKQuantityTypeIdentifierBodyFatPercentage",
    multiplier: 100,
  },
  {
    slug: "__hk_bmi",
    label: "Indice di massa corporea",
    unit: "",
    hkType: "HKQuantityTypeIdentifierBodyMassIndex",
  },
]

function isBodyMetricSlug(slug: string): boolean {
  return slug.startsWith("__hk_")
}

function findBodyMetric(slug: string): BodyMetric | undefined {
  return BODY_METRICS.find(m => m.slug === slug)
}

// Analiti "derivati": calcolati client-side da due serie lab.
interface DerivedAnalyte {
  slug: string
  label: string
  category: string
  unit: string
  refLow: number | null
  refHigh: number | null
  refText: string
  sourceSlugs: [string, string] // numeratore, denominatore
}

const DERIVED_ANALYTES: DerivedAnalyte[] = [
  {
    slug: "__derived_chol_ratio",
    label: "Rapporto Col.tot / HDL",
    category: "lipidi",
    unit: "",
    refLow: null,
    refHigh: 5,
    refText: "<3.5 rischio molto basso · <5 basso · >5 elevato",
    sourceSlugs: ["cholesterol_total", "cholesterol_hdl"],
  },
]

function isDerivedSlug(slug: string): boolean {
  return slug.startsWith("__derived_")
}

function findDerived(slug: string): DerivedAnalyte | undefined {
  return DERIVED_ANALYTES.find(d => d.slug === slug)
}

const CATEGORY_ORDER = ["lipidi", "fegato", "ormoni", "metabolismo"]

function sortCategoryEntries<T>(entries: [string, T][]): [string, T][] {
  const order = new Map(CATEGORY_ORDER.map((c, i) => [c, i]))
  return [...entries].sort(([a], [b]) => {
    const ia = order.has(a) ? order.get(a)! : 1000
    const ib = order.has(b) ? order.get(b)! : 1000
    if (ia !== ib) return ia - ib
    return a.localeCompare(b)
  })
}

export default function LabTrends({ initialSlug }: { initialSlug?: string | null }) {
  const { data: analytes } = useLabAnalytes()
  const [selected, setSelected] = useState<string[]>(
    initialSlug ? [initialSlug] : ["__hk_body_mass"]
  )
  const [presetIdx, setPresetIdx] = useState(DEFAULT_PRESET_IDX)

  const byCategory = useMemo(() => {
    const m = new Map<string, LabAnalyte[]>()
    analytes?.forEach(a => {
      const arr = m.get(a.category) ?? []
      arr.push(a)
      m.set(a.category, arr)
    })
    // Inietta gli analiti derivati come pseudo-LabAnalyte nella categoria
    // corrispondente (es. "lipidi").
    DERIVED_ANALYTES.forEach(d => {
      const arr = m.get(d.category) ?? []
      arr.push({
        id: -1_000_000 - arr.length,
        slug: d.slug,
        display_name_it: d.label,
        category: d.category,
        specimen: "blood",
        value_type: "numeric",
        unit_canonical: d.unit || null,
        ref_low: d.refLow,
        ref_high: d.refHigh,
        ref_text: d.refText,
        aliases: [],
      })
      m.set(d.category, arr)
    })
    return sortCategoryEntries(Array.from(m.entries()))
  }, [analytes])

  const { start, end } = useMemo(() => computeRange(PRESETS[presetIdx].months), [presetIdx])

  function toggle(slug: string) {
    setSelected(prev => {
      if (prev.includes(slug)) return prev.filter(s => s !== slug)
      if (prev.length >= MAX_SERIES) return prev
      return [...prev, slug]
    })
  }

  const DEFAULT_SELECTED = ["__hk_body_mass"]
  const isDefaultState =
    selected.length === DEFAULT_SELECTED.length &&
    selected.every((s, i) => s === DEFAULT_SELECTED[i]) &&
    presetIdx === DEFAULT_PRESET_IDX

  function resetFilters() {
    setSelected([...DEFAULT_SELECTED])
    setPresetIdx(DEFAULT_PRESET_IDX)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-4">
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Periodo</span>
          <Button
            variant="outline"
            size="sm"
            onClick={resetFilters}
            disabled={isDefaultState}
            title={
              isDefaultState
                ? "Nessun filtro attivo"
                : "Pulisci analiti + torna al preset di default"
            }
            className="h-6 text-xs"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => setPresetIdx(i)}
              className={cn(
                "text-xs px-2 py-1 rounded border",
                i === presetIdx
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-accent"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="text-xs text-muted-foreground">
          {selected.length > 0
            ? `${selected.length} / ${MAX_SERIES} analiti selezionati`
            : `Seleziona fino a ${MAX_SERIES} analiti.`}
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          <div>
            <div className="text-sm font-semibold text-foreground mb-1.5 sticky top-0 bg-background py-1 border-b">
              Corpo (Apple Health)
            </div>
            <div className="flex flex-wrap gap-1">
              {BODY_METRICS.map(m => {
                const isOn = selected.includes(m.slug)
                const idx = selected.indexOf(m.slug)
                return (
                  <button
                    key={m.slug}
                    onClick={() => toggle(m.slug)}
                    className={cn(
                      "text-xs px-2 py-1 rounded border",
                      isOn
                        ? "border-transparent text-white"
                        : "bg-background hover:bg-accent border-border"
                    )}
                    style={isOn ? { backgroundColor: COLORS[idx % COLORS.length] } : undefined}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          {byCategory.map(([cat, items]) => (
            <div key={cat}>
              <div className="text-sm font-semibold text-foreground mb-1.5 sticky top-0 bg-background py-1 border-b capitalize">
                {cat}
              </div>
              <div className="flex flex-wrap gap-1">
                {items.map(a => {
                  const isOn = selected.includes(a.slug)
                  const idx = selected.indexOf(a.slug)
                  return (
                    <button
                      key={a.id}
                      onClick={() => toggle(a.slug)}
                      className={cn(
                        "text-xs px-2 py-1 rounded border",
                        isOn
                          ? "border-transparent text-white"
                          : "bg-background hover:bg-accent border-border"
                      )}
                      style={isOn ? { backgroundColor: COLORS[idx % COLORS.length] } : undefined}
                    >
                      {a.display_name_it}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <div className="space-y-3">
        {selected.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Seleziona un analita dalla sidebar.
          </p>
        ) : (
          selected.map((slug, idx) => {
            const color = COLORS[idx % COLORS.length]
            if (isBodyMetricSlug(slug))
              return (
                <HkSeriesCard
                  key={slug}
                  slug={slug}
                  color={color}
                  start={start}
                  end={end}
                  onRemove={() => toggle(slug)}
                />
              )
            if (isDerivedSlug(slug))
              return (
                <DerivedSeriesCard
                  key={slug}
                  slug={slug}
                  color={color}
                  start={start}
                  end={end}
                  onRemove={() => toggle(slug)}
                />
              )
            return (
              <SeriesCard
                key={slug}
                slug={slug}
                color={color}
                start={start}
                end={end}
                onRemove={() => toggle(slug)}
              />
            )
          })
        )}
      </div>
    </div>
  )
}

function SeriesCard({
  slug,
  color,
  start,
  end,
  onRemove,
}: {
  slug: string
  color: string
  start: string | undefined
  end: string | undefined
  onRemove: () => void
}) {
  const { data, isLoading, error } = useLabTimeseries(slug, { start, end })
  const chartData = useMemo(() => buildChartData(data), [data])

  if (isLoading) return <div className="border rounded p-3 text-sm">Caricamento {slug}…</div>
  if (error || !data)
    return <div className="border rounded p-3 text-sm text-red-600">Errore su {slug}</div>
  if (chartData.length === 0) {
    return (
      <div className="border rounded p-3 text-sm text-muted-foreground">
        {data.analyte.display_name_it}: nessun valore confermato nel periodo.
      </div>
    )
  }

  const { ref_low, ref_high } = data.analyte
  return (
    <div className="border rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-medium" style={{ color }}>
            {data.analyte.display_name_it}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            {data.analyte.unit_canonical ?? ""}
            {ref_low != null || ref_high != null
              ? ` · rif ${ref_low ?? "-"}–${ref_high ?? "-"}`
              : ""}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="h-56">
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="test_date"
              tick={{ fontSize: 11 }}
              tickFormatter={v => v.slice(2, 7)}
            />
            <YAxis tick={{ fontSize: 11 }} />
            {(ref_low != null || ref_high != null) && (
              <ReferenceArea
                // Se un lato manca, usa dataMin/dataMax del dominio Recharts
                // → la banda verde copre sempre tutta la zona "nella norma".
                y1={ref_low ?? "dataMin"}
                y2={ref_high ?? "dataMax"}
                fill="#10b981"
                fillOpacity={0.18}
                stroke="#10b981"
                strokeOpacity={0.35}
                strokeDasharray="3 3"
                ifOverflow="visible"
              />
            )}
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(v: number) => [v, data.analyte.display_name_it]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={(props: { cx?: number; cy?: number; payload?: ChartPoint }) => {
                const p = props.payload
                const isOor = p?.out_of_range === true
                return (
                  <circle
                    key={`${p?.test_date}-${p?.value}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={isOor ? 5 : 3}
                    fill={isOor ? "#ef4444" : color}
                    stroke={isOor ? "#991b1b" : color}
                  />
                )
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

type ChartPoint = {
  test_date: string
  value: number | null
  out_of_range: boolean | null
}

function buildChartData(data: LabTimeseriesResponse | undefined): ChartPoint[] {
  if (!data) return []
  return data.points
    .filter(p => p.value_numeric != null)
    .map(p => ({
      test_date: p.test_date,
      value: p.value_numeric,
      out_of_range: p.out_of_range,
    }))
}

function computeRange(months: number | null): { start?: string; end?: string } {
  if (months == null) return {}
  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - months)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function DerivedSeriesCard({
  slug,
  color,
  start,
  end,
  onRemove,
}: {
  slug: string
  color: string
  start: string | undefined
  end: string | undefined
  onRemove: () => void
}) {
  const d = findDerived(slug)
  const numQ = useLabTimeseries(d?.sourceSlugs[0], { start, end })
  const denQ = useLabTimeseries(d?.sourceSlugs[1], { start, end })

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!d || !numQ.data || !denQ.data) return []
    const byDateNum = new Map<string, number>()
    numQ.data.points.forEach(p => {
      if (p.value_numeric != null) byDateNum.set(p.test_date, p.value_numeric)
    })
    const out: ChartPoint[] = []
    for (const p of denQ.data.points) {
      if (p.value_numeric == null || p.value_numeric === 0) continue
      const n = byDateNum.get(p.test_date)
      if (n == null) continue
      const ratio = n / p.value_numeric
      out.push({
        test_date: p.test_date,
        value: Number(ratio.toFixed(2)),
        out_of_range: d.refHigh != null && ratio > d.refHigh,
      })
    }
    return out.sort((a, b) => a.test_date.localeCompare(b.test_date))
  }, [d, numQ.data, denQ.data])

  if (!d) return null
  const isLoading = numQ.isLoading || denQ.isLoading
  const error = numQ.error || denQ.error

  if (isLoading)
    return <div className="border rounded p-3 text-sm">Caricamento {d.label}…</div>
  if (error)
    return (
      <div className="border rounded p-3 text-sm text-red-600">
        Errore su {d.label}
      </div>
    )
  if (chartData.length === 0) {
    return (
      <div className="border rounded p-3 text-sm text-muted-foreground flex items-center justify-between">
        <span>
          {d.label}: serve almeno un panel con {d.sourceSlugs[0]} E{" "}
          {d.sourceSlugs[1]}.
        </span>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    )
  }

  return (
    <div className="border rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-medium" style={{ color }}>
            {d.label}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            {d.refText}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="h-56">
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="test_date"
              tick={{ fontSize: 11 }}
              tickFormatter={v => v.slice(2, 7)}
            />
            <YAxis tick={{ fontSize: 11 }} />
            {/* Banda "rischio molto basso" sotto 3.5 — verde intenso */}
            {d.slug === "__derived_chol_ratio" && (
              <ReferenceArea
                y1={0}
                y2={3.5}
                fill="#10b981"
                fillOpacity={0.22}
                stroke="#10b981"
                strokeOpacity={0.35}
                strokeDasharray="3 3"
                ifOverflow="visible"
              />
            )}
            {/* Banda "basso" 3.5–5 — ambra tenue */}
            {d.slug === "__derived_chol_ratio" && (
              <ReferenceArea
                y1={3.5}
                y2={5}
                fill="#f59e0b"
                fillOpacity={0.15}
                ifOverflow="visible"
              />
            )}
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(v: number) => [v.toFixed(2), d.label]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={(props: { cx?: number; cy?: number; payload?: ChartPoint }) => {
                const p = props.payload
                const isOor = p?.out_of_range === true
                return (
                  <circle
                    key={`${p?.test_date}-${p?.value}`}
                    cx={props.cx}
                    cy={props.cy}
                    r={isOor ? 5 : 3}
                    fill={isOor ? "#ef4444" : color}
                    stroke={isOor ? "#991b1b" : color}
                  />
                )
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function HkSeriesCard({
  slug,
  color,
  start,
  end,
  onRemove,
}: {
  slug: string
  color: string
  start: string | undefined
  end: string | undefined
  onRemove: () => void
}) {
  const metric = findBodyMetric(slug)
  const startIso = start ? `${start}T00:00:00Z` : undefined
  const endIso = end ? `${end}T23:59:59Z` : undefined
  const query = useSamples(
    {
      type: metric?.hkType ?? "",
      start: startIso,
      end: endIso,
      aggregation: "none",
      limit: 5000,
    },
    !!metric
  )

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!query.data) return []
    const mul = metric?.multiplier ?? 1
    const raw = query.data.data as Array<{ start_date: string; value: number }>
    return raw
      .map(s => ({
        test_date: s.start_date.slice(0, 10),
        value: s.value * mul,
        out_of_range: null,
      }))
      .sort((a, b) => a.test_date.localeCompare(b.test_date))
  }, [query.data, metric])

  if (!metric) return null
  if (query.isLoading)
    return <div className="border rounded p-3 text-sm">Caricamento {metric.label}…</div>
  if (query.error)
    return (
      <div className="border rounded p-3 text-sm text-red-600">
        Errore su {metric.label}
      </div>
    )
  if (chartData.length === 0) {
    return (
      <div className="border rounded p-3 text-sm text-muted-foreground flex items-center justify-between">
        <span>{metric.label}: nessun valore HK nel periodo.</span>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    )
  }

  return (
    <div className="border rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-medium" style={{ color }}>
            {metric.label}
          </span>
          <span className="text-xs text-muted-foreground ml-2">
            {metric.unit} · Apple Health
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="h-56">
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="test_date"
              tick={{ fontSize: 11 }}
              tickFormatter={v => v.slice(2, 7)}
            />
            <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              formatter={(v: number) => [
                Number(v).toFixed(1) + (metric.unit ? ` ${metric.unit}` : ""),
                metric.label,
              ]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={{ r: 2, fill: color, stroke: color }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
