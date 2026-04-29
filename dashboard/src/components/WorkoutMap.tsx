import { useEffect, useMemo, useRef } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { RoutePoint } from "@/lib/types"

interface Props {
  points: RoutePoint[]
  hoverIndex: number | null
  onHover?: (index: number | null) => void
}

interface Segment {
  from: number
  to: number
  paceSecPerKm: number | null
  speedMs: number | null
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
// Pace tipico corsa: 240 s/km (4:00) molto veloce → 480 s/km (8:00) lento.
function paceColor(paceSecPerKm: number | null): string {
  if (paceSecPerKm === null || !isFinite(paceSecPerKm)) return "#888"
  const p = Math.max(240, Math.min(480, paceSecPerKm))
  // Normalize to 0..1 (0 = veloce/verde, 1 = lento/rosso)
  const t = (p - 240) / (480 - 240)
  // hue: 120 (verde) → 0 (rosso) passando per 60 (giallo)
  const hue = (1 - t) * 120
  return `hsl(${hue.toFixed(0)}, 80%, 45%)`
}

function buildSegments(points: RoutePoint[]): Segment[] {
  if (points.length < 2) return []
  const out: Segment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const dt = (new Date(b.ts).getTime() - new Date(a.ts).getTime()) / 1000
    const dx = haversineMeters(a, b)
    const speedMs = dt > 0 ? dx / dt : null
    const paceSecPerKm = speedMs && speedMs > 0.1 ? 1000 / speedMs : null
    out.push({
      from: i,
      to: i + 1,
      paceSecPerKm,
      speedMs,
      midLat: (a.lat + b.lat) / 2,
      midLon: (a.lon + b.lon) / 2,
    })
  }
  return out
}

export function WorkoutMap({ points, hoverIndex, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const cursorMarkerRef = useRef<L.CircleMarker | null>(null)
  const polylinesRef = useRef<L.Polyline[]>([])

  const segments = useMemo(() => buildSegments(points), [points])

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      // Disable default zoom control on touch devices? keep default for now.
      preferCanvas: true,
    })
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

  // Render segments + start/end markers when points change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Clear previous layers.
    polylinesRef.current.forEach(p => p.remove())
    polylinesRef.current = []
    cursorMarkerRef.current?.remove()
    cursorMarkerRef.current = null
    map.eachLayer(layer => {
      // Leaflet's tile layer is a TileLayer instance — keep it; remove markers and polylines we may have added.
      if (layer instanceof L.Marker || (layer instanceof L.Polyline && !(layer as any)._isTile)) {
        if (!(layer as any)._isTileLayer) {
          // marker/polyline cleanup is already done above for our refs; skip
        }
      }
    })

    if (points.length === 0) return

    // Polyline segments colored by pace.
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
      line.on("mouseover", () => onHover?.(seg.from))
      line.on("mouseout", () => onHover?.(null))
      line.addTo(map)
      polylinesRef.current.push(line)
    })

    // Start / end markers using divIcon (no asset URL issues with Vite).
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
      .addTo(map)
      .bindTooltip("Partenza", { direction: "top", offset: [0, -8] })
    L.marker([end.lat, end.lon], { icon: endIcon, title: "Arrivo" })
      .addTo(map)
      .bindTooltip("Arrivo", { direction: "top", offset: [0, -8] })

    // Cursor marker (sync with hoverIndex from elevation chart).
    cursorMarkerRef.current = L.circleMarker([start.lat, start.lon], {
      radius: 6,
      color: "#3b82f6",
      weight: 2,
      fillColor: "#fff",
      fillOpacity: 1,
    })

    // Fit bounds.
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
        radius: 6,
        color: "#3b82f6",
        weight: 2,
        fillColor: "#fff",
        fillOpacity: 1,
      })
    } else {
      cursorMarkerRef.current.setLatLng([p.lat, p.lon])
    }
    if (!map.hasLayer(cursorMarkerRef.current)) {
      cursorMarkerRef.current.addTo(map)
    }
  }, [hoverIndex, points])

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-[400px] rounded-md border" />
      <div className="absolute bottom-2 left-2 z-[400] bg-white/90 px-2 py-1 rounded text-[10px] text-muted-foreground pointer-events-none">
        Pace: <span style={{ color: paceColor(240) }}>● veloce</span>{" "}
        <span style={{ color: paceColor(360) }}>● medio</span>{" "}
        <span style={{ color: paceColor(480) }}>● lento</span>
      </div>
    </div>
  )
}
