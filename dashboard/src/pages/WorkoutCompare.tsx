import { useMemo } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ChevronLeft, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CompareLineChart } from "@/components/CompareLineChart"
import { useSamples, useWorkoutByUuid, useWorkoutSplits } from "@/lib/queries"
import { workoutDisplayTitle, workoutName } from "@/lib/healthkit"
import { formatDateTime, formatNumber } from "@/lib/utils"
import {
  deriveEffectiveType,
  diffMetric,
  formatElapsed,
  formatPaceSecPerKm,
  formatSignedSeconds,
  mergeSplits,
  toElapsedSeries,
} from "@/lib/compareUtils"
import type { Sample, WorkoutDetail } from "@/lib/types"

const COLOR_A = "#3b82f6"
const COLOR_B = "#f97316"

function paceSecPerKm(duration: number | null, distance: number | null): number | null {
  if (!duration || !distance || distance <= 0) return null
  return duration / (distance / 1000)
}

function avgHR(samples: Sample[] | undefined): number | null {
  if (!samples || samples.length === 0) return null
  return samples.reduce((s, x) => s + x.value, 0) / samples.length
}

function maxHR(samples: Sample[] | undefined): number | null {
  if (!samples || samples.length === 0) return null
  return Math.max(...samples.map(s => s.value))
}

interface MetricRowProps {
  label: string
  a: string
  b: string
  delta?: string
  betterIsA?: boolean | null
}

function MetricRow({ label, a, b, delta, betterIsA }: MetricRowProps) {
  const deltaClass =
    betterIsA === true ? "text-green-600 dark:text-green-400"
    : betterIsA === false ? "text-red-600 dark:text-red-400"
    : "text-muted-foreground"
  return (
    <div className="grid grid-cols-[1fr,auto,auto,auto] items-baseline gap-x-6 py-2 border-b last:border-b-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="tabular-nums font-medium" style={{ color: COLOR_A }}>{a}</p>
      <p className="tabular-nums font-medium" style={{ color: COLOR_B }}>{b}</p>
      <p className={`tabular-nums text-sm ${deltaClass} w-24 text-right`}>{delta ?? ""}</p>
    </div>
  )
}

function WorkoutHeaderCard({
  workout, color, label,
}: { workout: WorkoutDetail; color: string; label: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: color }} />
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <Link to={`/workouts/${workout.uuid}`} className="text-lg font-semibold hover:underline block">
          {workoutDisplayTitle(workout)}
        </Link>
        <p className="text-sm text-muted-foreground">{workoutName(workout.activity_type, workout.metadata)}</p>
        <p className="text-sm text-muted-foreground">{formatDateTime(workout.start_date)}</p>
        {workout.source_name && (
          <p className="text-xs text-muted-foreground">Sorgente: {workout.source_name}</p>
        )}
      </CardContent>
    </Card>
  )
}

