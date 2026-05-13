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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatElapsed, mergeSeries, type ElapsedPoint } from "@/lib/compareUtils"

export interface CompareLineChartProps {
  title: string
  unit?: string
  seriesA: ElapsedPoint[]
  seriesB: ElapsedPoint[]
  labelA: string
  labelB: string
  /** Optional custom formatter for the tooltip value (e.g. pace mm:ss). */
  formatValue?: (v: number) => string
  height?: number
  /** Inverts the Y axis (useful for pace where lower = better). */
  reverseY?: boolean
}

const COLOR_A = "#3b82f6" // blue
const COLOR_B = "#f97316" // orange

export function CompareLineChart({
  title,
  unit,
  seriesA,
  seriesB,
  labelA,
  labelB,
  formatValue,
  height = 240,
  reverseY = false,
}: CompareLineChartProps) {
  const data = mergeSeries(seriesA, seriesB)
  const hasA = seriesA.length > 0
  const hasB = seriesB.length > 0

  if (!hasA && !hasB) return null

  const fmt = (v: number) => {
    if (formatValue) return formatValue(v)
    const rounded = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10
    return `${rounded}${unit ? ` ${unit}` : ""}`
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}{unit ? ` (${unit})` : ""}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatElapsed}
              tick={{ fontSize: 11 }}
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              reversed={reverseY}
              domain={["auto", "auto"]}
              tickFormatter={v => (formatValue ? formatValue(v as number) : String(v))}
              width={60}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const t = typeof label === "number" ? label : Number(label)
                const a = payload.find(p => p.dataKey === "a")?.value as number | null | undefined
                const b = payload.find(p => p.dataKey === "b")?.value as number | null | undefined
                return (
                  <div className="bg-card border rounded-lg shadow-md p-3 text-sm space-y-1">
                    <div className="font-medium tabular-nums">{formatElapsed(t)}</div>
                    {a != null && (
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_A }} />
                        <span className="text-muted-foreground">{labelA}:</span>
                        <span className="tabular-nums font-medium">{fmt(a)}</span>
                      </div>
                    )}
                    {b != null && (
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_B }} />
                        <span className="text-muted-foreground">{labelB}:</span>
                        <span className="tabular-nums font-medium">{fmt(b)}</span>
                      </div>
                    )}
                  </div>
                )
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {hasA && (
              <Line
                type="monotone"
                dataKey="a"
                name={labelA}
                stroke={COLOR_A}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
            {hasB && (
              <Line
                type="monotone"
                dataKey="b"
                name={labelB}
                stroke={COLOR_B}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
