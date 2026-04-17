import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { AggregatedPoint, Sample } from "@/lib/types"
import { getMeta } from "@/lib/healthkit"

interface Props {
  type: string
  data: Sample[] | AggregatedPoint[]
  aggregation: "none" | "hourly" | "daily" | "weekly" | "monthly"
  chartType?: "line" | "area" | "bar"
  height?: number
}

function isAggregated(data: any[]): data is AggregatedPoint[] {
  return data.length > 0 && "period_start" in data[0]
}

export function TimeSeriesChart({ type, data, aggregation, chartType = "line", height = 300 }: Props) {
  const meta = getMeta(type)

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground" style={{ height }}>
        Nessun dato nel periodo selezionato
      </div>
    )
  }

  const formatted = isAggregated(data)
    ? [...data].reverse().map(d => ({
        time: d.period_start,
        value: d.avg * meta.unitMultiplier,
        min: d.min * meta.unitMultiplier,
        max: d.max * meta.unitMultiplier,
        count: d.count,
      }))
    : [...data].reverse().map(d => ({
        time: d.start_date,
        value: d.value * meta.unitMultiplier,
      }))

  const dateFormatter = (iso: string) => {
    const d = new Date(iso)
    if (aggregation === "hourly") return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    if (aggregation === "monthly") return d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" })
    if (aggregation === "weekly") return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
  }

  const valueFormatter = (v: number) => {
    const f = meta.formatValue ? meta.formatValue(v) : v.toLocaleString("it-IT", { maximumFractionDigits: 1 })
    return `${f} ${meta.displayUnit}`
  }

  const ChartComp = chartType === "area" ? AreaChart : chartType === "bar" ? BarChart : LineChart

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ChartComp data={formatted}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="time" tickFormatter={dateFormatter} minTickGap={40} tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip
          labelFormatter={dateFormatter}
          formatter={(v: number) => [valueFormatter(v), meta.label]}
          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
        />
        {chartType === "line" && <Line dataKey="value" stroke={meta.color} strokeWidth={2} dot={false} />}
        {chartType === "area" && <Area dataKey="value" stroke={meta.color} fill={meta.color} fillOpacity={0.2} strokeWidth={2} />}
        {chartType === "bar" && <Bar dataKey="value" fill={meta.color} />}
      </ChartComp>
    </ResponsiveContainer>
  )
}
