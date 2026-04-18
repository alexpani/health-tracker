import { useMemo } from "react"
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
import { useSamples, useWorkoutByUuid, useWorkoutSplits } from "@/lib/queries"
import { workoutName } from "@/lib/healthkit"
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

  const name = workout.activity_name ?? workoutName(workout.activity_type)
  const distanceKm = workout.total_distance ? workout.total_distance / 1000 : null

  const timeAxisFmt = (iso: string) => new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })

  return (
    <div className="space-y-6">
      <div>
        <Link to="/workouts">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ChevronLeft className="h-4 w-4 mr-1" /> Indietro
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">{name}</h1>
        <p className="text-muted-foreground">
          {formatDateTime(workout.start_date)} — durata {formatDuration(workout.duration)}
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

      {splitsData && splitsData.splits.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Parziali (per km)</CardTitle></CardHeader>
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
                {splitsData.splits.map(s => (
                  <TableRow key={s.n}>
                    <TableCell className="font-medium">{s.n}</TableCell>
                    <TableCell className="tabular-nums">
                      {s.distance_km.toFixed(2)} km {s.partial && <span className="text-xs text-muted-foreground">(parziale)</span>}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatDuration(s.duration_seconds)}</TableCell>
                    <TableCell className="tabular-nums">{formatPace(s.pace_sec_per_km)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.avg_heart_rate !== null ? `${s.avg_heart_rate} bpm` : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {hrChartData.length > 0 && (
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
                <Tooltip labelFormatter={timeAxisFmt} formatter={(v: number) => [`${v.toFixed(2)} km/h`, "Velocita'"]} />
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
