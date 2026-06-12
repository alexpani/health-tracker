import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
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
import { ChevronLeft, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useSamples, useUpdateWorkout, useWorkoutByUuid, useWorkoutRoute, useWorkoutSplits } from "@/lib/queries"
import { WorkoutMap } from "@/components/WorkoutMap"
import { ElevationChart } from "@/components/ElevationChart"
import { HRZonesCard } from "@/components/HRZonesCard"
import { extractWorkoutMetadata, workoutDisplayTitle, workoutName } from "@/lib/healthkit"
import { formatDateTime, formatNumber } from "@/lib/utils"
import type { AggregatedPoint, Sample } from "@/lib/types"

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "-"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
               : `${m}:${String(s).padStart(2, "0")}`
}

function formatPace(secPerKm: number | null | undefined): string {
  if (!secPerKm || !isFinite(secPerKm)) return "-"
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}'${String(s).padStart(2, "0")}"/km`
}

/** Header di una card grafico: titolo a sinistra, min/max della serie in
 *  alto a destra. Se la serie e' vuota mostra solo il titolo. */
function ChartCardHeader({
  title,
  data,
  format,
}: {
  title: string
  data: { value: number }[]
  format: (v: number) => string
}) {
  let mn = Infinity
  let mx = -Infinity
  for (const d of data) {
    if (d.value < mn) mn = d.value
    if (d.value > mx) mx = d.value
  }
  const hasRange = data.length > 0 && isFinite(mn) && isFinite(mx)
  return (
    <CardHeader>
      <div className="flex items-baseline justify-between gap-4">
        <CardTitle>{title}</CardTitle>
        {hasRange && (
          <span className="text-xs font-normal text-muted-foreground tabular-nums whitespace-nowrap">
            min {format(mn)} · max {format(mx)}
          </span>
        )}
      </div>
    </CardHeader>
  )
}

/** syncMethod per i chart sincronizzati: il `syncMethod="value"` nativo di
 *  Recharts fa un match ESATTO sul valore X, ma le nostre serie hanno
 *  timestamp diversi (HR a ~5s, oscillazione/falcata sfalsate, ecc.) → il
 *  match esatto fallisce e il tooltip resta vuoto. Qui troviamo invece il
 *  tick col tempo PIU' VICINO a quello del chart sorgente. */
