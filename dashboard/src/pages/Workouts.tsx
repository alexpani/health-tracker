import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, Trash2, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { WorkoutFiltersSidebar } from "@/components/WorkoutFiltersSidebar"
import { useDeleteWorkout, useRestoreWorkout, useWorkouts } from "@/lib/queries"
import { workoutDisplayTitle, workoutName } from "@/lib/healthkit"
import { formatDateTime, formatNumber } from "@/lib/utils"
import type { Workout, WorkoutFilters } from "@/lib/types"

type ChartAggregation = "day" | "week" | "month" | "all"

type SortKey = "start_date" | "title" | "activity" | "duration" | "distance" | "pace" | "calories" | "source" | "notes"
type SortDir = "asc" | "desc"

function compare<T>(a: T, b: T, dir: SortDir): number {
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (a < b) return dir === "asc" ? -1 : 1
  if (a > b) return dir === "asc" ? 1 : -1
  return 0
}

function paceSecPerKm(w: Workout): number | null {
  if (!w.duration || !w.total_distance || w.total_distance <= 0) return null
  return w.duration / (w.total_distance / 1000)
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
    const day = (tmp.getDay() + 6) % 7
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
    const d = new Date(key); d.setHours(0, 0, 0, 0)
    const end = new Date(d); end.setHours(23, 59, 59, 999)
    return { start: d.toISOString(), end: end.toISOString() }
  }
  if (agg === "week") {
    const d = new Date(key); d.setHours(0, 0, 0, 0)
    const end = new Date(d.getTime() + 7 * 24 * 3600 * 1000 - 1)
    return { start: d.toISOString(), end: end.toISOString() }
  }
  if (agg === "month") {
    const [y, m] = key.split("-").map(Number)
    return { start: new Date(y, m - 1, 1).toISOString(), end: new Date(y, m, 0, 23, 59, 59, 999).toISOString() }
  }
  const y = Number(key)
  return { start: new Date(y, 0, 1).toISOString(), end: new Date(y, 11, 31, 23, 59, 59, 999).toISOString() }
}

function nextFinerAggregation(agg: ChartAggregation): ChartAggregation | null {
  if (agg === "all") return "month"
  if (agg === "month") return "week"
  if (agg === "week") return "day"
  return null
}