export default function WorkoutCompare() {
  const [searchParams] = useSearchParams()
  const uuidA = searchParams.get("a") ?? undefined
  const uuidB = searchParams.get("b") ?? undefined

  const wA = useWorkoutByUuid(uuidA)
  const wB = useWorkoutByUuid(uuidB)
  const splitsA = useWorkoutSplits(uuidA)
  const splitsB = useWorkoutSplits(uuidB)

  const hrA = useSamples({
    type: "HKQuantityTypeIdentifierHeartRate",
    start: wA.data?.start_date, end: wA.data?.end_date,
    aggregation: "none", limit: 5000,
  }, !!wA.data)
  const hrB = useSamples({
    type: "HKQuantityTypeIdentifierHeartRate",
    start: wB.data?.start_date, end: wB.data?.end_date,
    aggregation: "none", limit: 5000,
  }, !!wB.data)

  const speedA = useSamples({
    type: "HKQuantityTypeIdentifierRunningSpeed",
    start: wA.data?.start_date, end: wA.data?.end_date,
    aggregation: "none", limit: 5000,
  }, !!wA.data)
  const speedB = useSamples({
    type: "HKQuantityTypeIdentifierRunningSpeed",
    start: wB.data?.start_date, end: wB.data?.end_date,
    aggregation: "none", limit: 5000,
  }, !!wB.data)

  const powerA = useSamples({
    type: "HKQuantityTypeIdentifierRunningPower",
    start: wA.data?.start_date, end: wA.data?.end_date,
    aggregation: "none", limit: 5000,
  }, !!wA.data)
  const powerB = useSamples({
    type: "HKQuantityTypeIdentifierRunningPower",
    start: wB.data?.start_date, end: wB.data?.end_date,
    aggregation: "none", limit: 5000,
  }, !!wB.data)

  const cadenceA = useSamples({
    type: "HKQuantityTypeIdentifierCyclingCadence",
    start: wA.data?.start_date, end: wA.data?.end_date,
    aggregation: "none", limit: 5000,
  }, !!wA.data)
  const cadenceB = useSamples({
    type: "HKQuantityTypeIdentifierCyclingCadence",
    start: wB.data?.start_date, end: wB.data?.end_date,
    aggregation: "none", limit: 5000,
  }, !!wB.data)

  const hrSamplesA = hrA.data?.data as Sample[] | undefined
  const hrSamplesB = hrB.data?.data as Sample[] | undefined

  const labelA = wA.data ? `A · ${formatDateTime(wA.data.start_date).split(",")[0]}` : "A"
  const labelB = wB.data ? `B · ${formatDateTime(wB.data.start_date).split(",")[0]}` : "B"

  const hrSeriesA = useMemo(
    () => wA.data ? toElapsedSeries(hrSamplesA, wA.data.start_date) : [],
    [hrSamplesA, wA.data])
  const hrSeriesB = useMemo(
    () => wB.data ? toElapsedSeries(hrSamplesB, wB.data.start_date) : [],
    [hrSamplesB, wB.data])

  const speedSeriesA = useMemo(
    () => wA.data ? toElapsedSeries(speedA.data?.data as Sample[] | undefined, wA.data.start_date, v => v * 3.6) : [],
    [speedA.data, wA.data])
  const speedSeriesB = useMemo(
    () => wB.data ? toElapsedSeries(speedB.data?.data as Sample[] | undefined, wB.data.start_date, v => v * 3.6) : [],
    [speedB.data, wB.data])

  const powerSeriesA = useMemo(
    () => wA.data ? toElapsedSeries(powerA.data?.data as Sample[] | undefined, wA.data.start_date) : [],
    [powerA.data, wA.data])
  const powerSeriesB = useMemo(
    () => wB.data ? toElapsedSeries(powerB.data?.data as Sample[] | undefined, wB.data.start_date) : [],
    [powerB.data, wB.data])

  const cadenceSeriesA = useMemo(
    () => wA.data ? toElapsedSeries(cadenceA.data?.data as Sample[] | undefined, wA.data.start_date) : [],
    [cadenceA.data, wA.data])
  const cadenceSeriesB = useMemo(
    () => wB.data ? toElapsedSeries(cadenceB.data?.data as Sample[] | undefined, wB.data.start_date) : [],
    [cadenceB.data, wB.data])

  const mergedSplits = useMemo(
    () => mergeSplits(splitsA.data?.splits, splitsB.data?.splits),
    [splitsA.data, splitsB.data])

  if (!uuidA || !uuidB) {
    return (
      <div className="space-y-4">
        <Link to="/workouts">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ChevronLeft className="h-4 w-4 mr-1" /> Indietro
          </Button>
        </Link>
        <p className="text-muted-foreground">
          Seleziona due workout dall'elenco per confrontarli. URL atteso: <code>?a=UUID&amp;b=UUID</code>.
        </p>
      </div>
    )
  }

  if (wA.isLoading || wB.isLoading) {
    return <p className="text-muted-foreground">Caricamento workout...</p>
  }

  if (!wA.data || !wB.data) {
    return <p className="text-muted-foreground">Uno o entrambi i workout non sono stati trovati.</p>
  }

  const a = wA.data
  const b = wB.data

  const effA = deriveEffectiveType(a)
  const effB = deriveEffectiveType(b)
  const sameType = effA === effB

  const paceA = paceSecPerKm(a.duration, a.total_distance)
  const paceB = paceSecPerKm(b.duration, b.total_distance)
  const avgHrA = avgHR(hrSamplesA)
  const avgHrB = avgHR(hrSamplesB)
  const maxHrA = maxHR(hrSamplesA)
  const maxHrB = maxHR(hrSamplesB)

  const durationDiff = diffMetric(a.duration, b.duration, /* lowerIsBetter */ true)
  const distanceDiff = diffMetric(a.total_distance, b.total_distance, false)
  const caloriesDiff = diffMetric(a.total_energy_burned, b.total_energy_burned, false)
  const paceDiff = diffMetric(paceA, paceB, true)
  const avgHrDiff = diffMetric(avgHrA, avgHrB, true)
  const maxHrDiff = diffMetric(maxHrA, maxHrB, true)

  const fmtDurationDelta = (d: number | null) =>
    d == null ? "" : formatSignedSeconds(d)
  const fmtPaceDelta = (d: number | null) =>
    d == null ? "" : formatSignedSeconds(d) + "/km"
  const fmtNumDelta = (d: number | null, unit = "", precision = 0) =>
    d == null ? "" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toFixed(precision)}${unit ? " " + unit : ""}`

  return (
    <div className="space-y-6">
      <div>
        <Link to="/workouts">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ChevronLeft className="h-4 w-4 mr-1" /> Torna all'elenco
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">Confronto workout</h1>
        {!sameType && (
          <p className="text-amber-600 dark:text-amber-400 text-sm mt-1">
            Attenzione: i due workout hanno tipo diverso ({effA} vs {effB}). Confronto comunque mostrato.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <WorkoutHeaderCard workout={a} color={COLOR_A} label="Workout A" />
        <WorkoutHeaderCard workout={b} color={COLOR_B} label="Workout B" />
      </div>

      <Card>
        <CardHeader><CardTitle>Metriche principali</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-[1fr,auto,auto,auto] items-baseline gap-x-6 pb-2 border-b text-xs text-muted-foreground uppercase tracking-wider">
            <span />
            <span style={{ color: COLOR_A }}>A</span>
            <span style={{ color: COLOR_B }}>B</span>
            <span className="w-24 text-right">Δ (A − B)</span>
          </div>
          <MetricRow
            label="Durata"
            a={formatElapsed(a.duration ?? 0)}
            b={formatElapsed(b.duration ?? 0)}
            delta={fmtDurationDelta(durationDiff.delta)}
            betterIsA={durationDiff.betterIsA}
          />
          <MetricRow
            label="Distanza"
            a={a.total_distance ? `${(a.total_distance / 1000).toFixed(2)} km` : "-"}
            b={b.total_distance ? `${(b.total_distance / 1000).toFixed(2)} km` : "-"}
            delta={distanceDiff.delta != null ? fmtNumDelta(distanceDiff.delta / 1000, "km", 2) : ""}
            betterIsA={distanceDiff.betterIsA}
          />
          <MetricRow
            label="Ritmo medio"
            a={formatPaceSecPerKm(paceA)}
            b={formatPaceSecPerKm(paceB)}
            delta={fmtPaceDelta(paceDiff.delta)}
            betterIsA={paceDiff.betterIsA}
          />
          <MetricRow
            label="Calorie attive"
            a={a.total_energy_burned ? `${formatNumber(a.total_energy_burned)} kcal` : "-"}
            b={b.total_energy_burned ? `${formatNumber(b.total_energy_burned)} kcal` : "-"}
            delta={caloriesDiff.delta != null ? fmtNumDelta(caloriesDiff.delta, "kcal") : ""}
            betterIsA={caloriesDiff.betterIsA}
          />
          <MetricRow
            label="Battito medio"
            a={avgHrA != null ? `${Math.round(avgHrA)} bpm` : "-"}
            b={avgHrB != null ? `${Math.round(avgHrB)} bpm` : "-"}
            delta={avgHrDiff.delta != null ? fmtNumDelta(avgHrDiff.delta, "bpm") : ""}
            betterIsA={avgHrDiff.betterIsA}
          />
          <MetricRow
            label="Battito max"
            a={maxHrA != null ? `${Math.round(maxHrA)} bpm` : "-"}
            b={maxHrB != null ? `${Math.round(maxHrB)} bpm` : "-"}
            delta={maxHrDiff.delta != null ? fmtNumDelta(maxHrDiff.delta, "bpm") : ""}
            betterIsA={maxHrDiff.betterIsA}
          />
        </CardContent>
      </Card>

      {mergedSplits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Parziali per km</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Km</TableHead>
                  <TableHead className="text-right" style={{ color: COLOR_A }}>Ritmo A</TableHead>
                  <TableHead className="text-right" style={{ color: COLOR_A }}>HR A</TableHead>
                  <TableHead className="text-right" style={{ color: COLOR_B }}>Ritmo B</TableHead>
                  <TableHead className="text-right" style={{ color: COLOR_B }}>HR B</TableHead>
                  <TableHead className="text-right">Δ ritmo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mergedSplits.map(row => {
                  const aPart = row.a?.partial
                  const bPart = row.b?.partial
                  const deltaCls =
                    row.paceDelta == null ? "text-muted-foreground"
                    : row.paceDelta < 0 ? "text-green-600 dark:text-green-400"
                    : row.paceDelta > 0 ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground"
                  return (
                    <TableRow key={row.n}>
                      <TableCell className="tabular-nums">{row.n}{(aPart || bPart) && <span className="text-xs text-muted-foreground ml-1">(parz.)</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaceSecPerKm(row.a?.pace_sec_per_km)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{row.a?.avg_heart_rate != null ? Math.round(row.a.avg_heart_rate) : "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatPaceSecPerKm(row.b?.pace_sec_per_km)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{row.b?.avg_heart_rate != null ? Math.round(row.b.avg_heart_rate) : "-"}</TableCell>
                      <TableCell className={`text-right tabular-nums ${deltaCls}`}>{row.paceDelta != null ? formatSignedSeconds(row.paceDelta) : ""}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-2">
              Δ ritmo = A − B per km. Verde = A più veloce.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4">
        <CompareLineChart
          title="Frequenza cardiaca"
          unit="bpm"
          seriesA={hrSeriesA}
          seriesB={hrSeriesB}
          labelA={labelA}
          labelB={labelB}
        />
        <CompareLineChart
          title="Velocità"
          unit="km/h"
          seriesA={speedSeriesA}
          seriesB={speedSeriesB}
          labelA={labelA}
          labelB={labelB}
        />
        <CompareLineChart
          title="Potenza"
          unit="W"
          seriesA={powerSeriesA}
          seriesB={powerSeriesB}
          labelA={labelA}
          labelB={labelB}
        />
        <CompareLineChart
          title="Cadenza"
          unit="rpm"
          seriesA={cadenceSeriesA}
          seriesB={cadenceSeriesB}
          labelA={labelA}
          labelB={labelB}
        />
      </div>

      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Mappa GPS: confronto non disponibile in questa vista. Apri il singolo workout
            (<Link to={`/workouts/${a.uuid}`} className="underline">A <ArrowRight className="inline h-3 w-3" /></Link>
            {" · "}
            <Link to={`/workouts/${b.uuid}`} className="underline">B <ArrowRight className="inline h-3 w-3" /></Link>)
            per vedere il tracciato.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
