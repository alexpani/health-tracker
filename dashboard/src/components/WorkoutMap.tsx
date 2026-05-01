import { useEffect, useMemo, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RoutePoint } from "@/lib/types"

export interface TimeSeriesPoint {
  time: string
  value: number
}

/// Range di indici GPS da evidenziare sulla mappa (start incluso, end incluso).
export interface HighlightRange {
  startIdx: number
  endIdx: number
}

interface Props {
  points: RoutePoint[]
  hoverIndex: number | null
  onHover?: (index: number | null) => void
  /// Sample HR ordinati per timestamp (ASC). Usati per arricchire il
  /// tooltip al hover sui segmenti della polyline.
  hrSeries?: TimeSeriesPoint[]
  /// Se valorizzato, disegna una polyline blu spessa sopra i segmenti GPS
  /// nel range [startIdx, endIdx]. Usato dalla tabella "Parziali" per
  /// evidenziare il km cliccato.
  highlightedRange?: HighlightRange | null
}

interface Segment {
  from: number
  to: number
  paceSecPerKm: number | null
  speedMs: number | null
  hrAvg: number | null
  midLat: number
  midLon: number
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

// Pace → colore. Verde (veloce) → giallo (medio) → rosso (lento).
function paceColor(paceSecPerKm: number | null): string {
  if (paceSecPerKm === null || !isFinite(paceSecPerKm)) return "#888"
  const p = Math.max(240, Math.min(480, paceSecPerKm))
  const t = (p - 240) / (480 - 240)
  const hue = (1 - t) * 120
  return `hsl(${hue.toFixed(0)}, 80%, 45%)`
}

function formatPace(secPerKm: number | null): string {
  if (secPerKm === null || !isFinite(secPerKm) || secPerKm <= 0) return "—"
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm - m * 60)
  if (s === 60) return `${m + 1}:00/km`
  return `${m}:${s.toString().padStart(2, "0")}/km`
}

function hrAverageInWindow(
  series: TimeSeriesPoint[],
  startTs: number,
  endTs: number
): number | null {
  if (series.length === 0) return null
  let lo = 0
  let hi = series.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (new Date(series[mid].time).getTime() < startTs) lo = mid + 1
    else hi = mid
  }
  let sum = 0
  let count = 0
  for (let i = lo; i < series.length; i++) {
    const t = new Date(series[i].time).getTime()
    if (t > endTs) break
    sum += series[i].value
    count++
  }
  if (count > 0) return sum / count
  const mid = (startTs + endTs) / 2
  const tolerance = 30_000
  let bestIdx = -1
  let bestDelta = Infinity
  const candidates = [lo - 1, lo].filter(i => i >= 0 && i < series.length)
  for (const i of candidates) {
    const d = Math.abs(new Date(series[i].time).getTime() - mid)
    if (d < bestDelta) { bestDelta = d; bestIdx = i }
  }
  return bestIdx >= 0 && bestDelta <= tolerance ? series[bestIdx].value : null
}

function buildSegments(points: RoutePoint[], hrSeries?: TimeSeriesPoint[]): Segment[] {
  if (points.length < 2) return []
  const out: Segment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const tA = new Date(a.ts).getTime()
    const tB = new Date(b.ts).getTime()
    const dt = (tB - tA) / 1000
    const dx = haversineMeters(a, b)
    const speedMs = dt > 0 ? dx / dt : null
    const paceSecPerKm = speedMs && speedMs > 0.1 ? 1000 / speedMs : null
    const hrAvg = hrSeries && hrSeries.length > 0 ? hrAverageInWindow(hrSeries, tA, tB) : null
    out.push({
      from: i,
      to: i + 1,
      paceSecPerKm,
      speedMs,
      hrAvg,
      midLat: (a.lat + b.lat) / 2,
      midLon: (a.lon + b.lon) / 2,
    })
  }
  return out
}

