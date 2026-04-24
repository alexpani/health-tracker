import { useMemo } from "react"
import { Link } from "react-router-dom"
import { Activity, Dumbbell, Flame, Footprints, Moon, StretchHorizontal } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetricCard } from "@/components/charts/MetricCard"
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart"
import {
  useCategories,
  useLatest,
  useSamples,
  useStretchingSessions,
  useSyncSessions,
  useSyncStatus,
  useWorkouts,
} from "@/lib/queries"
import { getMeta, SLEEP_STAGES, workoutDisplayTitle } from "@/lib/healthkit"
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils"
import type { CategorySample, StretchingSession, Workout } from "@/lib/types"

export default function Home() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startOfWeek = new Date()
  startOfWeek.setDate(startOfWeek.getDate() - 7)
  const startOf24h = new Date()
  startOf24h.setHours(startOf24h.getHours() - 24)

  const steps = useSamples({
    type: "HKQuantityTypeIdentifierStepCount",
    start: today.toISOString(),
    aggregation: "daily",
  })
  const activeCal = useSamples({
    type: "HKQuantityTypeIdentifierActiveEnergyBurned",
    start: today.toISOString(),
    aggregation: "daily",
  })
  const latestWeight = useLatest("HKQuantityTypeIdentifierBodyMass")

  const stepsWeek = useSamples({
    type: "HKQuantityTypeIdentifierStepCount",
    start: startOfWeek.toISOString(),
    aggregation: "daily",
  })

  const workouts = useWorkouts({})
  const status = useSyncStatus()
  const sessions = useSyncSessions(10)

  // Sonno ultima notte: fetch fasi delle ultime 36h, raggruppa per "data
  // di risveglio" (end_date) e prendi il gruppo più recente.
  const startOf36h = new Date()
  startOf36h.setHours(startOf36h.getHours() - 36)
  const sleepCats = useCategories(
    "HKCategoryTypeIdentifierSleepAnalysis",
    startOf36h.toISOString(),
    new Date().toISOString(),
  )
  const lastNightSleep = useMemo(() => computeLastNightSleep(sleepCats.data), [sleepCats.data])

  // Workout di oggi o ieri — più recente
  const recentWorkout = useMemo(() => pickRecentWorkout(workouts.data ?? []), [workouts.data])

  // Stretching di oggi o ieri
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const strDay = useStretchingSessions(
    yesterday.toISOString().slice(0, 10),
    new Date().toISOString().slice(0, 10),
  )
  const recentStretch = useMemo(() => pickRecentStretch(strDay.data ?? []), [strDay.data])

  const stepsTodayTotal = steps.data?.data?.[0] && "avg" in steps.data.data[0]
    ? (steps.data.data[0] as any).avg * (steps.data.data[0] as any).count
    : 0
  const calTodayTotal = activeCal.data?.data?.[0] && "avg" in activeCal.data.data[0]
    ? (activeCal.data.data[0] as any).avg * (activeCal.data.data[0] as any).count
    : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Panoramica dei tuoi dati di salute</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Passi oggi"
          value={formatNumber(stepsTodayTotal)}
          icon={Footprints}
          color={getMeta("HKQuantityTypeIdentifierStepCount").color}
          loading={steps.isLoading}
        />
        <MetricCard
          label="Calorie attive"
          value={formatNumber(calTodayTotal)}
          unit="kcal"
          icon={Flame}
          color={getMeta("HKQuantityTypeIdentifierActiveEnergyBurned").color}
          loading={activeCal.isLoading}
        />
        <MetricCard
          label="Sonno notte scorsa"
          value={lastNightSleep ? formatHours(lastNightSleep.asleepMinutes) : "-"}
          icon={Moon}
          color="#3b82f6"
          subtitle={
            lastNightSleep ? `al risveglio del ${formatDate(lastNightSleep.wakeDate)}` : undefined
          }
          loading={sleepCats.isLoading}
        />
        <MetricCard
          label="Peso (ultimo)"
          value={latestWeight.data?.data?.value ? latestWeight.data.data.value.toFixed(2) : "-"}
          unit="kg"
          icon={Activity}
          color={getMeta("HKQuantityTypeIdentifierBodyMass").color}
          subtitle={latestWeight.data?.data?.start_date ? formatDateTime(latestWeight.data.data.start_date) : undefined}
          loading={latestWeight.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Dumbbell className="h-4 w-4" />
              Workout recente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentWorkout ? (
              <WorkoutRecentBody workout={recentWorkout} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nessun workout nelle ultime 36h.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <StretchHorizontal className="h-4 w-4" />
              Stretching recente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentStretch ? (
              <StretchRecentBody session={recentStretch} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nessuna sessione stretching nelle ultime 36h.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Passi ultimi 7 giorni</CardTitle>
          </CardHeader>
          <CardContent>
            {stepsWeek.data && (
              <TimeSeriesChart
                type="HKQuantityTypeIdentifierStepCount"
                data={stepsWeek.data.data}
                aggregation="daily"
                chartType="bar"
                height={180}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Ultimi workout</CardTitle>
          </CardHeader>
          <CardContent>
            {workouts.data && workouts.data.length > 0 ? (
              <div className="space-y-2">
                {workouts.data.slice(0, 5).map(w => (
                  <Link key={w.uuid} to={`/workouts/${w.uuid}`} className="flex justify-between items-center py-2 border-b last:border-0 hover:bg-accent/40 rounded px-2 -mx-2">
                    <div>
                      <p className="font-medium">{workoutDisplayTitle(w)}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(w.start_date)}</p>
                    </div>
                    <div className="text-right text-sm">
                      {w.duration && <p>{Math.round(w.duration / 60)} min</p>}
                      {w.total_distance && <p className="text-muted-foreground">{(w.total_distance / 1000).toFixed(2)} km</p>}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nessun workout</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stato sincronizzazione</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Campioni totali</span>
              <span className="font-medium tabular-nums">{formatNumber(status.data?.total_samples ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sonno</span>
              <span className="font-medium tabular-nums">{formatNumber(status.data?.total_categories ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Workout</span>
              <span className="font-medium tabular-nums">{formatNumber(status.data?.total_workouts ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tipi distinti</span>
              <span className="font-medium tabular-nums">{status.data?.types.length ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ultima sync</span>
              <span className="font-medium">
                {status.data?.last_sync ? formatDateTime(status.data.last_sync) : "-"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ultime sincronizzazioni</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.data && sessions.data.length > 0 ? (
            <div className="space-y-1 text-sm">
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground border-b pb-2">
                <div className="col-span-5">Quando</div>
                <div className="col-span-2 text-right">Campioni</div>
                <div className="col-span-2 text-right">Batch</div>
                <div className="col-span-3 text-right">Durata</div>
              </div>
              {sessions.data.map((s, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 py-1.5 border-b last:border-0">
                  <div className="col-span-5">
                    <span className="font-medium">{formatDateTime(s.started_at)}</span>
                  </div>
                  <div className="col-span-2 text-right tabular-nums">{formatNumber(s.total_samples)}</div>
                  <div className="col-span-2 text-right tabular-nums text-muted-foreground">{s.batches}</div>
                  <div className="col-span-3 text-right tabular-nums text-muted-foreground">
                    {formatDuration(s.duration_seconds)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nessuna sync registrata</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m < 60) return `${m}m ${sec}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}h ${m.toString().padStart(2, "0")}m`
}

// Raggruppa i sample sonno per data di risveglio; ritorna il più recente,
// sommando i minuti di Core/Deep/REM (= tempo realmente addormentato).
function computeLastNightSleep(
  samples: CategorySample[] | undefined
): { wakeDate: string; asleepMinutes: number } | null {
  if (!samples || samples.length === 0) return null
  const byNight: Record<string, number> = {}
  const ASLEEP_VALUES = [3, 4, 5] // Core, Deep, REM in SLEEP_STAGES
  for (const s of samples) {
    const end = new Date(s.end_date)
    const key = new Date(end.getFullYear(), end.getMonth(), end.getDate())
      .toISOString()
      .slice(0, 10)
    if (!ASLEEP_VALUES.includes(s.value)) continue
    const durationMin = (end.getTime() - new Date(s.start_date).getTime()) / 60_000
    byNight[key] = (byNight[key] ?? 0) + durationMin
  }
  const entries = Object.entries(byNight).sort(([a], [b]) => (a < b ? 1 : -1))
  if (entries.length === 0) return null
  const [wakeDate, asleepMinutes] = entries[0]
  return { wakeDate, asleepMinutes }
}

function pickRecentWorkout(list: Workout[]): Workout | null {
  if (list.length === 0) return null
  const cutoff = Date.now() - 36 * 3600_000
  // Lista ordinata dal backend per start_date desc.
  for (const w of list) {
    if (new Date(w.start_date).getTime() >= cutoff) return w
  }
  return null
}

function pickRecentStretch(list: StretchingSession[]): StretchingSession | null {
  if (list.length === 0) return null
  const cutoff = Date.now() - 36 * 3600_000
  const sorted = [...list].sort((a, b) =>
    b.started_at.localeCompare(a.started_at)
  )
  for (const s of sorted) {
    if (new Date(s.started_at).getTime() >= cutoff) return s
  }
  return null
}

function WorkoutRecentBody({ workout }: { workout: Workout }) {
  return (
    <Link
      to={`/workouts/${workout.uuid}`}
      className="block hover:bg-accent/40 rounded p-2 -m-2"
    >
      <p className="font-medium">{workoutDisplayTitle(workout)}</p>
      <p className="text-xs text-muted-foreground">
        {formatDateTime(workout.start_date)}
      </p>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {workout.duration != null && (
          <span>
            <span className="text-muted-foreground">durata:</span>{" "}
            <span className="font-mono">
              {Math.round(workout.duration / 60)} min
            </span>
          </span>
        )}
        {workout.total_distance != null && workout.total_distance > 0 && (
          <span>
            <span className="text-muted-foreground">distanza:</span>{" "}
            <span className="font-mono">
              {(workout.total_distance / 1000).toFixed(2)} km
            </span>
          </span>
        )}
        {workout.total_energy_burned != null && workout.total_energy_burned > 0 && (
          <span>
            <span className="text-muted-foreground">kcal:</span>{" "}
            <span className="font-mono">
              {Math.round(workout.total_energy_burned)}
            </span>
          </span>
        )}
      </div>
    </Link>
  )
}

function StretchRecentBody({ session }: { session: StretchingSession }) {
  const minutes = Math.round(session.duration_sec / 60)
  const completedItems = session.items_total - session.items_skipped
  return (
    <Link to="/stretching" className="block hover:bg-accent/40 rounded p-2 -m-2">
      <p className="font-medium">{session.routine_name}</p>
      <p className="text-xs text-muted-foreground">
        {formatDateTime(session.started_at)}
      </p>
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        <span>
          <span className="text-muted-foreground">durata:</span>{" "}
          <span className="font-mono">{minutes} min</span>
        </span>
        <span>
          <span className="text-muted-foreground">esercizi:</span>{" "}
          <span className="font-mono">
            {completedItems}/{session.items_total}
          </span>
        </span>
        {session.notes && (
          <span className="text-xs text-muted-foreground italic">
            {session.notes}
          </span>
        )}
      </div>
    </Link>
  )
}
