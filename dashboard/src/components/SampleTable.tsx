import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getMeta } from "@/lib/healthkit"
import { formatDateTime } from "@/lib/utils"
import type { Sample } from "@/lib/types"

interface Props {
  type: string
  samples: Sample[]
  onDelete?: (sample: Sample) => void
}

export function SampleTable({ type, samples, onDelete }: Props) {
  const meta = getMeta(type)

  if (samples.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">Nessun dato</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="whitespace-nowrap">Data/ora</TableHead>
          <TableHead className="text-right whitespace-nowrap">Valore</TableHead>
          <TableHead className="whitespace-nowrap">Sorgente</TableHead>
          <TableHead className="hidden md:table-cell">Dispositivo</TableHead>
          {onDelete && <TableHead className="w-[40px]"></TableHead>}
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
              <TableCell className="whitespace-nowrap">{formatDateTime(s.start_date)}</TableCell>
              <TableCell className="text-right tabular-nums font-medium whitespace-nowrap">
                {formattedValue} <span className="text-muted-foreground text-xs">{meta.displayUnit}</span>
              </TableCell>
              <TableCell className="text-muted-foreground">{s.source_name ?? "-"}</TableCell>
              <TableCell className="text-muted-foreground hidden md:table-cell">{s.device ?? "-"}</TableCell>
              {onDelete && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(s)}
                    disabled={s.id === undefined}
                    aria-label="Elimina"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
