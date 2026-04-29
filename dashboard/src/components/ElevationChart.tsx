import { useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { RoutePoint } from "@/lib/types"

interface Props {
  points: RoutePoint[]
  hoverIndex: number | null
  onHover?: (index: number | null) => void
}

interface ChartPoint {
  i: number
  km: number
  alt: number | null
  pace: number | null
  ts: string
}

function haversineMeters(a: RoutePoint, b: RoutePoint): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function formatPace(secPerKm: number | null): string {
  if (secPerKm === null || !isFinite(secPerKm) || secPerKm <= 0) return "—"
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${s.toString().padStart(2, "0")}/km`
}

export function ElevationChart({ points, hoverIndex, onHover }: Props) {
  const data = useMemo<ChartPoint[]>(() => {
    if (points.length === 0) return []
    let cumDist = 0
    const out: ChartPoint[] = []
    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        cumDist += haversineMeters(points[i - 1], points[i])
      }
      let pace: number | null = null
      if (i > 0) {
        const dt = (new Date(points[i].ts).getTime() - new Date(points[i - 1].ts).getTime()) / 1000
        const dx = haversineMeters(points[i - 1], points[i])
        if (dt > 0 && dx > 0.5) pace = (dt / dx) * 1000
      }
      out.push({
        i,
        km: cumDist / 1000,
        alt: points[i].alt ?? null,
        pace,
        ts: points[i].ts,
      })
    }
    return out
  }, [points])

  // If no altitude data anywhere, hide the chart.
  const hasAltitude = useMemo(() => data.some(d => d.alt !== null), [data])
  if (!hasAltitude || data.length < 2) return null

  const altOnly = data.filter(d => d.alt !== null) as Array<ChartPoint & { alt: number }>
  const minAlt = Math.min(...altOnly.map(d => d.alt))
  const maxAlt = Math.max(...altOnly.map(d => d.alt))
  const padding = Math.max(5, (maxAlt - minAlt) * 0.1)
  const cursorPoint = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < data.length ? data[hoverIndex] : null

  return (
    <div className="w-full h-[160px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          onMouseMove={(e: any) => {
            if (e?.activePayload?.[0]?.payload) {
              onHover?.(e.activePayload[0].payload.i)
            }
          }}
          onMouseLeave={() => onHover?.(null)}
        >
          <CartesianGrid stroke="#eee" strokeDasharray="3 3" />
          <XAxis
            dataKey="km"
            type="number"
            domain={[0, "dataMax"]}
            tickFormatter={(v: number) => `${v.toFixed(1)}`}
            label={{ value: "km", position: "insideBottomRight", offset: -2, fontSize: 10 }}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            domain={[Math.floor(minAlt - padding), Math.ceil(maxAlt + padding)]}
            tickFormatter={(v: number) => `${Math.round(v)}m`}
            tick={{ fontSize: 10 }}
            width={45}
          />
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload?.[0]) return null
              const p: ChartPoint = payload[0].payload
              return (
                <div className="bg-white border rounded shadow-sm px-2 py-1 text-xs">
                  <div><strong>{p.km.toFixed(2)} km</strong></div>
                  {p.alt !== null && <div>Quota: {Math.round(p.alt)} m</div>}
                  <div>Pace: {formatPace(p.pace)}</div>
                </div>
              )
            }}
          />
          <Area
            type="monotone"
            dataKey="alt"
            stroke="#6366f1"
            strokeWidth={2}
            fill="#6366f1"
            fillOpacity={0.18}
            isAnimationActive={false}
          />
          {cursorPoint && cursorPoint.alt !== null && (
            <ReferenceDot
              x={cursorPoint.km}
              y={cursorPoint.alt}
              r={5}
              fill="#3b82f6"
              stroke="#fff"
              strokeWidth={2}
              isFront
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
