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
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLabAnalytes, useLabTimeseries } from "@/lib/queries"
import type { LabAnalyte, LabTimeseriesResponse } from "@/lib/types"
import { cn } from "@/lib/utils"

const MAX_SERIES = 5
const COLORS = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"]
const PRESETS: { label: string; months: number | null }[] = [
  { label: "12 mesi", months: 12 },
  { label: "3 anni", months: 36 },
  { label: "5 anni", months: 60 },
  { label: "Tutto", months: null },
]

export default function LabTrends({ initialSlug }: { initialSlug?: string | null }) {
  const { data: analytes } = useLabAnalytes()
  const [selected, setSelected] = useState<string[]>(initialSlug ? [initialSlug] : [])
  const [presetIdx, setPresetIdx] = useState(0)

  const byCategory = useMemo(() => {
    const m = new Map<string, LabAnalyte[]>()
    analytes?.forEach(a => {
      const arr = m.get(a.category) ?? []
      arr.push(a)
      m.set(a.category, arr)
    })
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [analytes])

  const { start, end } = useMemo(() => computeRange(PRESETS[presetIdx].months), [presetIdx])

  function toggle(slug: string) {
    setSelected(prev => {
      if (prev.includes(slug)) return prev.filter(s => s !== slug)
      if (prev.length >= MAX_SERIES) return prev
      return [...prev, slug]
    })
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px,1fr] gap-4">
      <aside className="space-y-3">
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
          Seleziona fino a {MAX_SERIES} analiti.
        </div>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {byCategory.map(([cat, items]) => (
            <div key={cat}>
              <div className="text-xs font-semibold text-muted-foreground mb-1 sticky top-0 bg-background">
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
          selected.map((slug, idx) => (
            <SeriesCard
              key={slug}
              slug={slug}
              color={COLORS[idx % COLORS.length]}
              start={start}
              end={end}
              onRemove={() => toggle(slug)}
            />
          ))
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
            {ref_low != null && ref_high != null && (
              <ReferenceArea
                y1={ref_low}
                y2={ref_high}
                fill="#94a3b8"
                fillOpacity={0.12}
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
