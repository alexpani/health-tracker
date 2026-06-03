import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/lib/utils"
import { useLabDeletePanel, useLabPanels } from "@/lib/queries"
import type { LabPanelSummary } from "@/lib/types"

export default function LabPanelsList() {
  const { data, isLoading, error } = useLabPanels({ limit: 200 })
  const del = useLabDeletePanel()
  const [year, setYear] = useState<number | null>(null)

  async function handleDelete(panel: LabPanelSummary) {
    if (!confirm(`Eliminare il referto del ${formatDate(panel.test_date)}?`)) return
    try {
      await del.mutateAsync(panel.id)
    } catch (e) {
      alert(`Errore: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const p of data?.items ?? []) {
      const y = new Date(p.test_date).getFullYear()
      if (!Number.isNaN(y)) set.add(y)
    }
    return Array.from(set).sort((a, b) => b - a)
  }, [data])

  if (isLoading) return <p className="text-sm text-muted-foreground">Caricamento…</p>
  if (error) return <p className="text-sm text-red-600">Errore: {String(error)}</p>
  if (!data || data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessun referto ancora caricato.</p>
  }

  const filtered =
    year == null
      ? data.items
      : data.items.filter(p => new Date(p.test_date).getFullYear() === year)

  return (
    <div className="space-y-3">
      {years.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <YearChip active={year == null} onClick={() => setYear(null)}>
            Tutti
          </YearChip>
          {years.map(y => (
            <YearChip key={y} active={year === y} onClick={() => setYear(y)}>
              {y}
            </YearChip>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nessun referto per il {year}.</p>
      ) : (
        <PanelsTable panels={filtered} onDelete={handleDelete} />
      )}
    </div>
  )
}

function YearChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background hover:bg-muted border-border text-muted-foreground"
      }`}
    >
      {children}
    </button>
  )
}

function PanelsTable({
  panels,
  onDelete,
}: {
  panels: LabPanelSummary[]
  onDelete: (p: LabPanelSummary) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Laboratorio</TableHead>
          <TableHead>Campioni</TableHead>
          <TableHead>Stato</TableHead>
          <TableHead>Note</TableHead>
          <TableHead className="text-right">Azioni</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {panels.map(p => {
          const parsingFailed = p.notes === "parsing_failed"
          const unmapped = p.unmapped_count ?? 0
          return (
            <TableRow key={p.id}>
              <TableCell className="whitespace-nowrap">
                <Link to={`/lab/panels/${p.id}/review`} className="text-primary hover:underline">
                  {formatDate(p.test_date)}
                </Link>
              </TableCell>
              <TableCell>{p.lab_name ?? "—"}</TableCell>
              <TableCell>
                {p.specimen_types.length > 0 ? p.specimen_types.join(", ") : "—"}
              </TableCell>
              <TableCell>
                {p.status === "draft" ? (
                  <span className="text-xs rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                    bozza
                  </span>
                ) : unmapped > 0 ? (
                  <span className="text-xs rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                    {unmapped} da rivedere
                  </span>
                ) : (
                  <span className="text-xs rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">
                    completo
                  </span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {parsingFailed ? (
                  <span className="text-red-600">parsing fallito</span>
                ) : (
                  p.notes ?? ""
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(p)}
                  aria-label="Elimina"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
