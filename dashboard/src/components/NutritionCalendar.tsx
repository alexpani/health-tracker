import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useDiarioDailyTotals } from "@/lib/queries"
import type { DiarioDailyTotal } from "@/lib/types"

interface Props {
  /// Filtro opzionale per regime: se valorizzato come numero, vengono
  /// "colorate" solo le celle con quel `kcal_target`. Le altre celle del
  /// mese restano visibili ma in grigio chiaro per il contesto. `null` =
  /// "Senza target", `undefined` = nessun filtro.
  kcalTargetFilter?: number | null
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function todayIsoLocal(): string {
  return isoLocal(new Date())
}

const WEEK_LABELS = ["L", "M", "M", "G", "V", "S", "D"]
const MONTH_NAMES = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
]

/// Categoria di aderenza derivata dal rapporto kcal/target.
type Adherence = "under" | "on_target" | "over" | "no_target" | "no_data"

function classify(d: DiarioDailyTotal | undefined): Adherence {
  if (!d) return "no_data"
  if (d.kcal_target == null) return "no_target"
  const r = d.kcal / d.kcal_target
  if (r < 0.9) return "under"
  if (r > 1.1) return "over"
  return "on_target"
}

function adherenceClass(a: Adherence, dimmed: boolean): string {
  if (dimmed) return "bg-muted/30 text-muted-foreground/40"
  switch (a) {
    case "under":
      return "bg-blue-500/25 text-blue-900 dark:text-blue-100 hover:bg-blue-500/40"
    case "on_target":
      return "bg-emerald-500/25 text-emerald-900 dark:text-emerald-100 hover:bg-emerald-500/40"
    case "over":
      return "bg-red-500/25 text-red-900 dark:text-red-100 hover:bg-red-500/40"
    case "no_target":
      return "bg-amber-500/15 text-amber-900 dark:text-amber-100 hover:bg-amber-500/30"
    case "no_data":
      return "hover:bg-accent text-foreground/60"
  }
}

export function NutritionCalendar({ kcalTargetFilter }: Props) {
  const navigate = useNavigate()
  const today = todayIsoLocal()
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const t = new Date()
    return { year: t.getFullYear(), month: t.getMonth() }
  })

  const { startIso, endIso } = useMemo(() => {
    const first = new Date(view.year, view.month, 1)
    const last = new Date(view.year, view.month + 1, 0)
    return { startIso: isoLocal(first), endIso: isoLocal(last) }
  }, [view])

  const { data: dailyTotals } = useDiarioDailyTotals(startIso, endIso)

  // Lookup per data YYYY-MM-DD → DiarioDailyTotal
  const byDate = useMemo(() => {
    const m = new Map<string, DiarioDailyTotal>()
    for (const d of dailyTotals ?? []) m.set(d.date, d)
    return m
  }, [dailyTotals])

  // Costruzione griglia 7×N (lun-dom)
  const grid = useMemo(() => {
    const first = new Date(view.year, view.month, 1)
    const firstWeekday = (first.getDay() + 6) % 7  // 0=Lun..6=Dom
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
    const cells: Array<{ iso: string; day: number; inMonth: boolean }> = []
    for (let i = firstWeekday - 1; i >= 0; i--) {
      const d = new Date(view.year, view.month, -i)
      cells.push({ iso: isoLocal(d), day: d.getDate(), inMonth: false })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ iso: `${view.year}-${pad2(view.month + 1)}-${pad2(d)}`, day: d, inMonth: true })
    }
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1]
      const [y, m, dd] = last.iso.split("-").map(Number)
      const next = new Date(y, m - 1, dd + 1)
      cells.push({ iso: isoLocal(next), day: next.getDate(), inMonth: false })
    }
    return cells
  }, [view])

  function shiftMonth(delta: number) {
    setView(v => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  function isCellDimmed(d: DiarioDailyTotal | undefined): boolean {
    if (kcalTargetFilter === undefined) return false
    if (kcalTargetFilter === null) return d?.kcal_target != null
    return d?.kcal_target !== kcalTargetFilter
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Calendario registrazioni</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium capitalize w-32 text-center">
            {MONTH_NAMES[view.month]} {view.year}
          </span>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => shiftMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 text-[10px] text-center text-muted-foreground mb-1">
          {WEEK_LABELS.map((d, i) => <div key={i} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.map(cell => {
            const d = byDate.get(cell.iso)
            const adh = classify(d)
            const isToday = cell.iso === today
            const dimmed = !cell.inMonth || isCellDimmed(d)
            const cls =
              "h-12 rounded text-xs font-medium tabular-nums transition-colors flex flex-col items-center justify-center px-1 " +
              adherenceClass(adh, dimmed) +
              (isToday ? " ring-1 ring-primary" : "")
            const tooltip = d
              ? `${cell.iso} · ${Math.round(d.kcal)} kcal${d.kcal_target ? ` / ${Math.round(d.kcal_target)}` : ""}`
              : cell.iso
            return (
              <button
                key={cell.iso}
                type="button"
                title={tooltip}
                onClick={() => navigate(`/day/${cell.iso}`)}
                className={cls}
              >
                <span>{cell.day}</span>
                {d && cell.inMonth && !dimmed && (
                  <span className="text-[9px] opacity-70">{Math.round(d.kcal)}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Legenda */}
        <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-emerald-500/25" /> nel target (±10%)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-blue-500/25" /> sotto
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-red-500/25" /> sopra
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-amber-500/15" /> senza target
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
