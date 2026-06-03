import { Link } from "react-router-dom"
import { Check, GitCompareArrows } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useDismissCorrelation, useLabCorrelations } from "@/lib/queries"
import { factorSummary, plausibilityMeta } from "@/components/LabCorrelations"
import { formatDate, cn } from "@/lib/utils"

const PLAUS_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 }

/** Widget proattivo: top associazioni rilevate (note o plausibilità >= media),
 * escluse quelle già marcate come "viste". Si nasconde se non c'è nulla. */
export default function LabCorrelationsCard() {
  const { data, isLoading } = useLabCorrelations()
  const dismiss = useDismissCorrelation()
  if (isLoading) return null

  const items = (data?.candidates ?? [])
    .filter(c => {
      if (c.dismissed) return false
      const a = c.annotation
      if (a.status !== "done") return false
      return a.is_known_association || PLAUS_RANK[a.plausibility ?? "none"] >= 2
    })
    // Ordine cronologico discendente (più recenti in cima); score come spareggio.
    .sort((a, b) => b.cur_date.localeCompare(a.cur_date) || b.score - a.score)
    .slice(0, 5)

  if (items.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompareArrows className="h-4 w-4 text-indigo-600" />
          Possibili associazioni rilevate
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm">
          {items.map(c => {
            const meta = plausibilityMeta(c.annotation.plausibility)
            return (
              <li key={c.signature} className="flex items-center justify-between gap-2">
                <Link
                  to={`/lab/panels/${c.cur_panel_id}/review`}
                  className="flex-1 hover:underline min-w-0"
                >
                  <span className="font-medium">{c.analyte_name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {factorSummary(c)}
                  </span>
                </Link>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDate(c.cur_date)}
                </span>
                <span
                  className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)}
                  title={`plausibilità ${meta.label}`}
                />
                <button
                  type="button"
                  onClick={() => dismiss.mutate({ signature: c.signature, dismissed: true })}
                  disabled={dismiss.isPending}
                  title="Segna come vista (la toglie da qui)"
                  className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-md border border-input text-muted-foreground hover:bg-muted hover:text-emerald-700"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