function tooltipHtml(seg: Segment, ts: string): string {
  const speedKmh = seg.speedMs !== null ? (seg.speedMs * 3.6).toFixed(2) : "—"
  const pace = formatPace(seg.paceSecPerKm)
  const time = new Date(ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  const hrLine = seg.hrAvg !== null
    ? `<div style="color:#ef4444">♥ ${Math.round(seg.hrAvg)} bpm</div>`
    : ""
  return `
    <div style="font-size:11px;line-height:1.35">
      <div style="color:#666;margin-bottom:2px">${time}</div>
      <div><strong>${speedKmh} km/h</strong> · ${pace}</div>
      ${hrLine}
    </div>
  `
}

// Preset altezze (px). "default" = altezza iniziale al mount.
const HEIGHT_PRESETS = { S: 300, M: 500, L: 800 } as const
const DEFAULT_HEIGHT = HEIGHT_PRESETS.M

export function WorkoutMap({ points, hoverIndex, onHover, hrSeries, highlightedRange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const cursorMarkerRef = useRef<L.CircleMarker | null>(null)
  const polylinesRef = useRef<L.Polyline[]>([])
  const highlightLineRef = useRef<L.Polyline | null>(null)

  const [height, setHeight] = useState<number>(DEFAULT_HEIGHT)
  const [fullscreen, setFullscreen] = useState<boolean>(false)

  const segments = useMemo(() => buildSegments(points, hrSeries), [points, hrSeries])

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { preferCanvas: true })
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Watch container size changes (drag-resize via CSS resize:vertical, preset
  // changes, fullscreen toggle): Leaflet needs invalidateSize() to redraw
  // tiles correctly when the container size changes outside its knowledge.
  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(() => {
      mapRef.current?.invalidateSize()
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  // Render segments + start/end markers when points change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    polylinesRef.current.forEach(p => p.remove())
    polylinesRef.current = []
    cursorMarkerRef.current?.remove()
    cursorMarkerRef.current = null
    map.eachLayer(layer => {
      if (layer instanceof L.Marker) layer.remove()
    })

    if (points.length === 0) return

    segments.forEach(seg => {
      const a = points[seg.from]
      const b = points[seg.to]
      const line = L.polyline(
        [
          [a.lat, a.lon],
          [b.lat, b.lon],
        ],
        {
          color: paceColor(seg.paceSecPerKm),
          weight: 5,
          opacity: 0.85,
          lineCap: "round",
        }
      )
      line.bindTooltip(tooltipHtml(seg, points[seg.from].ts), {
        sticky: true,
        direction: "top",
        opacity: 0.95,
        offset: [0, -4],
      })
      line.on("mouseover", () => onHover?.(seg.from))
      line.on("mouseout", () => onHover?.(null))
      line.addTo(map)
      polylinesRef.current.push(line)
    })

    const start = points[0]
    const end = points[points.length - 1]
    const startIcon = L.divIcon({
      className: "",
      html: '<div style="background:#10b981;border:2px solid white;border-radius:50%;width:14px;height:14px;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })
    const endIcon = L.divIcon({
      className: "",
      html: '<div style="background:#ef4444;border:2px solid white;border-radius:50%;width:14px;height:14px;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })
    L.marker([start.lat, start.lon], { icon: startIcon, title: "Partenza" })
      .addTo(map).bindTooltip("Partenza", { direction: "top", offset: [0, -8] })
    L.marker([end.lat, end.lon], { icon: endIcon, title: "Arrivo" })
      .addTo(map).bindTooltip("Arrivo", { direction: "top", offset: [0, -8] })

    cursorMarkerRef.current = L.circleMarker([start.lat, start.lon], {
      radius: 6, color: "#3b82f6", weight: 2, fillColor: "#fff", fillOpacity: 1,
    })

    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon]))
    map.fitBounds(bounds, { padding: [24, 24] })
  }, [points, segments, onHover])

  // Update cursor marker position when hoverIndex changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (hoverIndex === null || hoverIndex < 0 || hoverIndex >= points.length) {
      cursorMarkerRef.current?.remove()
      return
    }
    const p = points[hoverIndex]
    if (!cursorMarkerRef.current) {
      cursorMarkerRef.current = L.circleMarker([p.lat, p.lon], {
        radius: 6, color: "#3b82f6", weight: 2, fillColor: "#fff", fillOpacity: 1,
      })
    } else {
      cursorMarkerRef.current.setLatLng([p.lat, p.lon])
    }
    if (!map.hasLayer(cursorMarkerRef.current)) {
      cursorMarkerRef.current.addTo(map)
    }
  }, [hoverIndex, points])

  // Highlight a range of GPS points (for "Parziali" click): blue thick
  // polyline drawn on top of the colored ones, plus auto fitBounds to it.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    highlightLineRef.current?.remove()
    highlightLineRef.current = null
    if (!highlightedRange || points.length === 0) return
    const { startIdx, endIdx } = highlightedRange
    const lo = Math.max(0, Math.min(startIdx, endIdx))
    const hi = Math.min(points.length - 1, Math.max(startIdx, endIdx))
    if (hi <= lo) return
    const slice = points.slice(lo, hi + 1).map(p => [p.lat, p.lon] as [number, number])
    const line = L.polyline(slice, {
      color: "#2563eb",
      weight: 7,
      opacity: 0.85,
      lineCap: "round",
      lineJoin: "round",
    })
    line.addTo(map)
    line.bringToFront()
    highlightLineRef.current = line
    map.fitBounds(L.latLngBounds(slice), { padding: [40, 40], maxZoom: 17 })
  }, [highlightedRange, points])

  function applyPreset(p: keyof typeof HEIGHT_PRESETS) {
    setHeight(HEIGHT_PRESETS[p])
  }

  // Fullscreen wrapper styles applied to the outermost div.
  const wrapperStyle: React.CSSProperties = fullscreen
    ? { position: "fixed", inset: 0, zIndex: 50, background: "white", padding: 8 }
    : {}

  // Map container height: in fullscreen prendi tutto lo spazio del wrapper
  // (calc 100% - control bar); in normal mode usa lo state `height`, con
  // `resize: vertical` per il drag handle nativo del browser.
  const mapStyle: React.CSSProperties = fullscreen
    ? { height: "calc(100% - 44px)", width: "100%" }
    : { height: `${height}px`, width: "100%", resize: "vertical", overflow: "hidden", minHeight: 200, maxHeight: 1200 }

  return (
    <div ref={wrapperRef} style={wrapperStyle} className={fullscreen ? "" : "relative"}>
      {/* Control bar */}
      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className="text-muted-foreground">Dimensione:</span>
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => applyPreset("S")}>S</Button>
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => applyPreset("M")}>M</Button>
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => applyPreset("L")}>L</Button>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          onClick={() => setFullscreen(f => !f)}
          title={fullscreen ? "Esci da schermo intero" : "Schermo intero"}
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Map container — when not fullscreen, the user can drag the bottom-right
          corner to resize vertically thanks to `resize: vertical`. */}
      <div ref={containerRef} style={mapStyle} className="rounded-md border" />

      {/* Pace legend — only when not fullscreen (in fullscreen the map covers
          the whole viewport and the legend would be lost). */}
      {!fullscreen && (
        <div className="absolute bottom-2 left-2 z-[400] bg-white/90 px-2 py-1 rounded text-[10px] text-muted-foreground pointer-events-none">
          Pace: <span style={{ color: paceColor(240) }}>● veloce</span>{" "}
          <span style={{ color: paceColor(360) }}>● medio</span>{" "}
          <span style={{ color: paceColor(480) }}>● lento</span>
        </div>
      )}
    </div>
  )
}
