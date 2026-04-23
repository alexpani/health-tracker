import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useLabAnalytes, useLabMatrix } from "@/lib/queries"
import type { LabAnalyte, LabMatrixCell, LabMatrixResponse } from "@/lib/types"
import { formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"

interface MatrixFilters {
  start: string
  end: string
  specimen: "" | "blood" | "urine"
  category: string
  onlyOutOfRange: boolean
}

const EMPTY_FILTERS: MatrixFilters = {
  start: "",
  end: "",
  specimen: "",
  category: "",
  onlyOutOfRange: false,
}

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
  const [filters, setFilters] = useState<MatrixFilters>(EMPTY_FILTERS)
  useLabAnalytes() // pre-warm cache — usata altrove
  const queryParams = useMemo(
    () => ({
      start: filters.start || undefined,
      end: filters.end || undefined,
      specimen: filters.specimen || undefined,
      category: filters.category || undefined,
    }),
    [filters]
  )
  const { data: rawData, isLoading, error } = useLabMatrix(queryParams)

  // Seconda query senza `category`: serve per capire quali categorie
  // contengono almeno un valore e popolare il menu a tendina solo con
  // quelle utili (ignora l'input `category` ma rispetta date/specimen).
  const noCategoryParams = useMemo(
    () => ({
      start: filters.start || undefined,
      end: filters.end || undefined,
      specimen: filters.specimen || undefined,
    }),
    [filters.start, filters.end, filters.specimen]
  )
  const { data: categoryPool } = useLabMatrix(noCategoryParams)

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Applica il filtro "solo fuori range" lato client (post-fetch).
  const data = useMemo<LabMatrixResponse | undefined>(() => {
    if (!rawData) return rawData
    if (!filters.onlyOutOfRange) return rawData
    const filteredAnalytes = rawData.analytes.filter(a => {
      const byPanel = rawData.cells[String(a.id)] ?? {}
      return Object.values(byPanel).some(cell => cell.out_of_range === true)
    })
    return { ...rawData, analytes: filteredAnalytes }
  }, [rawData, filters.onlyOutOfRange])

  // Solo categorie che hanno almeno un valore nella matrice (ignorando
  // il filtro categoria, così tornano sempre tutte le popolate).
  const categories = useMemo(() => {
    if (!categoryPool) return []
    const set = new Set<string>()
    for (const a of categoryPool.analytes) {
      const byPanel = categoryPool.cells[String(a.id)] ?? {}
      if (Object.keys(byPanel).length > 0) set.add(a.category)
    }
    return Array.from(set).sort()
  }, [categoryPool])

  const grouped = useMemo(() => groupByCategory(data), [data])
  const filtersActive =
    filters.start ||
    filters.end ||
    filters.specimen ||
    filters.category ||
    filters.onlyOutOfRange

  function toggleCategory(cat: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const filterBar = (
    <div className="flex flex-wrap items-end gap-3 mb-3">
      <div>
        <Label className="text-xs">Dal</Label>
        <Input
          type="date"
          value={filters.start}
          onChange={e => setFilters(f => ({ ...f, start: e.target.value }))}
          className="h-8 text-sm w-40"
        />
      </div>
      <div>
        <Label className="text-xs">Al</Label>
        <Input
          type="date"
          value={filters.end}
          onChange={e => setFilters(f => ({ ...f, end: e.target.value }))}
          className="h-8 text-sm w-40"
        />
      </div>
      <div>
        <Label className="text-xs">Campione</Label>
        <Select
          value={filters.specimen || "all"}
          onValueChange={v =>
            setFilters(f => ({ ...f, specimen: v === "all" ? "" : (v as "blood" | "urine") }))
          }
        >
          <SelectTrigger className="h-8 w-32 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">tutti</SelectItem>
            <SelectItem value="blood">blood</SelectItem>
            <SelectItem value="urine">urine</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Categoria</Label>
        <Select
          value={filters.category || "all"}
          onValueChange={v =>
            setFilters(f => ({ ...f, category: v === "all" ? "" : v }))
          }
        >
          <SelectTrigger className="h-8 w-48 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">tutte</SelectItem>
            {categories.map(c => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm pb-1">
        <input
          type="checkbox"
          checked={filters.onlyOutOfRange}
          onChange={e =>
            setFilters(f => ({ ...f, onlyOutOfRange: e.target.checked }))
          }
        />
        Solo fuori range
      </label>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setFilters(EMPTY_FILTERS)}
        disabled={!filtersActive}
        title={filtersActive ? "Ripristina tutti i filtri" : "Nessun filtro attivo"}
      >
        <X className="h-3.5 w-3.5 mr-1" />
        Reset filtri
      </Button>
    </div>
  )

  if (isLoading)
    return (
      <>
        {filterBar}
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      </>
    )
  if (error)
    return (
      <>
        {filterBar}
        <p className="text-sm text-red-600">Errore: {String(error)}</p>
      </>
    )
  if (!data || data.panels.length === 0) {
    return (
      <>
        {filterBar}
        <p className="text-sm text-muted-foreground">
          {filtersActive
            ? "Nessun risultato coi filtri correnti."
            : "Nessun referto confermato. Carica un PDF e conferma la review."}
        </p>
      </>
    )
  }

  return (
    <>
    {filterBar}
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
    </>
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
