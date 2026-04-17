import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Aggregation } from "@/lib/types"

interface Props {
  value: Aggregation
  onChange: (v: Aggregation) => void
  showNone?: boolean
}

const options: { value: Aggregation; label: string }[] = [
  { value: "hourly", label: "Oraria" },
  { value: "daily", label: "Giornaliera" },
  { value: "weekly", label: "Settimanale" },
  { value: "monthly", label: "Mensile" },
]

export function AggregationSelector({ value, onChange, showNone = false }: Props) {
  return (
    <Select value={value} onValueChange={v => onChange(v as Aggregation)}>
      <SelectTrigger className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {showNone && <SelectItem value="none">Raw</SelectItem>}
        {options.map(o => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
