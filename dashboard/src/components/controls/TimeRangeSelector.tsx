import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { TimeRange } from "@/lib/types"

interface Props {
  value: TimeRange
  onChange: (v: TimeRange) => void
}

const ranges: { value: TimeRange; label: string }[] = [
  { value: "1d", label: "Oggi" },
  { value: "7d", label: "Ultimi 7 giorni" },
  { value: "30d", label: "Ultimi 30 giorni" },
  { value: "90d", label: "Ultimi 90 giorni" },
  { value: "1y", label: "Ultimo anno" },
  { value: "all", label: "Tutto" },
]

export function TimeRangeSelector({ value, onChange }: Props) {
  return (
    <Select value={value} onValueChange={v => onChange(v as TimeRange)}>
      <SelectTrigger className="w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ranges.map(r => (
          <SelectItem key={r.value} value={r.value}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function timeRangeToDates(range: TimeRange): { start?: string; end?: string } {
  if (range === "all") return {}
  const end = new Date()
  const start = new Date()
  switch (range) {
    case "1d": start.setHours(0, 0, 0, 0); break
    case "7d": start.setDate(start.getDate() - 7); break
    case "30d": start.setDate(start.getDate() - 30); break
    case "90d": start.setDate(start.getDate() - 90); break
    case "1y": start.setFullYear(start.getFullYear() - 1); break
  }
  return { start: start.toISOString(), end: end.toISOString() }
}

export function suggestAggregation(range: TimeRange): "hourly" | "daily" | "weekly" | "monthly" {
  if (range === "1d") return "hourly"
  if (range === "7d" || range === "30d") return "daily"
  if (range === "90d" || range === "1y") return "weekly"
  return "monthly"
}