export default function Workouts() {
  const navigate = useNavigate()
  const deleteWorkout = useDeleteWorkout()
  const restoreWorkout = useRestoreWorkout()

  // Persisted state
  const STORAGE_KEY = "workouts_filters_v2"
  const saved = useMemo<any>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  }, [])

  const [filters, setFilters] = useState<WorkoutFilters>(saved.filters ?? {})
  const [chartAgg, setChartAgg] = useState<ChartAggregation>(saved.chartAgg ?? "week")
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>(saved.sortKey ?? "start_date")
  const [sortDir, setSortDir] = useState<SortDir>(saved.sortDir ?? "desc")

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters, chartAgg, sortKey, sortDir }))
    } catch {}
  }, [filters, chartAgg, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDir(key === "start_date" || key === "duration" || key === "distance" || key === "calories" ? "desc" : "asc")
    }
  }

  const SortHeader = ({ k, children, align = "left" }: { k: SortKey; children: React.ReactNode; align?: "left" | "right" }) => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className={`inline-flex items-center gap-1 font-medium hover:text-foreground ${align === "right" ? "flex-row-reverse w-full justify-end" : ""}`}
    >
      {children}
      {sortKey === k ? (
        sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  )

  const { data: rawWorkouts, isLoading } = useWorkouts(filters)

  const workouts = useMemo(() => {
    if (!rawWorkouts) return rawWorkouts
    const arr = [...rawWorkouts]
    arr.sort((a, b) => {
      switch (sortKey) {
        case "start_date": return compare(a.start_date, b.start_date, sortDir)
        case "title":      return compare((a.title ?? "").toLowerCase(), (b.title ?? "").toLowerCase(), sortDir)
        case "activity":   return compare(workoutName(a.activity_type, a.metadata), workoutName(b.activity_type, b.metadata), sortDir)
        case "duration":   return compare(a.duration ?? -1, b.duration ?? -1, sortDir)
        case "distance":   return compare(a.total_distance ?? -1, b.total_distance ?? -1, sortDir)
        case "pace":       return compare(paceSecPerKm(a) ?? Infinity, paceSecPerKm(b) ?? Infinity, sortDir)
        case "calories":   return compare(a.total_energy_burned ?? -1, b.total_energy_burned ?? -1, sortDir)
        case "source":     return compare(a.source_name ?? "", b.source_name ?? "", sortDir)
        case "notes":      return compare((a.notes ?? "").toLowerCase(), (b.notes ?? "").toLowerCase(), sortDir)
      }
    })
    return arr
  }, [rawWorkouts, sortKey, sortDir])

  // Undo snapshot
  const [undoSnapshot, setUndoSnapshot] = useState<{
    snapshot: Record<string, unknown>
    name: string
    timeoutId: ReturnType<typeof setTimeout>
  } | null>(null)

  useEffect(() => {
    return () => { if (undoSnapshot) clearTimeout(undoSnapshot.timeoutId) }
  }, [undoSnapshot])

  const onDelete = async (w: Workout, ev: React.MouseEvent) => {
    ev.stopPropagation()
    const name = workoutName(w.activity_type, w.metadata)
    if (!confirm(`Eliminare il workout "${name}" del ${formatDateTime(w.start_date)}?`)) return
    try {
      const result = await deleteWorkout.mutateAsync(w.uuid)
      if (undoSnapshot) clearTimeout(undoSnapshot.timeoutId)
      const timeoutId = setTimeout(() => setUndoSnapshot(null), 8000)
      setUndoSnapshot({ snapshot: result.snapshot, name, timeoutId })
    } catch (err) {
      alert("Errore: " + (err as Error).message)
    }
  }

  const doUndo = async () => {
    if (!undoSnapshot) return
    clearTimeout(undoSnapshot.timeoutId)
    try { await restoreWorkout.mutateAsync(undoSnapshot.snapshot) }
    catch (err) { alert("Errore ripristino: " + (err as Error).message) }
    setUndoSnapshot(null)
  }

  const stats = useMemo(() => {
    if (!workouts) return { count: 0, totalDuration: 0, totalDistance: 0, totalCalories: 0 }
    return workouts.reduce((acc, w) => ({
      count: acc.count + 1,
      totalDuration: acc.totalDuration + (w.duration ?? 0),
      totalDistance: acc.totalDistance + (w.total_distance ?? 0),
      totalCalories: acc.totalCalories + (w.total_energy_burned ?? 0),
    }), { count: 0, totalDuration: 0, totalDistance: 0, totalCalories: 0 })
  }, [workouts])

  const chartData = useMemo(() => {
    if (!workouts) return []
    type Bucket = {
      key: string; count: number; uuids: string[]
      totalDuration: number; totalDistance: number; singleName?: string
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
      if (b.count === 1) b.singleName = workoutName(w.activity_type, w.metadata)
      else b.singleName = undefined
    })
    return Array.from(buckets.values()).sort((a, b) => (a.key < b.key ? -1 : 1))
  }, [workouts, chartAgg])

  const onBarClick = (d: any) => {
    if (!d) return
    const key: string | undefined = d.key ?? d.payload?.key
    const uuids: string[] | undefined = d.uuids ?? d.payload?.uuids
    if (!key) return
    if (uuids && uuids.length === 1) {
      navigate(`/workouts/${uuids[0]}`)
      return
    }
    const rng = bucketRange(key, chartAgg)
    setFilters({ ...filters, start: rng.start, end: rng.end })
    const finer = nextFinerAggregation(chartAgg)
    if (finer) setChartAgg(finer)
  }

  const activeFiltersCount = [
    filters.start, filters.end,
    filters.years?.length, filters.effective_types?.length, filters.sources?.length,
    filters.distance_min !== undefined ? 1 : undefined,
    filters.distance_max !== undefined ? 1 : undefined,
    filters.duration_min !== undefined ? 1 : undefined,
    filters.duration_max !== undefined ? 1 : undefined,
    filters.pace_min !== undefined ? 1 : undefined,
    filters.pace_max !== undefined ? 1 : undefined,
  ].filter(Boolean).length

  return (
    <div className="flex gap-6 -m-6 p-0 min-h-[calc(100vh-0px)]">
      {/* Sidebar desktop a SINISTRA */}
      <aside className="hidden lg:block w-[320px] shrink-0 border-r bg-card/30 sticky top-0 h-screen overflow-hidden">
        <WorkoutFiltersSidebar value={filters} onChange={setFilters} />
      </aside>

      <div className="flex-1 space-y-6 min-w-0 p-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Workout</h1>
            <p className="text-muted-foreground">Cronologia allenamenti</p>
          </div>
          <Button variant="outline" className="lg:hidden" onClick={() => setShowMobileFilters(true)}>
            <Filter className="h-4 w-4 mr-2" />
            Filtri {activeFiltersCount > 0 && <span className="ml-1 bg-primary text-primary-foreground rounded-full px-2 text-xs">{activeFiltersCount}</span>}
          </Button>
        </div>

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
                      const p = payload[0].payload as any
                      const durMin = Math.round(p.totalDuration / 60)
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
                              <div>Durata totale: <span className="tabular-nums font-medium">{durMin} min</span></div>
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
          <CardHeader><CardTitle>Elenco workout</CardTitle></CardHeader>
          <CardContent>
            {isLoading && <div className="h-40 animate-pulse bg-muted rounded" />}
            {!isLoading && workouts && workouts.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><SortHeader k="start_date">Data</SortHeader></TableHead>
                    <TableHead><SortHeader k="title">Titolo</SortHeader></TableHead>
                    <TableHead><SortHeader k="activity">Attivita</SortHeader></TableHead>
                    <TableHead className="text-right"><SortHeader k="duration" align="right">Durata</SortHeader></TableHead>
                    <TableHead className="text-right"><SortHeader k="distance" align="right">Distanza</SortHeader></TableHead>
                    <TableHead className="text-right"><SortHeader k="pace" align="right">Ritmo</SortHeader></TableHead>
                    <TableHead className="text-right"><SortHeader k="calories" align="right">Calorie</SortHeader></TableHead>
                    <TableHead className="hidden md:table-cell"><SortHeader k="source">Sorgente</SortHeader></TableHead>
                    <TableHead className="hidden lg:table-cell max-w-[280px]"><SortHeader k="notes">Note</SortHeader></TableHead>
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workouts.map(w => (
                    <TableRow key={w.uuid} className="cursor-pointer" onClick={() => navigate(`/workouts/${w.uuid}`)}>
                      <TableCell>{formatDateTime(w.start_date)}</TableCell>
                      <TableCell
                        className="max-w-[220px] truncate font-medium"
                        title={w.title ?? ""}
                      >
                        {w.title ?? <span className="text-muted-foreground font-normal">—</span>}
                      </TableCell>
                      <TableCell>{workoutName(w.activity_type, w.metadata)}</TableCell>
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
                      <TableCell
                        className="hidden lg:table-cell text-muted-foreground text-xs max-w-[280px] truncate"
                        title={w.notes ?? ""}
                      >
                        {w.notes ?? "-"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => onDelete(w, e)} aria-label="Elimina"
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
      </div>

      {/* Sidebar mobile: overlay */}
      {showMobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileFilters(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[85%] max-w-[360px] bg-background shadow-xl">
            <WorkoutFiltersSidebar
              value={filters}
              onChange={setFilters}
              onClose={() => setShowMobileFilters(false)}
            />
          </div>
        </div>
      )}

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
