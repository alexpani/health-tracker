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
import {
  formatDateShort,
  formatDateShortYear,
  formatDateTime,
  formatMonthYear,
  formatMonthYearLong,
  formatDateLong,
} from "@/lib/utils"

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

  const useSum = meta.aggregateBy === "sum"
  const formatted = isAggregated(data)
    ? [...data].reverse().map(d => ({
        time: d.period_start,
        // Cumulative types (steps, distance, calories, dietary) plot the
        // bucket SUM. Measurements (HR, weight, ...) plot the AVG.
        value: ((useSum && d.sum != null ? d.sum : d.avg)) * meta.unitMultiplier,
        min: d.min * meta.unitMultiplier,
        max: d.max * meta.unitMultiplier,
        count: d.count,
      }))
    : [...data].reverse().map(d => ({
        time: d.start_date,
        value: d.value * meta.unitMultiplier,
      }))

  // Detect whether the data spans more than one calendar year
  const years = new Set(formatted.map(d => new Date(d.time).getFullYear()))
  const multiYear = years.size > 1

  const dateFormatter = (iso: string) => {
    const d = new Date(iso)
    if (aggregation === "hourly") {
      return multiYear
        ? formatDateTime(d)
        : d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    }
    if (aggregation === "monthly") return formatMonthYear(d)
    if (aggregation === "weekly") {
      return multiYear ? formatDateShortYear(d) : formatDateShort(d)
    }
    return multiYear ? formatDateShortYear(d) : formatDateShort(d)
  }

  // Full date for tooltip (always shows year)
  const tooltipLabel = (iso: string) => {
    const d = new Date(iso)
    if (aggregation === "hourly") return formatDateTime(d)
    if (aggregation === "monthly") return formatMonthYearLong(d)
    return formatDateLong(d)
  }

  const valueFormatter = (v: number) => {
    const f = meta.formatValue ? meta.formatValue(v) : v.toLocaleString("it-IT", { maximumFractionDigits: 1 })
    return `${f} ${meta.displayUnit}`
  }

  const ChartComp = chartType === "area" ? AreaChart : chartType === "bar" ? BarChart : LineChart

  // Compute a tight Y-axis domain: [min - padding, max + padding] with 5% margin.
  // For bar charts we keep 0 as baseline (otherwise bars look misleading).
  const values = formatted.map(d => d.value).filter(v => Number.isFinite(v))
  const dataMin = values.length ? Math.min(...values) : 0
  const dataMax = values.length ? Math.max(...values) : 1
  const range = dataMax - dataMin || Math.abs(dataMax) || 1
  const pad = range * 0.08
  const yDomain: [number | string, number | string] =
    chartType === "bar"
      ? [0, dataMax + pad]
      : [Math.max(0, dataMin - pad), dataMax + pad]

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ChartComp data={formatted}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="time" tickFormatter={dateFormatter} minTickGap={40} tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          domain={yDomain}
          tickFormatter={(v: number) =>
            typeof v === "number" ? v.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : String(v)
          }
        />
        <Tooltip
          labelFormatter={tooltipLabel}
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
