import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart"
import { SampleTable } from "@/components/SampleTable"
import { FilterBar } from "@/components/FilterBar"
import {
  TimeRangeSelector,
  suggestAggregation,
  timeRangeToDates,
} from "@/components/controls/TimeRangeSelector"
import { AggregationSelector } from "@/components/controls/AggregationSelector"
import { useSamples, useTypes } from "@/lib/queries"
import { getMeta } from "@/lib/healthkit"
import { formatNumber } from "@/lib/utils"
import type { AdvancedFilters, Aggregation, Sample, TimeRange } from "@/lib/types"

export default function Explore() {
  const types = useTypes()
  const [type, setType] = useState<string>("")
  const [range, setRange] = useState<TimeRange>("30d")
  const [aggregation, setAggregation] = useState<Aggregation>(suggestAggregation("30d"))
  const [advanced, setAdvanced] = useState<AdvancedFilters>({})

  const dates = useMemo(() => timeRangeToDates(range), [range])
  const effectiveStart = advanced.start ?? dates.start
  const effectiveEnd = advanced.end ?? dates.end

  const chart = useSamples({
    type,
    start: effectiveStart,
    end: effectiveEnd,
    aggregation,
    sources: advanced.sources,
    devices: advanced.devices,
    value_min: advanced.value_min,
    value_max: advanced.value_max,
    limit: 2000,
  }, !!type)
  const raw = useSamples({
    type,
    start: effectiveStart,
    end: effectiveEnd,
    aggregation: "none",
    sources: advanced.sources,
    devices: advanced.devices,
    value_min: advanced.value_min,
    value_max: advanced.value_max,
    limit: 100,
  }, !!type)

  const sortedTypes = useMemo(() => {
    return [...(types.data ?? [])].sort((a, b) => b.count - a.count)
  }, [types.data])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Esplora</h1>
        <p className="text-muted-foreground">Seleziona qualunque tipo di dato e analizzalo</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[320px]">
                <SelectValue placeholder="Scegli un tipo..." />
              </SelectTrigger>
              <SelectContent>
                {sortedTypes.map(t => (
                  <SelectItem key={t.type} value={t.type}>
                    {getMeta(t.type).label} ({formatNumber(t.count)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TimeRangeSelector value={range} onChange={r => { setRange(r); setAggregation(suggestAggregation(r)) }} />
            <AggregationSelector value={aggregation} onChange={setAggregation} />
          </div>
          {type && <FilterBar type={type} value={advanced} onChange={setAdvanced} />}
        </CardContent>
      </Card>

      {type && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                {getMeta(type).label}{" "}
                <span className="text-sm font-normal text-muted-foreground">({getMeta(type).displayUnit || "-"})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chart.isLoading && <div className="h-72 animate-pulse bg-muted rounded" />}
              {chart.data && (
                <TimeSeriesChart
                  type={type}
                  data={chart.data.data}
                  aggregation={aggregation}
                  chartType="line"
                  height={360}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ultimi 100 campioni</CardTitle>
            </CardHeader>
            <CardContent>
              {raw.data && <SampleTable type={type} samples={raw.data.data as Sample[]} />}
            </CardContent>
          </Card>
        </>
      )}

      {!type && (
        <p className="text-muted-foreground text-center py-12">Seleziona un tipo di dato per iniziare</p>
      )}
    </div>
  )
}
