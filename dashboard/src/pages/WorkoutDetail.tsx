import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useSamples, useUpdateWorkout, useWorkoutByUuid, useWorkoutRoute, useWorkoutSplits } from "@/lib/queries"
import { WorkoutMap } from "@/components/WorkoutMap"
import { ElevationChart } from "@/components/ElevationChart"
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

  const activeCal = useSamples({
    type: "HKQuantityTypeIdentifierActiveEnergyBurned",
    start: workout?.start_date,
    end: workout?.end_date,
    aggregation: "none",
    limit: 2000,
  }, !!workout)

  const avgHR = useMemo(() => {
    const arr = (hr.data?.data as Sample[] | undefined) ?? []
    if (arr.length === 0) return null
    return arr.reduce((s, x) => s + x.value, 0) / arr.length
  }, [hr.data])

  const maxHR = useMemo(() => {
    const arr = (hr.data?.data as Sample[] | undefined) ?? []
    return arr.length ? Math.max(...arr.map(s => s.value)) : null
  }, [hr.data])

  const avgPaceSecPerKm = useMemo(() => {
    if (!workout?.duration || !workout?.total_distance) return null
    const km = workout.total_distance / 1000
    return km > 0 ? workout.duration / km : null
  }, [workout])

  const hrChartData = useMemo(() => {
    const arr = (hr.data?.data as Sample[] | undefined) ?? []
    return arr
      .map(s => ({ time: s.start_date, value: s.value }))
      .sort((a, b) => a.time.localeCompare(b.time))
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
    const arr = (runningSpeed.data?.data as Sample[] | undefined) ?? []
    return arr
      .map(s => ({ time: s.start_date, value: s.value * 3.6 })) // m/s -> km/h
      .sort((a, b) => a.time.localeCompare(b.time))
  }, [runningSpeed.data])

  const powerChartData = useMemo(() => {
    const arr = (runningPower.data?.data as Sample[] | undefined) ?? []
    return arr
      .map(s => ({ time: s.start_date, value: s.value }))
      .sort((a, b) => a.time.localeCompare(b.time))
  }, [runningPower.data])

  const cadenceChartData = useMemo(() => {
    const arr = (cadence.data?.data as Sample[] | undefined) ?? []
    return arr
      .map(s => ({ time: s.start_date, value: s.value }))
      .sort((a, b) => a.time.localeCompare(b.time))
  }, [cadence.data])

  const caloriesTotal = useMemo(() => {
    const arr = (activeCal.data?.data as Sample[] | undefined) ?? []
    return arr.reduce((s, x) => s + x.value, 0)
  }, [activeCal.data])

  if (isLoading) return <p className="text-muted-foreground">Caricamento...</p>
  if (!workout) return <p className="text-muted-foreground">Workout non trovato</p>

  const typeName = workoutName(workout.activity_type, workout.metadata)
  const heading = workoutDisplayTitle(workout)
  const distanceKm = workout.total_distance ? workout.total_distance / 1000 : null
  const meta = extractWorkoutMetadata(workout.metadata)

  const timeAxisFmt = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })

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

      {/* Card chart cardiaco solo se ci sono almeno 2 sample puntuali — i
          workout pre-2019 di Apple Watch hanno 1 solo sample aggregato che
          non disegna una linea, meglio nascondere la card del tutto: la
          FC media e' gia' visibile nella sezione metriche in alto. */}
      {hrChartData.length > 1 && hrAggregatedOnly === null && (
        <Card>
          <CardHeader><CardTitle>Frequenza cardiaca</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={hrChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time" tickFormatter={timeAxisFmt} minTickGap={50} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} domain={["dataMin - 5", "dataMax + 5"]} />
                <Tooltip labelFormatter={timeAxisFmt} formatter={(v: number) => [`${Math.round(v)} bpm`, "HR"]} />
                <Line dataKey="value" stroke="#ef4444" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {speedChartData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Velocita' corsa</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={speedChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time" tickFormatter={timeAxisFmt} minTickGap={50} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  labelFormatter={timeAxisFmt}
                  formatter={(v: number) => {
                    if (!v || v <= 0) return [`${v.toFixed(2)} km/h`, "Velocita'"]
                    const paceMinTotal = 60 / v
                    const m = Math.floor(paceMinTotal)
                    const s = Math.round((paceMinTotal - m) * 60)
                    const sStr = s.toString().padStart(2, "0")
                    // Edge case: 60s rounding overflow (e.g. 59.7 → 60).
                    const paceStr = s === 60 ? `${m + 1}:00` : `${m}:${sStr}`
                    return [`${v.toFixed(2)} km/h · ${paceStr}/km`, "Velocita'"]
                  }}
                />
                <Line dataKey="value" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {powerChartData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Potenza</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={powerChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time" tickFormatter={timeAxisFmt} minTickGap={50} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip labelFormatter={timeAxisFmt} formatter={(v: number) => [`${Math.round(v)} W`, "Potenza"]} />
                <Line dataKey="value" stroke="#f97316" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {cadenceChartData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Cadenza</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={cadenceChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time" tickFormatter={timeAxisFmt} minTickGap={50} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip labelFormatter={timeAxisFmt} formatter={(v: number) => [`${Math.round(v)} rpm`, "Cadenza"]} />
                <Line dataKey="value" stroke="#38bdf8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
