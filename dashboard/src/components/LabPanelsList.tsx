import { useMemo } from "react"
import { Link } from "react-router-dom"
import { AlertTriangle, CheckCircle2, Trash2 } from "lucide-react"
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

  const { drafts, confirmed } = useMemo(() => {
    const items = data?.items ?? []
    return {
      drafts: items.filter(p => p.status === "draft"),
      confirmed: items.filter(p => p.status === "confirmed"),
    }
  }, [data])

  async function handleDelete(panel: LabPanelSummary) {
    if (!confirm(`Eliminare il referto del ${formatDate(panel.test_date)}?`)) return
    try {
      await del.mutateAsync(panel.id)
    } catch (e) {
      alert(`Errore: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Caricamento…</p>
  if (error) return <p className="text-sm text-red-600">Errore: {String(error)}</p>
  if (!data || data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nessun referto ancora caricato.</p>
  }

  return (
    <div className="space-y-6">
      {drafts.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Da rivedere ({drafts.length})
          </h3>
          <PanelsTable panels={drafts} isDraft onDelete={handleDelete} />
        </section>
      )}

      {confirmed.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Confermati ({confirmed.length})
          </h3>
          <PanelsTable panels={confirmed} onDelete={handleDelete} />
        </section>
      )}
    </div>
  )
}

function PanelsTable({
  panels,
  isDraft = false,
  onDelete,
}: {
  panels: LabPanelSummary[]
  isDraft?: boolean
  onDelete: (p: LabPanelSummary) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data</TableHead>
          <TableHead>Laboratorio</TableHead>
          <TableHead>Campioni</TableHead>
          <TableHead>Note</TableHead>
          <TableHead className="text-right">Azioni</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {panels.map(p => {
          const linkTarget = isDraft ? `/lab/panels/${p.id}/review` : `/lab/panels/${p.id}/review`
          const parsingFailed = p.notes === "parsing_failed"
          return (
            <TableRow key={p.id}>
              <TableCell>
                <Link to={linkTarget} className="text-primary hover:underline">
                  {formatDate(p.test_date)}
                </Link>
              </TableCell>
              <TableCell>{p.lab_name ?? "—"}</TableCell>
              <TableCell>
                {p.specimen_types.length > 0 ? p.specimen_types.join(", ") : "—"}
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
