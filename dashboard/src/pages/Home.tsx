import { Activity, Flame, Footprints, Heart, Moon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MetricCard } from "@/components/charts/MetricCard"
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart"
import { useLatest, useSamples, useSyncSessions, useSyncStatus, useWorkouts } from "@/lib/queries"
import { getMeta, workoutName } from "@/lib/healthkit"
import { formatDateTime, formatNumber } from "@/lib/utils"

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
  const latestHR = useLatest("HKQuantityTypeIdentifierHeartRate")
  const latestWeight = useLatest("HKQuantityTypeIdentifierBodyMass")

  const stepsWeek = useSamples({
    type: "HKQuantityTypeIdentifierStepCount",
    start: startOfWeek.toISOString(),
    aggregation: "daily",
  })
  const hrDay = useSamples({
    type: "HKQuantityTypeIdentifierHeartRate",
    start: startOf24h.toISOString(),
    aggregation: "hourly",
  })

  const workouts = useWorkouts({})
  const status = useSyncStatus()
  const sessions = useSyncSessions(10)

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
          label="Battito (ultimo)"
          value={latestHR.data?.data?.value ? formatNumber(latestHR.data.data.value) : "-"}
          unit="bpm"
          icon={Heart}
          color={getMeta("HKQuantityTypeIdentifierHeartRate").color}
          subtitle={latestHR.data?.data?.start_date ? formatDateTime(latestHR.data.data.start_date) : undefined}
          loading={latestHR.isLoading}
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Passi ultimi 7 giorni</CardTitle>
          </CardHeader>
          <CardContent>
            {stepsWeek.data && (
              <TimeSeriesChart
                type="HKQuantityTypeIdentifierStepCount"
                data={stepsWeek.data.data}
                aggregation="daily"
                chartType="bar"
                height={250}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Battito ultime 24h</CardTitle>
          </CardHeader>
          <CardContent>
            {hrDay.data && (
              <TimeSeriesChart
                type="HKQuantityTypeIdentifierHeartRate"
                data={hrDay.data.data}
                aggregation="hourly"
                chartType="line"
                height={250}
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
                  <div key={w.uuid} className="flex justify-between items-center py-2 border-b last:border-0">
                    <div>
                      <p className="font-medium">{w.activity_name ?? workoutName(w.activity_type)}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(w.start_date)}</p>
                    </div>
                    <div className="text-right text-sm">
                      {w.duration && <p>{Math.round(w.duration / 60)} min</p>}
                      {w.total_distance && <p className="text-muted-foreground">{(w.total_distance / 1000).toFixed(2)} km</p>}
                    </div>
                  </div>
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
