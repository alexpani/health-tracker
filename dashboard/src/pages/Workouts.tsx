import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Filter, Trash2, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  TimeRangeSelector,
  timeRangeToDates,
} from "@/components/controls/TimeRangeSelector"
import {
  useDeleteWorkout,
  useRestoreWorkout,
  useWorkoutFacets,
  useWorkouts,
} from "@/lib/queries"
import { workoutName } from "@/lib/healthkit"
import { formatDateTime, formatNumber } from "@/lib/utils"
import type { TimeRange, Workout, WorkoutFilters } from "@/lib/types"

type ChartAggregation = "day" | "week" | "month" | "all"

function localToISO(s: string): string | undefined {
  if (!s) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function isoToLocal(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatPace(durationSec: number | null, distanceMeters: number | null): string {
  if (!durationSec || !distanceMeters || distanceMeters <= 0) return "-"
  const secPerKm = durationSec / (distanceMeters / 1000)
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}'${String(s).padStart(2, "0")}"/km`
}

function bucketKey(d: Date, agg: ChartAggregation): string {
  if (agg === "day") return d.toISOString().slice(0, 10)
  if (agg === "week") {
    const tmp = new Date(d)
    const day = (tmp.getDay() + 6) % 7  // Monday=0
    tmp.setDate(tmp.getDate() - day)
    tmp.setHours(0, 0, 0, 0)
    return tmp.toISOString().slice(0, 10)
  }
  if (agg === "month") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  return String(d.getFullYear())
}

function formatBucketLabel(key: string, agg: ChartAggregation, withYear = false): string {
  if (agg === "day") {
    return new Date(key).toLocaleDateString("it-IT", withYear
      ? { day: "2-digit", month: "short", year: "numeric" }
      : { day: "2-digit", month: "short" })
  }
  if (agg === "week") {
    const d = new Date(key)
    const start = d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })
    const end = new Date(d.getTime() + 6 * 24 * 3600 * 1000).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })
    return withYear ? `${start} - ${end} ${d.getFullYear()}` : `${start} - ${end}`
  }
  if (agg === "month") {
    const [y, m] = key.split("-")
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" })
  }
  return key
}

