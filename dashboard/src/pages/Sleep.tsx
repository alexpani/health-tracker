import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TimeRangeSelector, timeRangeToDates } from "@/components/controls/TimeRangeSelector"
import { useCategories } from "@/lib/queries"
import { SLEEP_STAGES } from "@/lib/healthkit"
import { formatDate } from "@/lib/utils"
import type { TimeRange } from "@/lib/types"

export default function Sleep() {
  const [range, setRange] = useState<TimeRange>("30d")
  const dates = useMemo(() => timeRangeToDates(range), [range])
  const { data, isLoading } = useCategories("HKCategoryTypeIdentifierSleepAnalysis", dates.start, dates.end)

  // Aggregate per night (grouping by the "wake-up" date)
  const byNight: Record<string, Record<number, number>> = {}
  ;(data ?? []).forEach(s => {
    const start = new Date(s.start_date)
    const end = new Date(s.end_date)
    const durationMinutes = (end.getTime() - start.getTime()) / 60_000
    // use the wake-up date (end_date) as night key
    const nightKey = new Date(end.getFullYear(), end.getMonth(), end.getDate()).toISOString()
    if (!byNight[nightKey]) byNight[nightKey] = {}
    byNight[nightKey][s.value] = (byNight[nightKey][s.value] || 0) + durationMinutes
  })

  const chartData = Object.entries(byNight)
    .map(([day, stages]) => {
      const row: any = { day }
      Object.entries(SLEEP_STAGES).forEach(([k, v]) => {
        row[v.label] = stages[Number(k)] || 0
      })
      return row
    })
    .sort((a, b) => (a.day < b.day ? -1 : 1))

  // Mostra solo le fasi che hanno almeno un valore > 0 nel periodo: il
  // Watch moderno scrive solo Awake/Core/Deep/REM, mentre "A letto" e
  // "Addormentato (non specificato)" sono legacy e restano sempre a 0
  // — toglierli dalla legenda e dal tooltip ripulisce la vista.
  const visibleStages = Object.entries(SLEEP_STAGES)
    .filter(([, v]) => chartData.some(d => (d[v.label] || 0) > 0))
    .map(([, v]) => v)

  const totalHoursAvg =
    chartData.length === 0
      ? 0
      : chartData.reduce((sum, d) => {
          const asleepMin =
            (d[SLEEP_STAGES[3].label] || 0) + (d[SLEEP_STAGES[4].label] || 0) + (d[SLEEP_STAGES[5].label] || 0)
          return sum + asleepMin
        }, 0) / chartData.length / 60

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Sonno</h1>
        <p className="text-muted-foreground">Fasi del sonno notturno</p>
      </div>

      <div className="flex gap-2">
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-xs text-muted-foreground">Notti registrate</p>
            <p className="text-2xl font-semibold">{chartData.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-xs text-muted-foreground">Media ore dormite</p>
            <p className="text-2xl font-semibold">{totalHoursAvg.toFixed(1)}h</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-xs text-muted-foreground">Campioni totali</p>
            <p className="text-2xl font-semibold">{data?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fasi del sonno per notte (minuti)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="h-80 animate-pulse bg-muted rounded" />}
          {!isLoading && chartData.length === 0 && (
            <p className="text-muted-foreground">Nessun dato di sonno nel periodo selezionato</p>
          )}
          {!isLoading && chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="day"
                  tickFormatter={v => formatDate(v, { day: "2-digit", month: "2-digit" })}
                  tick={{ fontSize: 11 }}
                  minTickGap={20}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  labelFormatter={v => formatDate(v as string)}
                  formatter={(v: number) => `${Math.round(v)} min`}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                />
                <Legend />
                {visibleStages.map(stage => (
                  <Bar key={stage.label} dataKey={stage.label} stackId="sleep" fill={stage.color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