function syncByNearestTime(
  ticks: { value: number }[],
  data: { activeLabel?: string | number; activeTooltipIndex?: number },
): number {
  const target = typeof data.activeLabel === "number" ? data.activeLabel : Number(data.activeLabel)
  if (!isFinite(target) || ticks.length === 0) return data.activeTooltipIndex ?? 0
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < ticks.length; i++) {
    const d = Math.abs(ticks[i].value - target)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Formatta un passo (minuti/km, valore float) come "m:ss". */
function formatPaceMMSS(paceMinPerKm: number): string {
  const m = Math.floor(paceMinPerKm)
  const s = Math.round((paceMinPerKm - m) * 60)
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`
}

/** Distanza in metri fra due coordinate (Haversine). */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Formatta una distanza in metri come "850 m" / "1.05 km". */
function formatDistanceM(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`
}

/** Intervallo X (epoch ms) selezionato trascinando su un grafico. */
type ChartRange = { start: number; end: number }

type ChartPoint = { t: number; value: number }

/** Media dei valori di una serie nella finestra temporale [start, end] (ms). */
function avgInRange(data: ChartPoint[], start: number, end: number): number | null {
  let sum = 0
  let n = 0
  for (const d of data) {
    if (d.t >= start && d.t <= end) {
      sum += d.value
      n++
    }
  }
  return n > 0 ? sum / n : null
}

type DragHandlers = {
  onMouseDown: (e: { activeLabel?: string | number } | null) => void
  onMouseMove: (e: { activeLabel?: string | number } | null) => void
  onMouseUp: () => void
}

/** Grafico time-series di un workout: linea singola, asse X temporale
 *  condiviso, tooltip sincronizzati, e drag-to-select di un intervallo
 *  (ReferenceArea blu) propagato a tutti gli altri grafici. */
function MetricChart({
  data,
  color,
  height = 220,
  yDomain,
  yTickFormatter,
  yReversed = false,
  tooltipFormatter,
  xAxisProps,
  msAxisFmt,
  activeRange,
  drag,
}: {
  data: ChartPoint[]
  color: string
  height?: number
  yDomain?: [string | number, string | number]
  yTickFormatter?: (v: number) => string
  yReversed?: boolean
  tooltipFormatter: (v: number) => [string, string]
  xAxisProps: object
  msAxisFmt: (ms: number) => string
  activeRange: ChartRange | null
  drag: DragHandlers
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={data}
        syncId="workout-charts"
        syncMethod={syncByNearestTime}
        onMouseDown={drag.onMouseDown}
        onMouseMove={drag.onMouseMove}
        onMouseUp={drag.onMouseUp}
        style={{ cursor: "crosshair", userSelect: "none" }}
      >
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis {...xAxisProps} />
        <YAxis tick={{ fontSize: 12 }} domain={yDomain} tickFormatter={yTickFormatter} reversed={yReversed} />
        <Tooltip labelFormatter={msAxisFmt} formatter={tooltipFormatter} />
        {activeRange && (
          <ReferenceArea
            x1={activeRange.start}
            x2={activeRange.end}
            fill="#3b82f6"
            fillOpacity={0.12}
            stroke="#3b82f6"
            strokeOpacity={0.4}
          />
        )}
        <Line dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function MetricBox({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums" style={{ color }}>
        {value}
        {unit && <span className="text-sm text-muted-foreground font-normal ml-1">{unit}</span>}
      </p>
    </div>
  )
}

export default function WorkoutDetail() {
  const { uuid } = useParams<{ uuid: string }>()
  const { data: workout, isLoading } = useWorkoutByUuid(uuid)
  const { data: splitsData } = useWorkoutSplits(uuid)
  const { data: route, isLoading: routeLoading } = useWorkoutRoute(uuid)
  const update = useUpdateWorkout()

  const [titleDraft, setTitleDraft] = useState("")
  const [notesDraft, setNotesDraft] = useState("")
  const [titleSaved, setTitleSaved] = useState(false)
  const [notesSaved, setNotesSaved] = useState(false)
  // Indice del punto GPS sotto il cursore — condiviso fra mappa e altimetria.
  const [routeHover, setRouteHover] = useState<number | null>(null)
  // Riga selezionata da una delle due tabelle ("Parziali per km" o
  // "Intervalli"). Click sulla stessa riga deseleziona; click su una di
  // un'altra tabella switcha sorgente. Il highlightedRange viene derivato
  // sotto in base al kind.
  type Highlight = { kind: "km" | "activity"; id: number }
  const [highlight, setHighlight] = useState<Highlight | null>(null)

  // Drag-to-select sui grafici time-series: si trascina orizzontalmente per
  // selezionare un intervallo; la ReferenceArea blu e il popover con le medie
  // sono condivisi da tutti i grafici (asse X = epoch ms comune).
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragEnd, setDragEnd] = useState<number | null>(null)
  const [selection, setSelection] = useState<ChartRange | null>(null)

  const dragHandlers: DragHandlers = {
    onMouseDown: e => {
      const x = e?.activeLabel
      if (x == null) return
      setDragStart(Number(x))
      setDragEnd(Number(x))
      setSelection(null)
    },
    onMouseMove: e => {
      const x = e?.activeLabel
      if (x == null) return
      setDragStart(prev => {
        if (prev != null) setDragEnd(Number(x))
        return prev
      })
    },
    onMouseUp: () => {
      setDragStart(prevStart => {
        setDragEnd(prevEnd => {
          if (prevStart != null && prevEnd != null && prevStart !== prevEnd) {
            setSelection({ start: Math.min(prevStart, prevEnd), end: Math.max(prevStart, prevEnd) })
          }
          return null
        })
        return null
      })
    },
  }

  const activeRange: ChartRange | null =
    selection ??
    (dragStart != null && dragEnd != null && dragStart !== dragEnd
      ? { start: Math.min(dragStart, dragEnd), end: Math.max(dragStart, dragEnd) }
      : null)

  useEffect(() => {
    setTitleDraft(workout?.title ?? "")
    setNotesDraft(workout?.notes ?? "")
  }, [workout?.title, workout?.notes])

  const saveTitle = async () => {
    if (!uuid) return
    try {
      await update.mutateAsync({ uuid, patch: { title: titleDraft } })
      setTitleSaved(true)
      setTimeout(() => setTitleSaved(false), 2500)
    } catch (err) {
      alert("Errore salvataggio titolo: " + (err as Error).message)
    }
  }

  const saveNotes = async () => {
    if (!uuid) return
    try {
      await update.mutateAsync({ uuid, patch: { notes: notesDraft } })
      setNotesSaved(true)
      setTimeout(() => setNotesSaved(false), 2500)
    } catch (err) {
      alert("Errore salvataggio note: " + (err as Error).message)
    }
  }

  const titleDirty = (workout?.title ?? "") !== titleDraft
  const notesDirty = (workout?.notes ?? "") !== notesDraft

  // Fetch time-series metrics within workout range
  const hr = useSamples({
    type: "HKQuantityTypeIdentifierHeartRate",
    start: workout?.start_date,
    end: workout?.end_date,
    aggregation: "none",
    limit: 2000,
  }, !!workout)

  const cadence = useSamples({
    type: "HKQuantityTypeIdentifierCyclingCadence",
    start: workout?.start_date,
    end: workout?.end_date,
    aggregation: "none",
    limit: 2000,
  }, !!workout)

  const runningPower = useSamples({
    type: "HKQuantityTypeIdentifierRunningPower",
    start: workout?.start_date,
    end: workout?.end_date,
    aggregation: "none",
    limit: 2000,
  }, !!workout)

  const runningSpeed = useSamples({
    type: "HKQuantityTypeIdentifierRunningSpeed",
    start: workout?.start_date,
    end: workout?.end_date,
    aggregation: "none",
    limit: 2000,
  }, !!workout)

  const verticalOsc = useSamples({
    type: "HKQuantityTypeIdentifierRunningVerticalOscillation",
    start: workout?.start_date,
    end: workout?.end_date,
    aggregation: "none",
    limit: 2000,
  }, !!workout)

  const groundContact = useSamples({
    type: "HKQuantityTypeIdentifierRunningGroundContactTime",
    start: workout?.start_date,
    end: workout?.end_date,
    aggregation: "none",
    limit: 2000,
  }, !!workout)

  const strideLength = useSamples({
    type: "HKQuantityTypeIdentifierRunningStrideLength",
    start: workout?.start_date,
    end: workout?.end_date,
    aggregation: "none",
    limit: 2000,
  }, !!workout)

  const activeCal = useSamples({
    type: "HKQuantityTypeIdentifierActiveEnergyBurned",
    start: workout?.start_date,
    end: workout?.end_date,
    aggregation: "none",
    limit: 2000,
  }, !!workout)

  // I sample di serie collassate (HKQuantitySeries) sono salvati come pochi
  // campioni a durata lunga (= la media). Dopo il backfill che aggiunge i punti
  // densi (durata 0), questi "ombrelli" vanno scartati dai grafici: altrimenti
  // disegnano un'impennata iniziale spuria. Se invece ci sono SOLO contenitori
  // (workout non backfillato) li teniamo.
  const dropContainers = (arr: Sample[]): Sample[] => {
    const instant = arr.filter(
      s => new Date(s.end_date).getTime() - new Date(s.start_date).getTime() < 30_000,
    )
    return instant.length > 0 ? instant : arr
  }

  const avgHR = useMemo(() => {
    const arr = dropContainers((hr.data?.data as Sample[] | undefined) ?? [])
    if (arr.length === 0) return null
    return arr.reduce((s, x) => s + x.value, 0) / arr.length
  }, [hr.data])

  const maxHR = useMemo(() => {
    const arr = dropContainers((hr.data?.data as Sample[] | undefined) ?? [])
    return arr.length ? Math.max(...arr.map(s => s.value)) : null
  }, [hr.data])

  const avgPower = useMemo(() => {
    const arr = dropContainers((runningPower.data?.data as Sample[] | undefined) ?? [])
    if (arr.length === 0) return null
    return arr.reduce((s, x) => s + x.value, 0) / arr.length
  }, [runningPower.data])

  const avgCadence = useMemo(() => {
    const arr = dropContainers((cadence.data?.data as Sample[] | undefined) ?? [])
    if (arr.length === 0) return null
    return arr.reduce((s, x) => s + x.value, 0) / arr.length
  }, [cadence.data])

  const avgPaceSecPerKm = useMemo(() => {
    if (!workout?.duration || !workout?.total_distance) return null
    const km = workout.total_distance / 1000
    return km > 0 ? workout.duration / km : null
  }, [workout])

  const hrChartData = useMemo(() => {
    const arr = dropContainers((hr.data?.data as Sample[] | undefined) ?? [])
    return arr
      .map(s => ({ time: s.start_date, t: new Date(s.start_date).getTime(), value: s.value }))
      .sort((a, b) => a.t - b.t)
  }, [hr.data])

  // Fallback per workout pre-2019 dove watchOS salvava un singolo sample HR
  // aggregato (durata = workout) invece dei sample puntuali a 5s di cadenza.
  // In questo caso la chart non puo' disegnare niente; mostriamo invece la
  // FC media testuale.
  const hrAggregatedOnly = useMemo(() => {
    const arr = (hr.data?.data as Sample[] | undefined) ?? []
    if (arr.length !== 1 || !workout) return null
    const s = arr[0]
    const sStart = new Date(s.start_date).getTime()
    const sEnd = new Date(s.end_date).getTime()
    const wStart = new Date(workout.start_date).getTime()
    const wEnd = new Date(workout.end_date).getTime()
    const sampleDur = sEnd - sStart
    const workoutDur = wEnd - wStart
    // Sample che copre >50% del workout = aggregato.
    if (workoutDur > 0 && sampleDur / workoutDur > 0.5) {
      return Math.round(s.value)
    }
    return null
  }, [hr.data, workout])

  // Mappa ogni split (1-based) a una finestra temporale [startTs, endTs] in
  // ms. Gli split sono cumulativi sul tempo: km1 = [workout.start, +dur1],
  // km2 = [+dur1, +dur1+dur2], ecc. Il backend restituisce già la durata
  // di ciascun km (anche per i parziali finali).
  const kmTimeRanges = useMemo(() => {
    if (!workout || !splitsData?.splits) return []
    const baseTs = new Date(workout.start_date).getTime()
    let cum = 0
    return splitsData.splits.map(s => {
      const startTs = baseTs + cum * 1000
      cum += s.duration_seconds
      const endTs = baseTs + cum * 1000
      return { n: s.n, startTs, endTs }
    })
  }, [workout, splitsData])

  // Range di indici GPS da evidenziare sulla mappa, derivato dal highlight
  // attivo. Per "km" ricava la finestra dai split cumulativi; per "activity"
  // usa direttamente start/end della WorkoutActivity. Cerca i punti GPS
  // dentro la finestra; se non ne trova (es. route GPS che non copre il
  // segmento) ritorna null e la mappa non evidenzia nulla.
  const highlightedRange = useMemo(() => {
    if (!highlight || !route?.points || route.points.length === 0) return null
    let startTs: number | undefined
    let endTs: number | undefined
    if (highlight.kind === "km") {
      const range = kmTimeRanges.find(r => r.n === highlight.id)
      if (!range) return null
      startTs = range.startTs
      endTs = range.endTs
    } else {
      const act = workout?.activities?.[highlight.id]
      if (!act) return null
      startTs = new Date(act.start).getTime()
      endTs = new Date(act.end).getTime()
    }
    if (startTs === undefined || endTs === undefined || endTs <= startTs) return null
    let startIdx = -1
    let endIdx = -1
    for (let i = 0; i < route.points.length; i++) {
      const t = new Date(route.points[i].ts).getTime()
      if (t >= startTs && t <= endTs) {
        if (startIdx === -1) startIdx = i
        endIdx = i
      } else if (t > endTs) {
        break
      }
    }
    if (startIdx === -1 || endIdx <= startIdx) return null
    return { startIdx, endIdx }
  }, [highlight, kmTimeRanges, route, workout])

  const speedChartData = useMemo(() => {
    const arr = dropContainers((runningSpeed.data?.data as Sample[] | undefined) ?? [])
    return arr
      .map(s => ({ time: s.start_date, t: new Date(s.start_date).getTime(), value: s.value * 3.6 })) // m/s -> km/h
      .sort((a, b) => a.t - b.t)
  }, [runningSpeed.data])

  // Passo (min/km) derivato dalla velocità: per la corsa il passo e' piu'
  // leggibile della velocita'. I punti fermi (km/h <= 0) producono passo
  // infinito → esclusi (gap nella linea).
  const paceChartData = useMemo(
    () =>
      speedChartData
        .filter(p => p.value > 0)
        .map(p => ({ time: p.time, t: p.t, value: 60 / p.value })),
    [speedChartData],
  )

  const powerChartData = useMemo(() => {
    const arr = dropContainers((runningPower.data?.data as Sample[] | undefined) ?? [])
    return arr
      .map(s => ({ time: s.start_date, t: new Date(s.start_date).getTime(), value: s.value }))
      .sort((a, b) => a.t - b.t)
  }, [runningPower.data])

  const cadenceChartData = useMemo(() => {
    const arr = dropContainers((cadence.data?.data as Sample[] | undefined) ?? [])
    return arr
      .map(s => ({ time: s.start_date, t: new Date(s.start_date).getTime(), value: s.value }))
      .sort((a, b) => a.t - b.t)
  }, [cadence.data])

  const verticalOscChartData = useMemo(() => {
    const arr = dropContainers((verticalOsc.data?.data as Sample[] | undefined) ?? [])
    return arr
      .map(s => ({ time: s.start_date, t: new Date(s.start_date).getTime(), value: s.value }))
      .sort((a, b) => a.t - b.t)
  }, [verticalOsc.data])

  const groundContactChartData = useMemo(() => {
    const arr = dropContainers((groundContact.data?.data as Sample[] | undefined) ?? [])
    return arr
      .map(s => ({ time: s.start_date, t: new Date(s.start_date).getTime(), value: s.value }))
      .sort((a, b) => a.t - b.t)
  }, [groundContact.data])

  const strideLengthChartData = useMemo(() => {
    const arr = dropContainers((strideLength.data?.data as Sample[] | undefined) ?? [])
    return arr
      .map(s => ({ time: s.start_date, t: new Date(s.start_date).getTime(), value: s.value * 100 })) // m -> cm
      .sort((a, b) => a.t - b.t)
  }, [strideLength.data])

  // Vertical ratio = oscillazione verticale / lunghezza falcata, in %.
  // Indicatore di economia di corsa normalizzato rispetto alla velocita'
  // (a differenza dell'oscillazione grezza) — piu' basso = meglio.
  // Apple Health non lo espone: lo ricostruiamo qui. I sample di
  // oscillazione e falcata arrivano dall'Apple Watch su timestamp
  // leggermente sfalsati (~2-3s), quindi facciamo un join al sample di
  // falcata piu' vicino entro 4s con un two-pointer (le serie sono gia'
  // ordinate per tempo). ratio% = osc_cm / falcata_cm * 100.
  const verticalRatioChartData = useMemo(() => {
    const stride = strideLengthChartData
    if (stride.length === 0 || verticalOscChartData.length === 0) return []
    const out: { time: string; t: number; value: number }[] = []
    let j = 0
    for (const o of verticalOscChartData) {
      const ot = o.t
      while (j < stride.length - 1 && stride[j + 1].t <= ot) j++
      let bi = j
      if (j + 1 < stride.length && Math.abs(stride[j + 1].t - ot) < Math.abs(stride[j].t - ot)) bi = j + 1
      if (Math.abs(stride[bi].t - ot) <= 4000 && stride[bi].value > 0) {
        out.push({ time: o.time, t: ot, value: (o.value / stride[bi].value) * 100 })
      }
    }
    return out
  }, [verticalOscChartData, strideLengthChartData])

  const avgVerticalRatio = useMemo(() => {
    if (verticalRatioChartData.length === 0) return null
    return verticalRatioChartData.reduce((s, x) => s + x.value, 0) / verticalRatioChartData.length
  }, [verticalRatioChartData])

  const caloriesTotal = useMemo(() => {
    const arr = (activeCal.data?.data as Sample[] | undefined) ?? []
    return arr.reduce((s, x) => s + x.value, 0)
  }, [activeCal.data])

  // Medie di ogni metrica nella finestra selezionata, per il popover.
  const selectionStats = useMemo(() => {
    if (!selection) return null
    const items: { label: string; value: string; color: string }[] = []
    const push = (
      label: string,
      data: ChartPoint[],
      color: string,
      fmt: (v: number) => string,
    ) => {
      const a = avgInRange(data, selection.start, selection.end)
      if (a !== null) items.push({ label, value: fmt(a), color })
    }
    push("Battito", hrChartData, "#ef4444", v => `${Math.round(v)} bpm`)
    // Media calcolata sulla velocità (km/h) — mediare il passo darebbe un
    // risultato sbagliato — e poi convertita in passo per la visualizzazione.
    push("Passo", speedChartData, "#22c55e", v => {
      if (v <= 0) return "—"
      return `${formatPaceMMSS(60 / v)} /km · ${v.toFixed(2)} km/h`
    })
    push("Potenza", powerChartData, "#f97316", v => `${Math.round(v)} W`)
    push("Cadenza", cadenceChartData, "#38bdf8", v => `${Math.round(v)} rpm`)
    push("Vertical ratio", verticalRatioChartData, "#a855f7", v => `${v.toFixed(1)} %`)
    push("Oscillazione vert.", verticalOscChartData, "#86efac", v => `${v.toFixed(1)} cm`)
    push("Contatto col suolo", groundContactChartData, "#4ade80", v => `${Math.round(v)} ms`)
    push("Lunghezza falcata", strideLengthChartData, "#16a34a", v => `${v.toFixed(1)} cm`)

    // Distanza percorsa nell'intervallo: dalla route GPS (Haversine sui punti
    // nella finestra) se disponibile, altrimenti integrando la velocita'.
    let distanceM: number | null = null
    const pts = route?.points
    if (pts && pts.length > 1) {
      let d = 0
      let prev: { lat: number; lon: number } | null = null
      for (const p of pts) {
        const t = new Date(p.ts).getTime()
        if (t < selection.start || t > selection.end) {
          if (t > selection.end) break
          continue
        }
        if (prev) d += haversineM(prev.lat, prev.lon, p.lat, p.lon)
        prev = { lat: p.lat, lon: p.lon }
      }
      if (prev) distanceM = d
    }
    if (distanceM === null && speedChartData.length > 1) {
      let d = 0
      for (let i = 1; i < speedChartData.length; i++) {
        const a = speedChartData[i - 1]
        const b = speedChartData[i]
        if (a.t < selection.start || b.t > selection.end) continue
        const dtS = (b.t - a.t) / 1000
        d += ((a.value + b.value) / 2 / 3.6) * dtS // km/h -> m/s * s
      }
      distanceM = d
    }

    return {
      durationS: Math.round((selection.end - selection.start) / 1000),
      startMs: selection.start,
      endMs: selection.end,
      distanceM,
      items,
    }
  }, [
    selection,
    hrChartData,
    speedChartData,
    powerChartData,
    cadenceChartData,
    verticalRatioChartData,
    verticalOscChartData,
    groundContactChartData,
    strideLengthChartData,
    route,
  ])

  const hasAnyChart =
    (hrChartData.length > 1 && hrAggregatedOnly === null) ||
    speedChartData.length > 0 ||
    powerChartData.length > 0 ||
    cadenceChartData.length > 0 ||
    verticalRatioChartData.length > 0 ||
    verticalOscChartData.length > 0 ||
    groundContactChartData.length > 0 ||
    strideLengthChartData.length > 0

  if (isLoading) return <p className="text-muted-foreground">Caricamento...</p>
  if (!workout) return <p className="text-muted-foreground">Workout non trovato</p>

  const typeName = workoutName(workout.activity_type, workout.metadata)
  const heading = workoutDisplayTitle(workout)
  const distanceKm = workout.total_distance ? workout.total_distance / 1000 : null
  const meta = extractWorkoutMetadata(workout.metadata)

  // Asse X numerico (epoch ms) condiviso da tutti i chart time-series: con
  // dominio fisso [start, end] del workout, i grafici hanno la stessa scala
  // orizzontale e il syncId di Recharts puo' sincronizzare i tooltip per
  // valore (non per indice) anche se le serie hanno timestamp diversi.
  const msAxisFmt = (ms: number) => new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
  const wStartMs = new Date(workout.start_date).getTime()
  const wEndMs = new Date(workout.end_date).getTime()
  const xAxisProps = {
    dataKey: "t",
    type: "number" as const,
    scale: "time" as const,
    domain: [wStartMs, wEndMs] as [number, number],
    tickFormatter: msAxisFmt,
    minTickGap: 50,
    tick: { fontSize: 12 },
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/workouts">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ChevronLeft className="h-4 w-4 mr-1" /> Indietro
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">{heading}</h1>
        <p className="text-muted-foreground">
          {heading !== typeName && <>{typeName} · </>}
          {formatDateTime(workout.start_date)} · durata {formatDuration(workout.duration)}
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Dettagli allenamento</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <MetricBox label="Durata" value={formatDuration(workout.duration)} color="#eab308" />
            {distanceKm !== null && (
              <MetricBox label="Distanza" value={distanceKm.toFixed(2)} unit="km" color="#06b6d4" />
            )}
            <MetricBox
              label="Calorie attive"
              value={formatNumber(caloriesTotal > 0 ? caloriesTotal : workout.total_energy_burned ?? 0)}
              unit="kcal"
              color="#ef4444"
            />
            {avgPaceSecPerKm && (
              <MetricBox label="Ritmo medio" value={formatPace(avgPaceSecPerKm)} color="#06b6d4" />
            )}
            {avgHR !== null && (
              <MetricBox label="Battito medio" value={`${Math.round(avgHR)}`} unit="bpm" color="#ef4444" />
            )}
            {maxHR !== null && (
              <MetricBox label="Battito max" value={`${Math.round(maxHR)}`} unit="bpm" color="#ef4444" />
            )}
            {avgPower !== null && (
              <MetricBox label="Potenza media" value={`${Math.round(avgPower)}`} unit="W" color="#f97316" />
            )}
            {avgCadence !== null && (
              <MetricBox label="Cadenza media" value={`${Math.round(avgCadence)}`} unit="rpm" color="#38bdf8" />
            )}
            {avgVerticalRatio !== null && (
              <MetricBox label="Vertical ratio media" value={avgVerticalRatio.toFixed(1)} unit="%" color="#a855f7" />
            )}
            <MetricBox label="Sorgente" value={workout.source_name ?? "-"} />
          </div>
        </CardContent>
      </Card>

      {(meta.indoor !== undefined || meta.swimmingLocation || meta.lapLength || meta.elevationAscended || meta.averageMETs || meta.weatherTemperature || meta.weatherHumidity || meta.brandName || meta.location || meta.notes) && (
        <Card>
          <CardHeader><CardTitle>Informazioni aggiuntive</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {meta.indoor !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">Ambiente</p>
                  <p className="font-medium">{meta.indoor ? "Indoor" : "Outdoor"}</p>
                </div>
              )}
              {meta.swimmingLocation && (
                <div>
                  <p className="text-xs text-muted-foreground">Tipo nuoto</p>
                  <p className="font-medium">{meta.swimmingLocation === "pool" ? "Piscina" : "Acque aperte"}</p>
                </div>
              )}
              {meta.lapLength && (
                <div>
                  <p className="text-xs text-muted-foreground">Vasca</p>
                  <p className="font-medium">{meta.lapLength}</p>
                </div>
              )}
              {meta.elevationAscended && (
                <div>
                  <p className="text-xs text-muted-foreground">Dislivello</p>
                  <p className="font-medium">{meta.elevationAscended}</p>
                </div>
              )}
              {meta.averageMETs !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">METs medi</p>
                  <p className="font-medium">{meta.averageMETs.toFixed(1)}</p>
                </div>
              )}
              {meta.weatherTemperature && (
                <div>
                  <p className="text-xs text-muted-foreground">Temperatura</p>
                  <p className="font-medium">{meta.weatherTemperature}</p>
                </div>
              )}
              {meta.weatherHumidity && (
                <div>
                  <p className="text-xs text-muted-foreground">Umidita'</p>
                  <p className="font-medium">{meta.weatherHumidity}</p>
                </div>
              )}
              {meta.weatherCondition && (
                <div>
                  <p className="text-xs text-muted-foreground">Meteo</p>
                  <p className="font-medium">{meta.weatherCondition}</p>
                </div>
              )}
              {meta.location && !meta.swimmingLocation && (
                <div>
                  <p className="text-xs text-muted-foreground">Location</p>
                  <p className="font-medium">{meta.location}</p>
                </div>
              )}
              {meta.brandName && (
                <div>
                  <p className="text-xs text-muted-foreground">App</p>
                  <p className="font-medium">{meta.brandName}</p>
                </div>
              )}
            </div>
            {meta.notes && (
              <div className="mt-4 pt-3 border-t">
                <p className="text-xs text-muted-foreground mb-1">Note allenamento (sorgente)</p>
                <p className="text-sm">{meta.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Titolo</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              placeholder="Titolo personalizzato del workout..."
              maxLength={200}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={saveTitle}
                disabled={!titleDirty || update.isPending}
              >
                {update.isPending ? "Salvo..." : "Salva"}
              </Button>
              {titleDirty && (
                <Button size="sm" variant="ghost" onClick={() => setTitleDraft(workout.title ?? "")}>
                  Annulla
                </Button>
              )}
              {titleSaved && <span className="text-xs text-green-600">Salvato</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Note</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              placeholder="Aggiungi una nota per questo workout..."
              rows={4}
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={saveNotes}
                disabled={!notesDirty || update.isPending}
              >
                {update.isPending ? "Salvo..." : "Salva"}
              </Button>
              {notesDirty && (
                <Button size="sm" variant="ghost" onClick={() => setNotesDraft(workout.notes ?? "")}>
                  Annulla
                </Button>
              )}
              {notesSaved && <span className="text-xs text-green-600">Salvata</span>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Mappa percorso
            {route && route.point_count > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {route.point_count} punti GPS
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {routeLoading && <p className="text-sm text-muted-foreground">Caricamento…</p>}
          {!routeLoading && route === null && (
            <p className="text-sm text-muted-foreground">
              Percorso non ancora sincronizzato. Apri l'app sull'iPhone e fai un sync per importarlo da HealthKit.
            </p>
          )}
          {!routeLoading && route && route.points.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nessun dato GPS disponibile per questo workout (indoor o sorgente esterna senza tracciato).
            </p>
          )}
          {!routeLoading && route && route.points.length > 0 && (
            <>
              <WorkoutMap
                points={route.points}
                hoverIndex={routeHover}
                onHover={setRouteHover}
                hrSeries={hrChartData}
                highlightedRange={highlightedRange}
              />
              <ElevationChart points={route.points} hoverIndex={routeHover} onHover={setRouteHover} />
            </>
          )}
        </CardContent>
      </Card>

      {splitsData && splitsData.splits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Parziali (per km)
              {route && route.points.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  click su una riga per evidenziare il km sulla mappa
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">#</TableHead>
                  <TableHead>Distanza</TableHead>
                  <TableHead>Tempo</TableHead>
                  <TableHead>Ritmo</TableHead>
                  <TableHead className="text-right">Battito</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {splitsData.splits.map(s => {
                  const isHighlighted = highlight?.kind === "km" && highlight.id === s.n
                  const clickable = !!route && route.points.length > 0
                  return (
                    <TableRow
                      key={s.n}
                      onClick={clickable ? () => setHighlight(prev => (prev?.kind === "km" && prev.id === s.n ? null : { kind: "km", id: s.n })) : undefined}
                      className={
                        (clickable ? "cursor-pointer hover:bg-muted/50 " : "") +
                        (isHighlighted ? "bg-blue-50 dark:bg-blue-950" : "")
                      }
                    >
                      <TableCell className="font-medium">
                        {s.n}
                        {isHighlighted && <span className="ml-1 text-blue-600">●</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {s.distance_km.toFixed(2)} km {s.partial && <span className="text-xs text-muted-foreground">(parziale)</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatDuration(s.duration_seconds)}</TableCell>
                      <TableCell className="tabular-nums">{formatPace(s.pace_sec_per_km)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.avg_heart_rate !== null ? `${s.avg_heart_rate} bpm` : "-"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {workout.activities && workout.activities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Intervalli
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {workout.activities.length} entry · da HealthKit (HKWorkoutActivity / workoutEvents)
                {route && route.points.length > 0 && " · click su una riga per evidenziare l'intervallo sulla mappa"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">#</TableHead>
                  <TableHead>Attivita</TableHead>
                  <TableHead>Inizio</TableHead>
                  <TableHead className="text-right">Durata</TableHead>
                  <TableHead className="text-right">Distanza</TableHead>
                  <TableHead className="text-right">Ritmo</TableHead>
                  <TableHead className="text-right">HR medio</TableHead>
                  <TableHead className="text-right">HR max</TableHead>
                  <TableHead className="text-right">Kcal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workout.activities.map((a, i) => {
                  const isRest = a.kind === "rest"
                  const startTime = new Date(a.start).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                  // Primary label: prefer the explicit per-interval name the source
                  // app provides (e.g. Intervals Pro's "Camminata" / "Corsa"), then
                  // the sub-activity HealthKit type, then a generic marker.
                  const activityLabel =
                    a.name
                    ?? (a.activity_type != null ? workoutName(a.activity_type) : null)
                    ?? (a.kind === "work" ? "Intervallo" : a.kind)
                  // Optional per-interval color provided by the source app.
                  const dotColor = a.metadata?.["Interval Color"] ?? null
                  // Show the HealthKit sub-activity type as subtitle only when
                  // the source app did NOT provide an explicit interval name
                  // (otherwise the sub-type is usually the same as the parent
                  // workout, which would be redundant, e.g. "Corsa" under every
                  // "Camminata"/"Corsa" row of an Intervals Pro program).
                  const typeSubtitle = !a.name && a.activity_type != null && workoutName(a.activity_type) !== activityLabel
                    ? workoutName(a.activity_type)
                    : null
                  const isHighlighted = highlight?.kind === "activity" && highlight.id === i
                  const clickable = !!route && route.points.length > 0
                  return (
                    <TableRow
                      key={i}
                      onClick={clickable ? () => setHighlight(prev => (prev?.kind === "activity" && prev.id === i ? null : { kind: "activity", id: i })) : undefined}
                      className={
                        (clickable ? "cursor-pointer hover:bg-muted/50 " : "") +
                        (isHighlighted ? "bg-blue-50 dark:bg-blue-950" : (isRest ? "bg-muted/40" : ""))
                      }
                    >
                      <TableCell className="font-medium tabular-nums">
                        {a.n}
                        {isHighlighted && <span className="ml-1 text-blue-600">●</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {dotColor && (
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ background: dotColor }}
                            />
                          )}
                          <div className="flex flex-col">
                            <span>{activityLabel}</span>
                            {typeSubtitle && (
                              <span className="text-[11px] text-muted-foreground">{typeSubtitle}</span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{startTime}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatDuration(a.duration_s)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.distance_m ? `${(a.distance_m / 1000).toFixed(2)} km` : "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatPace(a.pace_s_per_km)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.avg_hr !== null ? `${Math.round(a.avg_hr)} bpm` : "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.max_hr !== null ? `${Math.round(a.max_hr)} bpm` : "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.kcal !== null ? Math.round(a.kcal) : "-"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {hasAnyChart && (
        <p className="text-xs text-muted-foreground">
          Suggerimento: <strong>trascina orizzontalmente</strong> su un grafico per selezionare un
          intervallo — comparirà un riquadro con i valori medi di tutte le metriche in quella finestra.
        </p>
      )}

      {hrChartData.length > 1 && hrAggregatedOnly === null && (
        <HRZonesCard
          samples={(hr.data?.data as Sample[] | undefined) ?? []}
          workoutEnd={workout.end_date}
        />
      )}

      {/* Card chart cardiaco solo se ci sono almeno 2 sample puntuali — i
          workout pre-2019 di Apple Watch hanno 1 solo sample aggregato che
          non disegna una linea, meglio nascondere la card del tutto: la
          FC media e' gia' visibile nella sezione metriche in alto. */}
      {hrChartData.length > 1 && hrAggregatedOnly === null && (
        <Card>
          <ChartCardHeader title="Frequenza cardiaca" data={hrChartData} format={v => `${Math.round(v)} bpm`} />
          <CardContent>
            <MetricChart
              data={hrChartData}
              color="#ef4444"
              height={260}
              yDomain={["dataMin - 5", "dataMax + 5"]}
              tooltipFormatter={(v: number) => [`${Math.round(v)} bpm`, "HR"]}
              xAxisProps={xAxisProps}
              msAxisFmt={msAxisFmt}
              activeRange={activeRange}
              drag={dragHandlers}
            />
          </CardContent>
        </Card>
      )}

      {paceChartData.length > 0 && (
        <Card>
          <ChartCardHeader title="Passo" data={paceChartData} format={v => `${formatPaceMMSS(v)}/km`} />
          <CardContent>
            <MetricChart
              data={paceChartData}
              color="#22c55e"
              yReversed
              yTickFormatter={(v: number) => formatPaceMMSS(v)}
              tooltipFormatter={(v: number) => {
                const kmh = v > 0 ? 60 / v : 0
                return [`${formatPaceMMSS(v)} /km · ${kmh.toFixed(2)} km/h`, "Passo"]
              }}
              xAxisProps={xAxisProps}
              msAxisFmt={msAxisFmt}
              activeRange={activeRange}
              drag={dragHandlers}
            />
          </CardContent>
        </Card>
      )}

      {verticalRatioChartData.length > 0 && (
        <Card>
          <ChartCardHeader title="Vertical ratio" data={verticalRatioChartData} format={v => `${v.toFixed(1)} %`} />
          <CardContent className="space-y-4">
            <details className="text-xs text-muted-foreground bg-muted/30 rounded p-3">
              <summary className="cursor-pointer font-medium text-foreground">Come si interpreta</summary>
              <div className="mt-2 space-y-2 leading-relaxed">
                <p>
                  La <strong>vertical ratio</strong> e' l'oscillazione verticale divisa per la
                  lunghezza della falcata (in %). Dice quanto del tuo movimento va "avanti"
                  invece che "su" — <strong>piu' bassa = piu' economico</strong>. A differenza
                  dell'oscillazione grezza e' normalizzata rispetto alla velocita', quindi puoi
                  confrontare allenamenti a ritmi diversi.
                </p>
                <p>
                  Fasce di riferimento: <strong>&lt;6%</strong> eccellente · <strong>6-8%</strong> buona ·{" "}
                  <strong>8-10%</strong> nella media degli amatori · <strong>&gt;10%</strong> stai
                  "saltellando" troppo.
                </p>
                <p>
                  Il segnale di progresso piu' pulito e' il <strong>trend nel tempo</strong> a parita'
                  di ritmo. Dentro un allenamento, una ratio che peggiora nell'ultimo terzo indica
                  cali di tecnica con la fatica. La leva principale per abbassarla e' la{" "}
                  <strong>cadenza</strong> (+5-10% di passi/min). Dati stimati dall'Apple Watch:
                  affidati ai trend, non al singolo decimale.
                </p>
              </div>
            </details>
            <MetricChart
              data={verticalRatioChartData}
              color="#a855f7"
              yDomain={["dataMin - 1", "dataMax + 1"]}
              yTickFormatter={(v: number) => v.toFixed(1)}
              tooltipFormatter={(v: number) => [`${v.toFixed(1)} %`, "Vertical ratio"]}
              xAxisProps={xAxisProps}
              msAxisFmt={msAxisFmt}
              activeRange={activeRange}
              drag={dragHandlers}
            />
          </CardContent>
        </Card>
      )}

      {powerChartData.length > 0 && (
        <Card>
          <ChartCardHeader title="Potenza" data={powerChartData} format={v => `${Math.round(v)} W`} />
          <CardContent className="space-y-4">
            <details className="text-xs text-muted-foreground bg-muted/30 rounded p-3">
              <summary className="cursor-pointer font-medium text-foreground">Come si interpreta</summary>
              <div className="mt-2 space-y-2 leading-relaxed">
                <p>
                  La <strong>potenza</strong> (in Watt) stima quanto stai effettivamente
                  lavorando, non solo quanto vai veloce. Su terreno piatto e a ritmo costante
                  e' quasi equivalente alla velocita' — la differenza emerge quando le
                  condizioni cambiano.
                </p>
                <p>
                  <strong>In salita</strong> rallenti ma spingi di piu': la velocita' crolla, la
                  potenza resta stabile a parita' di sforzo. Lo stesso con vento contro, fondo
                  morbido o accelerazioni. Per questo su percorsi ondulati la potenza
                  rappresenta l'intensita' reale meglio del passo, e reagisce subito (la
                  frequenza cardiaca ha 20-30s di ritardo).
                </p>
                <p>
                  <strong>A cosa serve</strong>: gestire lo sforzo su sali-scendi tenendo una
                  potenza-obiettivo invece del passo, e confrontare allenamenti su percorsi
                  diversi (250 W sono 250 W ovunque).
                </p>
                <p>
                  ⚠️ Apple <strong>stima</strong> la potenza da un modello (velocita', dislivello,
                  oscillazione, massa) — non la misura come un misuratore da bici. I valori
                  assoluti non sono confrontabili fra marche diverse, e in piano il modello
                  degrada di fatto in "velocita' riscalata".
                </p>
              </div>
            </details>
            <MetricChart
              data={powerChartData}
              color="#f97316"
              tooltipFormatter={(v: number) => [`${Math.round(v)} W`, "Potenza"]}
              xAxisProps={xAxisProps}
              msAxisFmt={msAxisFmt}
              activeRange={activeRange}
              drag={dragHandlers}
            />
          </CardContent>
        </Card>
      )}

      {cadenceChartData.length > 0 && (
        <Card>
          <ChartCardHeader title="Cadenza" data={cadenceChartData} format={v => `${Math.round(v)} rpm`} />
          <CardContent>
            <MetricChart
              data={cadenceChartData}
              color="#38bdf8"
              tooltipFormatter={(v: number) => [`${Math.round(v)} rpm`, "Cadenza"]}
              xAxisProps={xAxisProps}
              msAxisFmt={msAxisFmt}
              activeRange={activeRange}
              drag={dragHandlers}
            />
          </CardContent>
        </Card>
      )}

      {verticalOscChartData.length > 0 && (
        <Card>
          <ChartCardHeader title="Oscillazione verticale" data={verticalOscChartData} format={v => `${v.toFixed(1)} cm`} />
          <CardContent>
            <MetricChart
              data={verticalOscChartData}
              color="#86efac"
              yDomain={["dataMin - 1", "dataMax + 1"]}
              tooltipFormatter={(v: number) => [`${v.toFixed(1)} cm`, "Oscillazione verticale"]}
              xAxisProps={xAxisProps}
              msAxisFmt={msAxisFmt}
              activeRange={activeRange}
              drag={dragHandlers}
            />
          </CardContent>
        </Card>
      )}

      {groundContactChartData.length > 0 && (
        <Card>
          <ChartCardHeader title="Tempo di contatto col suolo" data={groundContactChartData} format={v => `${Math.round(v)} ms`} />
          <CardContent>
            <MetricChart
              data={groundContactChartData}
              color="#4ade80"
              yDomain={["dataMin - 10", "dataMax + 10"]}
              tooltipFormatter={(v: number) => [`${Math.round(v)} ms`, "Contatto col suolo"]}
              xAxisProps={xAxisProps}
              msAxisFmt={msAxisFmt}
              activeRange={activeRange}
              drag={dragHandlers}
            />
          </CardContent>
        </Card>
      )}

      {strideLengthChartData.length > 0 && (
        <Card>
          <ChartCardHeader title="Lunghezza falcata" data={strideLengthChartData} format={v => `${v.toFixed(1)} cm`} />
          <CardContent>
            <MetricChart
              data={strideLengthChartData}
              color="#16a34a"
              yDomain={["dataMin - 5", "dataMax + 5"]}
              tooltipFormatter={(v: number) => [`${v.toFixed(1)} cm`, "Lunghezza falcata"]}
              xAxisProps={xAxisProps}
              msAxisFmt={msAxisFmt}
              activeRange={activeRange}
              drag={dragHandlers}
            />
          </CardContent>
        </Card>
      )}

      {selectionStats && (
        <div className="fixed bottom-6 right-6 z-40 w-72 rounded-lg border bg-background shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
            <div>
              <p className="text-sm font-semibold">Intervallo selezionato</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {msAxisFmt(selectionStats.startMs)}–{msAxisFmt(selectionStats.endMs)} ·{" "}
                {formatDuration(selectionStats.durationS)}
                {selectionStats.distanceM !== null && (
                  <> · {formatDistanceM(selectionStats.distanceM)}</>
                )}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 shrink-0"
              onClick={() => setSelection(null)}
              aria-label="Chiudi"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="px-4 py-2">
            {selectionStats.items.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                Nessun dato in questo intervallo.
              </p>
            ) : (
              <dl className="divide-y">
                {selectionStats.items.map(it => (
                  <div key={it.label} className="flex items-center justify-between gap-3 py-1.5">
                    <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ background: it.color }}
                      />
                      {it.label}
                    </dt>
                    <dd className="text-sm font-medium tabular-nums">{it.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="pt-1 text-[11px] text-muted-foreground">valori medi nell'intervallo</p>
          </div>
        </div>
      )}

    </div>
  )
}