function bucketRange(key: string, agg: ChartAggregation): { start: string; end: string } {
  if (agg === "day") {
    const d = new Date(key)
    const start = new Date(d); start.setHours(0, 0, 0, 0)
    const end = new Date(d); end.setHours(23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (agg === "week") {
    const d = new Date(key); d.setHours(0, 0, 0, 0)
    const end = new Date(d.getTime() + 7 * 24 * 3600 * 1000 - 1)
    return { start: d.toISOString(), end: end.toISOString() }
  }
  if (agg === "month") {
    const [y, m] = key.split("-").map(Number)
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 0, 23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  // year
  const y = Number(key)
  return {
    start: new Date(y, 0, 1).toISOString(),
    end: new Date(y, 11, 31, 23, 59, 59, 999).toISOString(),
  }
}

function nextFinerAggregation(agg: ChartAggregation): ChartAggregation | null {
  if (agg === "all") return "month"
  if (agg === "month") return "week"
  if (agg === "week") return "day"
  return null // already "day"
}

export default function Workouts() {
  const navigate = useNavigate()
  const deleteWorkout = useDeleteWorkout()
  const restoreWorkout = useRestoreWorkout()

  // Filters
  const [range, setRange] = useState<TimeRange>("1y")
  const [activityType, setActivityType] = useState<string>("all")
  const [chartAgg, setChartAgg] = useState<ChartAggregation>("week")

  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [startLocal, setStartLocal] = useState("")
  const [endLocal, setEndLocal] = useState("")
  const [distMinKm, setDistMinKm] = useState("")
  const [distMaxKm, setDistMaxKm] = useState("")
  const [selectedSources, setSelectedSources] = useState<string[]>([])

  const { data: facets } = useWorkoutFacets()

  // Build effective filters for the query
  const baseDates = useMemo(() => timeRangeToDates(range), [range])
  const filters: WorkoutFilters = useMemo(() => {
    const f: WorkoutFilters = {
      start: localToISO(startLocal) ?? baseDates.start,
      end: localToISO(endLocal) ?? baseDates.end,
    }
    if (activityType !== "all") f.activity_type = [Number(activityType)]
    if (selectedSources.length) f.sources = selectedSources
    if (distMinKm !== "") f.distance_min = parseFloat(distMinKm) * 1000
    if (distMaxKm !== "") f.distance_max = parseFloat(distMaxKm) * 1000
    return f
  }, [range, baseDates, startLocal, endLocal, activityType, selectedSources, distMinKm, distMaxKm])

  const { data: workouts, isLoading } = useWorkouts(filters)

  // Undo snapshot
  const [undoSnapshot, setUndoSnapshot] = useState<{
    snapshot: Record<string, unknown>
    name: string
    timeoutId: ReturnType<typeof setTimeout>
  } | null>(null)

  useEffect(() => {
    return () => {
      if (undoSnapshot) clearTimeout(undoSnapshot.timeoutId)
    }
  }, [undoSnapshot])

  const onDelete = async (w: Workout, ev: React.MouseEvent) => {
    ev.stopPropagation()
    const displayName = w.activity_name ?? workoutName(w.activity_type)
    const confirmMsg = `Eliminare il workout "${displayName}" del ${formatDateTime(w.start_date)}?`
    if (!confirm(confirmMsg)) return

    try {
      const result = await deleteWorkout.mutateAsync(w.uuid)
      // Clear any previous pending undo
      if (undoSnapshot) clearTimeout(undoSnapshot.timeoutId)
      const timeoutId = setTimeout(() => setUndoSnapshot(null), 8000)
      setUndoSnapshot({ snapshot: result.snapshot, name: displayName, timeoutId })
    } catch (err) {
      alert("Errore: " + (err as Error).message)
    }
  }

  const doUndo = async () => {
    if (!undoSnapshot) return
    clearTimeout(undoSnapshot.timeoutId)
    try {
      await restoreWorkout.mutateAsync(undoSnapshot.snapshot)
    } catch (err) {
      alert("Errore ripristino: " + (err as Error).message)
    }
    setUndoSnapshot(null)
  }

  const stats = useMemo(() => {
    if (!workouts) return { count: 0, totalDuration: 0, totalDistance: 0, totalCalories: 0 }
    return workouts.reduce(
      (acc, w) => ({
        count: acc.count + 1,
        totalDuration: acc.totalDuration + (w.duration ?? 0),
        totalDistance: acc.totalDistance + (w.total_distance ?? 0),
        totalCalories: acc.totalCalories + (w.total_energy_burned ?? 0),
      }),
      { count: 0, totalDuration: 0, totalDistance: 0, totalCalories: 0 }
    )
  }, [workouts])

  const chartData = useMemo(() => {
    if (!workouts) return []
    type Bucket = {
      key: string
      count: number
      uuids: string[]
      totalDuration: number
      totalDistance: number
      singleName?: string
    }
    const buckets = new Map<string, Bucket>()
    workouts.forEach(w => {
      const k = bucketKey(new Date(w.start_date), chartAgg)
      if (!buckets.has(k)) buckets.set(k, { key: k, count: 0, uuids: [], totalDuration: 0, totalDistance: 0 })
      const b = buckets.get(k)!
      b.count++
      b.uuids.push(w.uuid)
      b.totalDuration += w.duration ?? 0
      b.totalDistance += w.total_distance ?? 0
      if (b.count === 1) b.singleName = w.activity_name ?? workoutName(w.activity_type)
      else b.singleName = undefined
    })
    return Array.from(buckets.values()).sort((a, b) => (a.key < b.key ? -1 : 1))
  }, [workouts, chartAgg])

  const onBarClick = (d: any) => {
    if (!d) return
    const key: string | undefined = d.key ?? d.payload?.key
    const uuids: string[] | undefined = d.uuids ?? d.payload?.uuids
    if (!key) return

    // Single workout → open detail
    if (uuids && uuids.length === 1) {
      navigate(`/workouts/${uuids[0]}`)
      return
    }

    // Multiple → drill down into the bucket period
    const rng = bucketRange(key, chartAgg)
    setStartLocal(isoToLocal(rng.start))
    setEndLocal(isoToLocal(rng.end))
    setShowAdvanced(true)
    const finer = nextFinerAggregation(chartAgg)
    if (finer) setChartAgg(finer)
  }

  const clearAdvanced = () => {
    setStartLocal(""); setEndLocal(""); setDistMinKm(""); setDistMaxKm(""); setSelectedSources([])
  }

  const advActiveCount =
    (startLocal ? 1 : 0) +
    (endLocal ? 1 : 0) +
    (distMinKm ? 1 : 0) +
    (distMaxKm ? 1 : 0) +
    (selectedSources.length ? 1 : 0)

  return (
    <div className="space-y-6 relative">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Workout</h1>
        <p className="text-muted-foreground">Cronologia allenamenti</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <TimeRangeSelector value={range} onChange={setRange} />
        <Select value={activityType} onValueChange={setActivityType}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i tipi</SelectItem>
            {facets?.activity_types.map(t => (
              <SelectItem key={t.activity_type} value={String(t.activity_type)}>
                {t.activity_name ?? workoutName(t.activity_type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setShowAdvanced(!showAdvanced)}>
          <Filter className="h-4 w-4 mr-2" />
          Filtri {advActiveCount > 0 && <span className="ml-1 bg-primary text-primary-foreground rounded-full px-2 text-xs">{advActiveCount}</span>}
        </Button>
        {advActiveCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAdvanced}>
            <X className="h-4 w-4 mr-1" /> Pulisci
          </Button>
        )}
      </div>

      {showAdvanced && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Da</Label>
                <Input type="datetime-local" value={startLocal} onChange={e => setStartLocal(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">A</Label>
                <Input type="datetime-local" value={endLocal} onChange={e => setEndLocal(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">
                  Distanza min (km)
                  {facets?.distance_min != null && <span className="text-muted-foreground"> (DB: {(facets.distance_min / 1000).toFixed(2)})</span>}
                </Label>
                <Input type="number" step="any" value={distMinKm} onChange={e => setDistMinKm(e.target.value)} placeholder="qualsiasi" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  Distanza max (km)
                  {facets?.distance_max != null && <span className="text-muted-foreground"> (DB: {(facets.distance_max / 1000).toFixed(2)})</span>}
                </Label>
                <Input type="number" step="any" value={distMaxKm} onChange={e => setDistMaxKm(e.target.value)} placeholder="qualsiasi" />
              </div>
            </div>
            {facets && facets.sources.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Sorgente</Label>
                <div className="flex flex-wrap gap-1">
                  {facets.sources.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSelectedSources(
                        selectedSources.includes(s) ? selectedSources.filter(x => x !== s) : [...selectedSources, s]
                      )}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                        selectedSources.includes(s)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-accent"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Workout</p><p className="text-2xl font-semibold">{stats.count}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ore totali</p><p className="text-2xl font-semibold">{(stats.totalDuration / 3600).toFixed(1)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Distanza totale</p><p className="text-2xl font-semibold">{(stats.totalDistance / 1000).toFixed(1)} <span className="text-sm text-muted-foreground font-normal">km</span></p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Calorie totali</p><p className="text-2xl font-semibold">{formatNumber(stats.totalCalories)} <span className="text-sm text-muted-foreground font-normal">kcal</span></p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Workout per periodo</CardTitle>
            <Select value={chartAgg} onValueChange={v => setChartAgg(v as ChartAggregation)}>
              <SelectTrigger className="w-[140px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Giornaliero</SelectItem>
                <SelectItem value="week">Settimanale</SelectItem>
                <SelectItem value="month">Mensile</SelectItem>
                <SelectItem value="all">Annuale</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-muted-foreground py-8">Nessun workout nel periodo</p>
          ) : (
            <>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} onClick={(state: any) => {
                const p = state?.activePayload?.[0]?.payload
                if (p) onBarClick(p)
              }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="key"
                  tickFormatter={k => formatBucketLabel(k, chartAgg)}
                  tick={{ fontSize: 11 }}
                  minTickGap={20}
                />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload as {
                      count: number
                      totalDuration: number
                      totalDistance: number
                      singleName?: string
                    }
                    const durMin = Math.round(p.totalDuration / 60)
                    const durHrs = p.totalDuration / 3600
                    const distKm = p.totalDistance / 1000
                    return (
                      <div className="bg-card border rounded-lg shadow-md p-3 text-sm space-y-1">
                        <div className="font-medium">{formatBucketLabel(label as string, chartAgg, true)}</div>
                        {p.count === 1 ? (
                          <>
                            <div className="text-xs text-muted-foreground">{p.singleName}</div>
                            <div>Durata: <span className="tabular-nums font-medium">{durMin} min</span></div>
                            {p.totalDistance > 0 && (
                              <div>Distanza: <span className="tabular-nums font-medium">{distKm.toFixed(2)} km</span></div>
                            )}
                          </>
                        ) : (
                          <>
                            <div>Workout: <span className="tabular-nums font-medium">{p.count}</span></div>
                            <div>Durata totale: <span className="tabular-nums font-medium">{durHrs.toFixed(1)} h</span></div>
                            {p.totalDistance > 0 && (
                              <div>Distanza totale: <span className="tabular-nums font-medium">{distKm.toFixed(1)} km</span></div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  }}
                />
                <Bar dataKey="count" fill="#3b82f6" cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground mt-2">
              Click sulla barra: {chartAgg === "day" ? "apre il workout (se unico)" : "zoom sul periodo"}
            </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Elenco workout</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="h-40 animate-pulse bg-muted rounded" />}
          {!isLoading && workouts && workouts.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Attivita</TableHead>
                  <TableHead className="text-right">Durata</TableHead>
                  <TableHead className="text-right">Distanza</TableHead>
                  <TableHead className="text-right">Ritmo</TableHead>
                  <TableHead className="text-right">Calorie</TableHead>
                  <TableHead className="hidden md:table-cell">Sorgente</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workouts.map(w => (
                  <TableRow
                    key={w.uuid}
                    className="cursor-pointer"
                    onClick={() => navigate(`/workouts/${w.uuid}`)}
                  >
                    <TableCell>{formatDateTime(w.start_date)}</TableCell>
                    <TableCell>{w.activity_name ?? workoutName(w.activity_type)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {w.duration ? `${Math.round(w.duration / 60)} min` : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {w.total_distance ? `${(w.total_distance / 1000).toFixed(2)} km` : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPace(w.duration, w.total_distance)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {w.total_energy_burned ? `${formatNumber(w.total_energy_burned)} kcal` : "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">{w.source_name ?? "-"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={(e) => onDelete(w, e)}
                        aria-label="Elimina"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!workouts || workouts.length === 0) && (
            <p className="text-muted-foreground py-4">Nessun workout</p>
          )}
        </CardContent>
      </Card>

      {undoSnapshot && (
        <div className="fixed bottom-6 right-6 bg-card border shadow-lg rounded-lg p-3 flex items-center gap-3 z-50 animate-in slide-in-from-bottom-4">
          <div className="text-sm">
            <p className="font-medium">Workout eliminato</p>
            <p className="text-muted-foreground text-xs">{undoSnapshot.name}</p>
          </div>
          <Button size="sm" variant="outline" onClick={doUndo}>
            <Undo2 className="h-4 w-4 mr-1" /> Annulla
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
            if (undoSnapshot) clearTimeout(undoSnapshot.timeoutId)
            setUndoSnapshot(null)
          }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
