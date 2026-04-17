import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart"
import { SampleTable } from "@/components/SampleTable"
import {
  TimeRangeSelector,
  suggestAggregation,
  timeRangeToDates,
} from "@/components/controls/TimeRangeSelector"
import { AggregationSelector } from "@/components/controls/AggregationSelector"
import { useSamples } from "@/lib/queries"
import { getMeta } from "@/lib/healthkit"
import type { Aggregation, Sample, TimeRange } from "@/lib/types"

interface Props {
  title: string
  subtitle?: string
  types: string[]
}

export function TypeBrowser({ title, subtitle, types }: Props) {
  const [activeType, setActiveType] = useState(types[0])
  const [range, setRange] = useState<TimeRange>("30d")
  const [aggregation, setAggregation] = useState<Aggregation>(suggestAggregation("30d"))

  // Memoize dates so new Date() isn't called every render (would cause infinite loop)
  const dates = useMemo(() => timeRangeToDates(range), [range])
  const aggQuery = useSamples({
    type: activeType,
    ...dates,
    aggregation,
    limit: 2000,
  })
  const rawQuery = useSamples({
    type: activeType,
    ...dates,
    aggregation: "none",
    limit: 100,
  })

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
                {aggQuery.isLoading && <div className="h-72 animate-pulse bg-muted rounded" />}
                {aggQuery.data && (
                  <TimeSeriesChart
                    type={t}
                    data={aggQuery.data.data}
                    aggregation={aggregation}
                    chartType={chartType}
                    height={320}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ultimi 100 campioni</CardTitle>
              </CardHeader>
              <CardContent>
                {rawQuery.isLoading && <div className="h-32 animate-pulse bg-muted rounded" />}
                {rawQuery.data && (
                  <SampleTable type={t} samples={rawQuery.data.data as Sample[]} />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
