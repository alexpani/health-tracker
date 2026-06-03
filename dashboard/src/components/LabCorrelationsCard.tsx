import { Link } from "react-router-dom"
import { GitCompareArrows } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useLabCorrelations } from "@/lib/queries"
import { factorSummary, plausibilityMeta } from "@/components/LabCorrelations"
import { formatDate, cn } from "@/lib/utils"

const PLAUS_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3 }

/** Widget proattivo: top associazioni "da rivedere" (note o plausibilità >= media).
 * Si nasconde se non c'è niente di rilevante. */
export default function LabCorrelationsCard() {
  const { data, isLoading } = useLabCorrelations()
  if (isLoading) return null

  const items = (data?.candidates ?? [])
    .filter(c => {
      const a = c.annotation
      if (a.status !== "done") return false
      return a.is_known_association || PLAUS_RANK[a.plausibility ?? "none"] >= 2
    })
    .slice(0, 5)

  if (items.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompareArrows className="h-4 w-4 text-indigo-600" />
          Possibili associazioni da rivedere
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm">
          {items.map(c => {
            const meta = plausibilityMeta(c.annotation.plausibility)
            return (
              <li key={c.signature} className="flex items-center justify-between gap-3">
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
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
