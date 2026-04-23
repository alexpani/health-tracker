import { Link } from "react-router-dom"
import { AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useLabRecentOutOfRange } from "@/lib/queries"
import { formatDate } from "@/lib/utils"

export default function LabRecentOorCard() {
  const { data, isLoading } = useLabRecentOutOfRange(10)

  if (isLoading) return null

  const items = data ?? []
  if (items.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          Analisi fuori range recenti
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm">
          {items.map(item => (
            <li
              key={item.result_id}
              className="flex items-center justify-between gap-3"
            >
              <Link
                to={`/lab/panels/${item.panel_id}/review`}
                className="flex-1 hover:underline"
              >
                <span className="font-medium">{item.display_name}</span>
                <span className="ml-2 font-mono text-red-700">
                  {item.value_numeric ?? item.value_text}
                  {item.unit ? ` ${item.unit}` : ""}
                </span>
                {(item.ref_low != null || item.ref_high != null) && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    rif {item.ref_low ?? "-"}–{item.ref_high ?? "-"}
                  </span>
                )}
              </Link>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatDate(item.test_date)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
