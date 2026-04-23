import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useLabMatrix } from "@/lib/queries"
import type { LabAnalyte, LabMatrixCell, LabMatrixResponse } from "@/lib/types"
import { formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"

function cellClassName(cell: LabMatrixCell | undefined): string {
  if (!cell) return ""
  if (cell.out_of_range === true) return "bg-red-100 text-red-900"
  if (cell.needs_review) return "bg-amber-50 text-amber-900"
  return ""
}

function cellDisplay(cell: LabMatrixCell | undefined): string {
  if (!cell) return ""
  if (cell.value_numeric != null) return String(cell.value_numeric)
  if (cell.value_text) return cell.value_text
  return ""
}

export default function LabMatrix({
  onJumpToTrends,
}: {
  onJumpToTrends?: (slug: string) => void
}) {
  const { data, isLoading, error } = useLabMatrix()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const grouped = useMemo(() => groupByCategory(data), [data])

  function toggleCategory(cat: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Caricamento…</p>
  if (error) return <p className="text-sm text-red-600">Errore: {String(error)}</p>
  if (!data || data.panels.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nessun referto confermato. Carica un PDF e conferma la review.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto border rounded-md">
      <table className="text-xs min-w-max">
        <thead className="sticky top-0 z-10 bg-background">
          <tr>
            <th className="sticky left-0 z-20 bg-background text-left px-3 py-2 font-medium border-b border-r min-w-[220px]">
              Analita
            </th>
            {data.panels.map(p => (
              <th
                key={p.id}
                className="px-2 py-2 border-b font-medium whitespace-nowrap"
                title={p.lab_name ?? ""}
              >
                <Link to={`/lab/panels/${p.id}/review`} className="hover:underline">
                  {formatDate(p.test_date)}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grouped.map(group => {
            const isCollapsed = collapsed.has(group.category)
            return (
              <CategoryGroup
                key={group.category}
                category={group.category}
                analytes={group.analytes}
                panels={data.panels}
                cells={data.cells}
                collapsed={isCollapsed}
                onToggle={() => toggleCategory(group.category)}
                onJumpToTrends={onJumpToTrends}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CategoryGroup({
  category,
  analytes,
  panels,
  cells,
  collapsed,
  onToggle,
  onJumpToTrends,
}: {
  category: string
  analytes: LabAnalyte[]
  panels: LabMatrixResponse["panels"]
  cells: LabMatrixResponse["cells"]
  collapsed: boolean
  onToggle: () => void
  onJumpToTrends?: (slug: string) => void
}) {
  return (
    <>
      <tr className="bg-muted/50">
        <td
          className="sticky left-0 z-10 bg-muted/50 px-3 py-1.5 font-semibold cursor-pointer border-r"
          colSpan={1}
          onClick={onToggle}
        >
          <span className="flex items-center gap-1">
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {category} ({analytes.length})
          </span>
        </td>
        <td
          colSpan={panels.length}
          className="bg-muted/50 cursor-pointer"
          onClick={onToggle}
        />
      </tr>
      {!collapsed &&
        analytes.map(a => {
          const byPanel = cells[String(a.id)] ?? {}
          const hasAny = Object.keys(byPanel).length > 0
          return (
            <tr key={a.id} className={!hasAny ? "opacity-50" : ""}>
              <td className="sticky left-0 z-10 bg-background px-3 py-1.5 border-r">
                <button
                  className="text-left hover:underline"
                  onClick={() => onJumpToTrends?.(a.slug)}
                  title={
                    a.unit_canonical
                      ? `${a.display_name_it} — ${a.unit_canonical}${
                          a.ref_low != null && a.ref_high != null
                            ? ` (${a.ref_low}–${a.ref_high})`
                            : ""
                        }`
                      : a.display_name_it
                  }
                >
                  {a.display_name_it}
                </button>
              </td>
              {panels.map(p => {
                const cell = byPanel[String(p.id)]
                return (
                  <td
                    key={p.id}
                    className={cn(
                      "px-2 py-1.5 text-center whitespace-nowrap border-b border-border/50",
                      cellClassName(cell)
                    )}
                    title={
                      cell
                        ? `${cellDisplay(cell)}${cell.unit ? " " + cell.unit : ""}${
                            a.ref_low != null || a.ref_high != null
                              ? ` (rif ${a.ref_low ?? "-"}–${a.ref_high ?? "-"} ${a.unit_canonical ?? ""})`
                              : ""
                          }`
                        : ""
                    }
                  >
                    {cellDisplay(cell)}
                  </td>
                )
              })}
            </tr>
          )
        })}
    </>
  )
}

function groupByCategory(data: LabMatrixResponse | undefined) {
  if (!data) return []
  const m = new Map<string, LabAnalyte[]>()
  for (const a of data.analytes) {
    const arr = m.get(a.category) ?? []
    arr.push(a)
    m.set(a.category, arr)
  }
  return Array.from(m.entries()).map(([category, analytes]) => ({ category, analytes }))
}
