import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getMeta } from "@/lib/healthkit"
import { formatDateTime } from "@/lib/utils"
import type { Sample } from "@/lib/types"

interface Props {
  type: string
  samples: Sample[]
}

export function SampleTable({ type, samples }: Props) {
  const meta = getMeta(type)

  if (samples.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Nessun dato</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data/ora</TableHead>
          <TableHead className="text-right">Valore</TableHead>
          <TableHead>Sorgente</TableHead>
          <TableHead className="hidden md:table-cell">Dispositivo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {samples.map(s => {
          const displayValue = s.value * meta.unitMultiplier
          const formattedValue = meta.formatValue
            ? meta.formatValue(displayValue)
            : displayValue.toLocaleString("it-IT", { maximumFractionDigits: 2 })
          return (
            <TableRow key={s.uuid}>
              <TableCell>{formatDateTime(s.start_date)}</TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {formattedValue} <span className="text-muted-foreground text-xs">{meta.displayUnit}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">{s.source_name ?? "-"}</TableCell>
              <TableCell className="text-muted-foreground hidden md:table-cell">{s.device ?? "-"}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
