import { useMemo } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useSamples } from "@/lib/queries"
import type { AdvancedFilters, AggregatedPoint, Aggregation, Sample } from "@/lib/types"

const SYS = "HKQuantityTypeIdentifierBloodPressureSystolic"
const DIA = "HKQuantityTypeIdentifierBloodPressureDiastolic"

interface Props {
  start?: string
  end?: string
  aggregation: Aggregation
  advanced: AdvancedFilters
  height?: number
}

interface MergedPoint {
  time: string
  sys: number | null
  dia: number | null
}

function pickValue(d: Sample | AggregatedPoint): number | null {
  if ("period_start" in d) return d.avg ?? null
  return d.value ?? null
}

function pickTime(d: Sample | AggregatedPoint): string {
  return "period_start" in d ? d.period_start : d.start_date
}

export function BloodPressureChart({ start, end, aggregation, advanced, height = 320 }: Props) {
  // value_min/max NON propagati: una soglia pensata per la sistolica
  // taglierebbe punti diastolici validi (e viceversa).
  const sysQ = useSamples({
    type: SYS,
    start,
    end,
    aggregation,
    sources: advanced.sources,
    devices: advanced.devices,
    limit: 2000,
  })
  const diaQ = useSamples({
    type: DIA,
    start,
    end,
    aggregation,
    sources: advanced.sources,
    devices: advanced.devices,
    limit: 2000,
  })

  const merged = useMemo<MergedPoint[]>(() => {
    const map = new Map<string, MergedPoint>()
    for (const d of (sysQ.data?.data ?? []) as (Sample | AggregatedPoint)[]) {
      const t = pickTime(d)
      const v = pickValue(d)
      const cur = map.get(t) ?? { time: t, sys: null, dia: null }
      cur.sys = v
      map.set(t, cur)
    }
    for (const d of (diaQ.data?.data ?? []) as (Sample | AggregatedPoint)[]) {
      const t = pickTime(d)
      const v = pickValue(d)
      const cur = map.get(t) ?? { time: t, sys: null, dia: null }
      cur.dia = v
      map.set(t, cur)
    }
    return Array.from(map.values()).sort((a, b) => (a.time < b.time ? -1 : 1))
  }, [sysQ.data, diaQ.data])

  const isLoading = sysQ.isLoading || diaQ.isLoading

  // X/Y formatters: clonati da TimeSeriesChart per evitare il refactor
  // dell'helper in un modulo condiviso (la logica e' compatta).
  const years = new Set(merged.map(d => new Date(d.time).getFullYear()))
  const multiYear = years.size > 1

  const dateFormatter = (iso: string) => {
    const d = new Date(iso)
    if (aggregation === "hourly") {
      return multiYear
        ? d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
        : d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    }
    if (aggregation === "monthly") return d.toLocaleDateString("it-IT", { month: "short", year: "2-digit" })
    if (aggregation === "weekly") {
      return multiYear
        ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })
        : d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })
    }
    return multiYear
      ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" })
      : d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
  }

  const tooltipLabel = (iso: string) => {
    const d = new Date(iso)
    if (aggregation === "hourly") {
      return d.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    }
    if (aggregation === "monthly") return d.toLocaleDateString("it-IT", { month: "long", year: "numeric" })
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })
  }

  // Y-axis tight domain — sis e dia condividono mmHg.
  const vals = merged.flatMap(p => [p.sys, p.dia].filter((v): v is number => v != null && Number.isFinite(v)))
  const dataMin = vals.length ? Math.min(...vals) : 0
  const dataMax = vals.length ? Math.max(...vals) : 1
  const range = dataMax - dataMin || Math.abs(dataMax) || 1
  const pad = range * 0.08
  const yDomain: [number, number] = [Math.max(0, dataMin - pad), dataMax + pad]

  if (isLoading) {
    return <div className="animate-pulse bg-muted rounded" style={{ height }} />
  }
  if (merged.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground" style={{ height }}>
        Nessun dato nel periodo selezionato
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={merged}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis dataKey="time" tickFormatter={dateFormatter} minTickGap={40} tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          domain={yDomain}
          tickFormatter={(v: number) => (typeof v === "number" ? Math.round(v).toString() : String(v))}
          label={{ value: "mmHg", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }}
        />
        <Tooltip
          labelFormatter={tooltipLabel}
          content={<BpTooltip />}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="sys" name="Sistolica" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
        <Line dataKey="dia" name="Diastolica" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  )
}

function BpTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null
  const sysEntry = payload.find((p: any) => p.dataKey === "sys")
  const diaEntry = payload.find((p: any) => p.dataKey === "dia")
  const sys = sysEntry?.value as number | null | undefined
  const dia = diaEntry?.value as number | null | undefined
  const labelText = label
    ? new Date(String(label)).toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" })
    : ""
  return (
    <div className="rounded-md border bg-card text-card-foreground shadow-md p-3 text-sm" style={{ minWidth: 200 }}>
      <div className="font-medium mb-2">{labelText}</div>
      <div className="space-y-1">
        {sys != null && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#ef4444" }} />
              Sistolica
            </span>
            <span className="tabular-nums">{Math.round(sys)} mmHg</span>
          </div>
        )}
        {dia != null && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "#3b82f6" }} />
              Diastolica
            </span>
            <span className="tabular-nums">{Math.round(dia)} mmHg</span>
          </div>
        )}
        {sys != null && dia != null && (
          <div className="flex items-center justify-between gap-3 pt-1 mt-1 border-t text-muted-foreground">
            <span>Differenziale</span>
            <span className="tabular-nums">{Math.round(sys - dia)} mmHg</span>
          </div>
        )}
      </div>
    </div>
  )
}
