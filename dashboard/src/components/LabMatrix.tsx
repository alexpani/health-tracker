import { useEffect, useMemo, useState } from "react"
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
import { useLabAnalytes, useLabMatrix, useLabPatchPanel } from "@/lib/queries"
import type {
  LabAnalyte,
  LabMatrixCell,
  LabMatrixResponse,
  LabPanelContextRow,
} from "@/lib/types"
import { formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"

// id virtuale per analita derivati (non esistono nel DB ma aggiunti client-side)
const DERIVED_CHOL_RATIO_ID = -1001
const DERIVED_CHOL_RATIO_SLUG = "__derived_chol_ratio"

function injectDerivedAnalytes(
  data: LabMatrixResponse | undefined
): LabMatrixResponse | undefined {
  if (!data) return data
  const totalA = data.analytes.find(a => a.slug === "cholesterol_total")
  const hdlA = data.analytes.find(a => a.slug === "cholesterol_hdl")
  if (!totalA || !hdlA) return data

  const totalCells = data.cells[String(totalA.id)] ?? {}
  const hdlCells = data.cells[String(hdlA.id)] ?? {}

  const ratioCells: Record<string, LabMatrixCell> = {}
  for (const panelIdStr of Object.keys(totalCells)) {
    const t = totalCells[panelIdStr]
    const h = hdlCells[panelIdStr]
    if (
      !t ||
      !h ||
      t.value_numeric == null ||
      h.value_numeric == null ||
      h.value_numeric === 0
    ) continue
    const ratio = t.value_numeric / h.value_numeric
    ratioCells[panelIdStr] = {
      value_numeric: Number(ratio.toFixed(2)),
      value_text: null,
      unit: "",
      // Logica: >5 = rischio alto; tra 3.5 e 5 = basso; <3.5 = molto basso
      out_of_range: ratio > 5,
      needs_review: false,
    }
  }
  if (Object.keys(ratioCells).length === 0) return data

  const derived: LabAnalyte = {
    id: DERIVED_CHOL_RATIO_ID,
    slug: DERIVED_CHOL_RATIO_SLUG,
    display_name_it: "Rapporto Col.tot / HDL (derivato)",
    category: "lipidi",
    specimen: "blood",
    value_type: "numeric",
    unit_canonical: "",
    ref_low: null,
    ref_high: 5,
    ref_text: "<3.5 rischio molto basso · <5 basso · >5 elevato",
    aliases: [],
  }

  return {
    ...data,
    analytes: [...data.analytes, derived],
    cells: { ...data.cells, [String(DERIVED_CHOL_RATIO_ID)]: ratioCells },
  }
}

const CONTEXT_ROWS: { key: keyof LabPanelContextRow; label: string }[] = [
  { key: "activity_text", label: "Attività fisica" },
  { key: "medications_text", label: "Farmaci" },
  { key: "supplements_text", label: "Integratori" },
  { key: "nutrition_text", label: "Alimentazione" },
  { key: "diet_text", label: "Dieta (piano)" },
  { key: "workout_text", label: "Workout" },
  { key: "notes", label: "Note" },
]

interface MatrixFilters {
  start: string
  end: string
  specimen: "" | "blood" | "urine"
  category: string
  onlyOutOfRange: boolean
}

const CATEGORY_ORDER = ["lipidi", "fegato", "ormoni", "metabolismo"]

function sortCategories<T extends { category: string }>(items: T[]): T[] {
  const order = new Map(CATEGORY_ORDER.map((c, i) => [c, i]))
  return [...items].sort((a, b) => {
    const ia = order.has(a.category) ? order.get(a.category)! : 1000
    const ib = order.has(b.category) ? order.get(b.category)! : 1000
    if (ia !== ib) return ia - ib
    return a.category.localeCompare(b.category)
  })
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
  // Rosso = fuori range (alert medico reale).
  // Ambra = needs_review (valore noto ma analita / unità incerto, non
  // necessariamente fuori norma). Colori distinti a colpo d'occhio.
  if (cell.out_of_range === true) return "bg-red-200 text-red-900 font-semibold"
  if (cell.needs_review) return "bg-amber-100 text-amber-900"
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
  const [collapsedInitialized, setCollapsedInitialized] = useState(false)

  // Inietta analiti derivati (es. Col.tot/HDL) e applica eventuale filtro
  // "solo fuori range" lato client (post-fetch).
  const data = useMemo<LabMatrixResponse | undefined>(() => {
    const enriched = injectDerivedAnalytes(rawData)
    if (!enriched) return enriched
    if (!filters.onlyOutOfRange) return enriched
    const filteredAnalytes = enriched.analytes.filter(a => {
      const byPanel = enriched.cells[String(a.id)] ?? {}
      return Object.values(byPanel).some(cell => cell.out_of_range === true)
    })
    return { ...enriched, analytes: filteredAnalytes }
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

  // Al primo caricamento: colassa tutte le categorie tranne "lipidi".
  useEffect(() => {
    if (collapsedInitialized) return
    if (grouped.length === 0) return
    const initial = new Set<string>(
      grouped.filter(g => g.category !== "lipidi").map(g => g.category)
    )
    setCollapsed(initial)
    setCollapsedInitialized(true)
  }, [grouped, collapsedInitialized])

  function collapseAll() {
    setCollapsed(new Set(grouped.map(g => g.category)))
  }
  function expandAll() {
    setCollapsed(new Set())
  }
  const allCollapsed = collapsed.size === grouped.length && grouped.length > 0

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
      <Button
        variant="outline"
        size="sm"
        onClick={allCollapsed ? expandAll : collapseAll}
        title={allCollapsed ? "Espandi tutte le categorie" : "Collassa tutte le categorie"}
      >
        {allCollapsed ? (
          <ChevronDown className="h-3.5 w-3.5 mr-1" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 mr-1" />
        )}
        {allCollapsed ? "Espandi tutto" : "Collassa tutto"}
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
    <div className="overflow-auto border rounded-md max-h-[calc(100vh-220px)]">
      <table className="text-xs min-w-max border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 bg-background text-left px-3 py-2 font-medium border-b border-r min-w-[220px] shadow-[inset_0_-1px_0_rgb(229_231_235)]">
              Analita
            </th>
            {data.panels.map(p => (
              <th
                key={p.id}
                className="sticky top-0 z-20 bg-background px-2 py-2 font-medium whitespace-nowrap shadow-[inset_0_-1px_0_rgb(229_231_235)]"
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
          {data.panel_weights && Object.keys(data.panel_weights).length > 0 && (
            <>
              <tr className="bg-muted/50">
                <td
                  className="sticky left-0 z-10 bg-muted/50 px-3 py-1.5 font-semibold border-r text-sm capitalize"
                  colSpan={1}
                >
                  Corpo (Apple Health)
                </td>
                <td colSpan={data.panels.length} className="bg-muted/50" />
              </tr>
              <tr>
                <td className="sticky left-0 z-10 bg-background px-3 py-1.5 border-r">
                  Peso al prelievo
                </td>
                {data.panels.map(p => {
                  const cell = data.panel_weights?.[String(p.id)]
                  const value = cell?.value_numeric
                  // Corsivo solo se il peso è di >3 giorni prima del prelievo
                  // (oppure manca sample_date).
                  let daysDelta: number | null = null
                  if (cell?.sample_date) {
                    daysDelta =
                      (new Date(p.test_date).getTime() -
                        new Date(cell.sample_date).getTime()) /
                      86_400_000
                  }
                  const staleWeight = daysDelta == null || daysDelta > 3
                  return (
                    <td
                      key={p.id}
                      className={cn(
                        "px-2 py-1.5 text-center whitespace-nowrap border-b border-border/50",
                        staleWeight
                          ? "italic text-muted-foreground"
                          : "font-mono"
                      )}
                      title={
                        cell
                          ? cell.sample_date
                            ? `HKBodyMass ${cell.sample_date} · ${daysDelta?.toFixed(0) ?? "?"} giorni dal prelievo`
                            : "Ultimo HKBodyMass ≤ data prelievo"
                          : ""
                      }
                    >
                      {value != null ? `${value.toFixed(1)} ${cell?.unit ?? "kg"}` : ""}
                    </td>
                  )
                })}
              </tr>
              {CONTEXT_ROWS.map(row => (
                <ContextMatrixRow
                  key={row.key}
                  label={row.label}
                  fieldKey={row.key}
                  panels={data.panels}
                  context={data.panel_context ?? {}}
                />
              ))}
            </>
          )}
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
  const groups = Array.from(m.entries()).map(([category, analytes]) => ({
    category,
    analytes,
  }))
  return sortCategories(groups)
}

function ContextMatrixRow({
  label,
  fieldKey,
  panels,
  context,
}: {
  label: string
  fieldKey: keyof LabPanelContextRow
  panels: LabMatrixResponse["panels"]
  context: Record<string, LabPanelContextRow>
}) {
  return (
    <tr>
      <td className="sticky left-0 z-10 bg-background px-3 py-1.5 border-r text-muted-foreground">
        {label}
      </td>
      {panels.map(p => (
        <td
          key={p.id}
          className="px-1 py-1 align-top border-b border-border/50 min-w-[180px] max-w-[240px]"
        >
          <ContextCell
            panelId={p.id}
            fieldKey={fieldKey}
            initial={context[String(p.id)]?.[fieldKey] ?? ""}
          />
        </td>
      ))}
    </tr>
  )
}

function ContextCell({
  panelId,
  fieldKey,
  initial,
}: {
  panelId: number
  fieldKey: keyof LabPanelContextRow
  initial: string
}) {
  const patch = useLabPatchPanel()
  const [value, setValue] = useState(initial)
  // Risincronizza se il server aggiorna (es. dopo auto-fill).
  useEffect(() => setValue(initial), [initial])

  async function commit() {
    const trimmed = value.trim()
    if (trimmed === initial.trim()) return
    try {
      await patch.mutateAsync({
        panelId,
        patch: { [fieldKey]: trimmed || null },
      })
    } catch (e) {
      alert(`Errore: ${e instanceof Error ? e.message : String(e)}`)
      setValue(initial)
    }
  }

  return (
    <textarea
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={commit}
      placeholder="—"
      rows={2}
      className="w-full text-xs bg-transparent resize-y px-1.5 py-1 rounded border border-transparent hover:border-border focus:border-primary focus:outline-none"
    />
  )
}
