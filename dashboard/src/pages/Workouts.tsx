import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TimeRangeSelector, timeRangeToDates } from "@/components/controls/TimeRangeSelector"
import { useWorkouts } from "@/lib/queries"
import { WORKOUT_NAMES, workoutName } from "@/lib/healthkit"
import { formatDateTime, formatNumber } from "@/lib/utils"
import type { TimeRange } from "@/lib/types"

export default function Workouts() {
  const [range, setRange] = useState<TimeRange>("90d")
  const [activityType, setActivityType] = useState<string>("all")
  const dates = useMemo(() => timeRangeToDates(range), [range])
  const { data, isLoading } = useWorkouts(
    activityType === "all" ? undefined : Number(activityType),
    dates.start,
    dates.end
  )

  const navigate = useNavigate()

  const stats = useMemo(() => {
    if (!data) return { count: 0, totalDuration: 0, totalDistance: 0, totalCalories: 0 }
    return data.reduce(
      (acc, w) => ({
        count: acc.count + 1,
        totalDuration: acc.totalDuration + (w.duration ?? 0),
        totalDistance: acc.totalDistance + (w.total_distance ?? 0),
        totalCalories: acc.totalCalories + (w.total_energy_burned ?? 0),
      }),
      { count: 0, totalDuration: 0, totalDistance: 0, totalCalories: 0 }
    )
  }, [data])

  // Weekly frequency chart
  const weeklyData = useMemo(() => {
    if (!data) return []
    const weeks: Record<string, number> = {}
    data.forEach(w => {
      const d = new Date(w.start_date)
      // Monday of week
      const day = d.getDay() || 7
      d.setDate(d.getDate() - day + 1)
      d.setHours(0, 0, 0, 0)
      const key = d.toISOString()
      weeks[key] = (weeks[key] || 0) + 1
    })
    return Object.entries(weeks)
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => (a.week < b.week ? -1 : 1))
  }, [data])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Workout</h1>
        <p className="text-muted-foreground">Cronologia allenamenti</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <TimeRangeSelector value={range} onChange={setRange} />
        <Select value={activityType} onValueChange={setActivityType}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti i tipi</SelectItem>
            {Object.entries(WORKOUT_NAMES).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Workout</p><p className="text-2xl font-semibold">{stats.count}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ore totali</p><p className="text-2xl font-semibold">{(stats.totalDuration / 3600).toFixed(1)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Distanza totale</p><p className="text-2xl font-semibold">{(stats.totalDistance / 1000).toFixed(1)} <span className="text-sm text-muted-foreground font-normal">km</span></p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Calorie totali</p><p className="text-2xl font-semibold">{formatNumber(stats.totalCalories)} <span className="text-sm text-muted-foreground font-normal">kcal</span></p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Workout per settimana</CardTitle>
        </CardHeader>
        <CardContent>
          {weeklyData.length === 0 ? (
            <p className="text-muted-foreground py-8">Nessun workout nel periodo</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="week"
                  tickFormatter={v => new Date(v).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
                  tick={{ fontSize: 11 }}
                  minTickGap={20}
                />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip
                  labelFormatter={v => `Settimana del ${new Date(v as string).toLocaleDateString("it-IT")}`}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                />
                <Bar dataKey="count" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Elenco workout</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="h-40 animate-pulse bg-muted rounded" />}
          {!isLoading && data && data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Attivita</TableHead>
                  <TableHead className="text-right">Durata</TableHead>
                  <TableHead className="text-right">Distanza</TableHead>
                  <TableHead className="text-right">Calorie</TableHead>
                  <TableHead className="hidden md:table-cell">Sorgente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map(w => (
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
                      {w.total_energy_burned ? `${formatNumber(w.total_energy_burned)} kcal` : "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden md:table-cell">{w.source_name ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!data || data.length === 0) && (
            <p className="text-muted-foreground py-4">Nessun workout</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
