import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart"
import { BloodPressureChart } from "@/components/charts/BloodPressureChart"
import { SampleTable } from "@/components/SampleTable"
import { FilterBar } from "@/components/FilterBar"
import {
  TimeRangeSelector,
  suggestAggregation,
  timeRangeToDates,
} from "@/components/controls/TimeRangeSelector"
import { AggregationSelector } from "@/components/controls/AggregationSelector"
import { useDailyStats, useSamples } from "@/lib/queries"
import { getMeta } from "@/lib/healthkit"
import type { AdvancedFilters, AggregatedPoint, Aggregation, Sample, TimeRange } from "@/lib/types"

/** Tipi cumulative attivita' per cui leggiamo i totali pre-calcolati da
 *  HealthKit (HKStatisticsCollectionQuery, gli stessi numeri dei widget di
 *  Apple Salute) anziche' fare SUM dei sample raw. */
const DAILY_STATS_TYPES: ReadonlySet<string> = new Set([
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierDistanceCycling",
  "HKQuantityTypeIdentifierDistanceSwimming",
  "HKQuantityTypeIdentifierFlightsClimbed",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierBasalEnergyBurned",
  "HKQuantityTypeIdentifierAppleExerciseTime",
  "HKQuantityTypeIdentifierAppleStandTime",
  "HKQuantityTypeIdentifierAppleMoveTime",
])

function isDailyStatsType(type: string): boolean {
  return DAILY_STATS_TYPES.has(type)
}

/** Pressione sistolica e diastolica si correlano per definizione: la
 *  vista dedicata sovrappone le due serie sullo stesso asse mmHg. */
const BP_TYPES: ReadonlySet<string> = new Set([
  "HKQuantityTypeIdentifierBloodPressureSystolic",
  "HKQuantityTypeIdentifierBloodPressureDiastolic",
])
function isBP(type: string): boolean {
  return BP_TYPES.has(type)
}

interface Props {
  title: string
  subtitle?: string
  types: string[]
  /** Contenuto extra renderizzato in coda al tab del tipo indicato. */
  extrasByType?: Record<string, ReactNode>
}

export function TypeBrowser({ title, subtitle, types, extrasByType }: Props) {
  const [activeType, setActiveType] = useState(types[0])
  const [range, setRange] = useState<TimeRange>("30d")
  const [aggregation, setAggregation] = useState<Aggregation>(suggestAggregation("30d"))
  const [advanced, setAdvanced] = useState<AdvancedFilters>({})
  const [samplesOpen, setSamplesOpen] = useState(false)

  const dates = useMemo(() => timeRangeToDates(range), [range])
  // Advanced filter period overrides the preset range when set
  const effectiveStart = advanced.start ?? dates.start
  const effectiveEnd = advanced.end ?? dates.end

  // Se il tipo attivo e' uno dei 9 cumulative attivita' E l'aggregazione e'
  // giornaliera, leggiamo dai totali HKStatisticsCollectionQuery (Apple-
  // compatible). Altrimenti SUM/AVG dei sample raw via /samples.
  const useDailyStatsBranch = aggregation === "daily" && isDailyStatsType(activeType)

  const aggQuery = useSamples({
    type: activeType,
    start: effectiveStart,
    end: effectiveEnd,
    aggregation,
    sources: advanced.sources,
    devices: advanced.devices,
    value_min: advanced.value_min,
    value_max: advanced.value_max,
    limit: 2000,
  }, !useDailyStatsBranch)

  // /api/v1/daily-stats vuole date YYYY-MM-DD (no time). Convertiamo qui.
  const dailyStart = effectiveStart ? effectiveStart.slice(0, 10) : undefined
  const dailyEnd = effectiveEnd ? effectiveEnd.slice(0, 10) : undefined
  const dailyStatsQuery = useDailyStats(activeType, dailyStart, dailyEnd, useDailyStatsBranch)

  // Adapter: DailyStatPoint -> AggregatedPoint (il chart usa .sum per i
  // tipi cumulative). Date YYYY-MM-DD viene parsata come midnight locale.
  const dailyStatsAsAggregated: AggregatedPoint[] = useMemo(() => {
    if (!useDailyStatsBranch || !dailyStatsQuery.data) return []
    // Ordine DESC per coerenza con il branch /samples (TimeSeriesChart fa
    // poi reverse() interno).
    const sorted = [...dailyStatsQuery.data].sort((a, b) => (a.date < b.date ? 1 : -1))
    return sorted.map(p => ({
      period_start: `${p.date}T00:00:00`,
      avg: p.value,
      sum: p.value,
      min: p.value,
      max: p.value,
      count: 1,
    }))
  }, [useDailyStatsBranch, dailyStatsQuery.data])
  const rawQuery = useSamples({
    type: activeType,
    start: effectiveStart,
    end: effectiveEnd,
    aggregation: "none",
    sources: advanced.sources,
    devices: advanced.devices,
    value_min: advanced.value_min,
    value_max: advanced.value_max,
    limit: 100,
  }, samplesOpen)

  const meta = getMeta(activeType)

  const onRangeChange = (r: TimeRange) => {
    setRange(r)
    setAggregation(suggestAggregation(r))
  }

  const chartType = useMemo<"bar" | "line" | "area">(() => {
    if (meta.category === "activity" || meta.category === "nutrition") return "bar"
    return "line"
  }, [meta.category])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
      </div>

      <Tabs value={activeType} onValueChange={setActiveType}>
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            {types.map(t => (
              <TabsTrigger key={t} value={t}>
                {getMeta(t).label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {types.map(t => (
          <TabsContent key={t} value={t} className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <TimeRangeSelector value={range} onChange={onRangeChange} />
              <AggregationSelector value={aggregation} onChange={setAggregation} />
            </div>
            <FilterBar type={t} value={advanced} onChange={setAdvanced} />

            <Card>
              <CardHeader>
                <CardTitle>
                  {getMeta(t).label} {" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    ({getMeta(t).displayUnit || "-"})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isBP(activeType) ? (
                  <BloodPressureChart
                    start={effectiveStart}
                    end={effectiveEnd}
                    aggregation={aggregation}
                    advanced={advanced}
                    height={320}
                  />
                ) : (
                  <>
                    {(useDailyStatsBranch ? dailyStatsQuery.isLoading : aggQuery.isLoading) && (
                      <div className="h-72 animate-pulse bg-muted rounded" />
                    )}
                    {useDailyStatsBranch && dailyStatsQuery.data && (
                      <TimeSeriesChart
                        type={t}
                        data={dailyStatsAsAggregated}
                        aggregation="daily"
                        chartType={chartType}
                        height={320}
                      />
                    )}
                    {!useDailyStatsBranch && aggQuery.data && (
                      <TimeSeriesChart
                        type={t}
                        data={aggQuery.data.data}
                        aggregation={aggregation}
                        chartType={chartType}
                        height={320}
                      />
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <button
                type="button"
                onClick={() => setSamplesOpen(o => !o)}
                className="flex w-full items-center gap-2 p-6 text-left hover:bg-muted/40 transition-colors rounded-lg"
                aria-expanded={samplesOpen}
              >
                {samplesOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                <CardTitle>Ultimi 100 campioni</CardTitle>
              </button>
              {samplesOpen && (
                <CardContent>
                  {rawQuery.isLoading && <div className="h-32 animate-pulse bg-muted rounded" />}
                  {rawQuery.data && (
                    <SampleTable type={t} samples={rawQuery.data.data as Sample[]} />
                  )}
                </CardContent>
              )}
            </Card>

            {extrasByType?.[t]}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
