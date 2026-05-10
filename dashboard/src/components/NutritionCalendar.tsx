import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useConsolidatedDailyTotals, useDiarioActivePlan } from "@/lib/queries"
import type { DiarioDailyTotal } from "@/lib/types"

interface Props {
  /// Filtro opzionale per regime: se valorizzato come numero, vengono
  /// "colorate" solo le celle con quel `kcal_target`. Le altre celle del
  /// mese restano visibili ma in grigio chiaro per il contesto. `null` =
  /// "Senza target", `undefined` = nessun filtro.
  kcalTargetFilter?: number | null
  /// Giorno verso cui il calendario deve "focalizzarsi": navigarci sopra
  /// (mostrarne il mese) e selezionare la cella. Cambia quando l'utente
  /// imposta un filtro periodo o clicca un giorno nell'istogramma storico.
  /// `null`/`undefined` = niente focus esterno.
  focusDay?: string | null
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

function formatDateIT(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
}

export function NutritionCalendar({ kcalTargetFilter, focusDay }: Props) {
  const today = todayIsoLocal()
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const t = new Date()
    return { year: t.getFullYear(), month: t.getMonth() }
  })
  // Giorno selezionato dal click su una cella. Default = oggi cosi' il
  // riassunto giornaliero e' visibile all'apertura della pagina (sostituisce
  // la vecchia card "Oggi"). Click sulla stessa cella deseleziona.
  const [selectedDay, setSelectedDay] = useState<string | null>(today)
  // Piano corrente: serve per i target macro (il diario non li espone per
  // giorno storico, solo il piano corrente). Mostriamo i target solo se
  // il giorno selezionato matcha il `kcal_target` del piano corrente
  // (probabile stesso piano).
  const { data: activePlan } = useDiarioActivePlan()

  // Totali consolidati (diario + HK external) all-time. Dedup automatico via
  // TanStack Query con le query identiche di DiarioSection. Cosi' i giorni
  // storici pre-diario (es. 2015 con solo Lifesum) appaiono colorati come
  // nell'istogramma.
  const { data: consolidated } = useConsolidatedDailyTotals()

  // Quando arriva un focusDay esterno (filtro periodo o click sull'istogramma),
  // navighiamo al mese di quel giorno e selezioniamo la cella corrispondente.
  useEffect(() => {
    if (!focusDay) return
    const [y, m, d] = focusDay.split("-").map(Number)
    if (!y || !m || !d) return
    setView({ year: y, month: m - 1 })
    setSelectedDay(focusDay)
  }, [focusDay])

  // Lookup per data YYYY-MM-DD → DiarioDailyTotal
  const byDate = useMemo(() => {
    const m = new Map<string, DiarioDailyTotal>()
    for (const d of consolidated ?? []) m.set(d.date, d)
    return m
  }, [consolidated])

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

  function goToToday() {
    const t = new Date()
    setView({ year: t.getFullYear(), month: t.getMonth() })
    setSelectedDay(today)
  }

  const todayMonthVisible = view.year === new Date().getFullYear() && view.month === new Date().getMonth()

  function isCellDimmed(d: DiarioDailyTotal | undefined): boolean {
    if (kcalTargetFilter === undefined) return false
    if (kcalTargetFilter === null) return d?.kcal_target != null
    return d?.kcal_target !== kcalTargetFilter
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base flex items-baseline gap-2 flex-wrap">
          <span>Calendario registrazioni</span>
          {activePlan && (
            <span className="text-xs font-normal text-muted-foreground">
              · piano: {activePlan.name} ({activePlan.kcal_target.toLocaleString("it-IT")} kcal/die)
            </span>
          )}
        </CardTitle>
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
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={goToToday}
            disabled={todayMonthVisible && selectedDay === today}
            title="Vai a oggi"
          >
            Oggi
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
            const isSelected = cell.iso === selectedDay
            const dimmed = !cell.inMonth || isCellDimmed(d)
            const cls =
              "h-16 rounded text-xs font-medium tabular-nums transition-colors flex flex-col items-center justify-center px-1 gap-0.5 " +
              adherenceClass(adh, dimmed) +
              (isSelected ? " ring-2 ring-primary" : isToday ? " ring-1 ring-primary" : "")
            const tooltip = d
              ? `${cell.iso} · ${Math.round(d.kcal)} kcal${d.kcal_target ? ` / ${Math.round(d.kcal_target)}` : ""}`
              : cell.iso
            return (
              <button
                key={cell.iso}
                type="button"
                title={tooltip}
                onClick={() => setSelectedDay(prev => (prev === cell.iso ? null : cell.iso))}
                className={cls}
              >
                <span className="text-[11px] opacity-80">{cell.day}</span>
                {d && cell.inMonth && !dimmed && (
                  <span className="text-sm font-semibold leading-none">{Math.round(d.kcal)}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Riassunto del giorno selezionato */}
        {selectedDay && (
          <DaySummary
            iso={selectedDay}
            data={byDate.get(selectedDay)}
            activePlan={activePlan ?? null}
            onClose={() => setSelectedDay(null)}
          />
        )}

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

// ---------- Day summary (popover inline) ----------

interface DaySummaryProps {
  iso: string
  data: (DiarioDailyTotal & { sources?: string[] }) | undefined
  /// Piano corrente (per mostrare i target macro). Usato solo se il
  /// kcal_target del giorno coincide col piano attuale (probabile
  /// che siano lo stesso piano — il diario non espone i piani storici).
  activePlan: { name: string; kcal_target: number; protein_g: number; fat_g: number; carbs_g: number } | null
  onClose: () => void
}

function DaySummary({ iso, data, activePlan, onClose }: DaySummaryProps) {
  const sameAsCurrent =
    activePlan != null && data?.kcal_target != null
      ? Math.round(activePlan.kcal_target) === Math.round(data.kcal_target)
      : false

  // Se il giorno usa lo stesso piano del corrente, mostriamo i target macro;
  // altrimenti solo i consumati (il diario non espone i target storici per
  // macro).
  const macroTargets = sameAsCurrent && activePlan
    ? { protein: activePlan.protein_g, fat: activePlan.fat_g, carbs: activePlan.carbs_g }
    : { protein: null, fat: null, carbs: null }

  const kcalTarget = data?.kcal_target ?? activePlan?.kcal_target ?? null
  const kcalDelta = kcalTarget != null && data ? data.kcal - kcalTarget : null

  return (
    <div className="mt-4 pt-4 border-t">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-base font-semibold capitalize">{formatDateIT(iso)}</div>
          {!data && (
            <p className="text-sm text-muted-foreground">Nessuna registrazione alimentare per questo giorno.</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Link
            to={`/day/${iso}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent"
            title="Apri vista giorno completa"
          >
            <ExternalLink className="h-3.5 w-3.5" /> vai al giorno
          </Link>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} title="Chiudi">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-5">
            <ProgressBar value={data.kcal} target={kcalTarget} unit="kcal" label="Calorie" color="#8b5cf6" />
            <ProgressBar value={data.protein_g} target={macroTargets.protein} unit="g" label="Proteine" color="#10b981" />
            <ProgressBar value={data.fat_g} target={macroTargets.fat} unit="g" label="Grassi" color="#f59e0b" />
            <ProgressBar value={data.carbs_g} target={macroTargets.carbs} unit="g" label="Carboidrati" color="#ef4444" />
          </div>
          {kcalDelta != null && (
            <p className="text-sm text-muted-foreground mt-4 tabular-nums">
              {kcalDelta >= 0
                ? <>+{Math.round(kcalDelta)} kcal sopra il target</>
                : <>{Math.round(kcalDelta)} kcal sotto il target</>}
              {!sameAsCurrent && data.kcal_target != null && (
                <> · piano del giorno: {Math.round(data.kcal_target)} kcal/die</>
              )}
            </p>
          )}
          {data.sources && data.sources.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Fonte: <span className="font-medium">{data.sources.join(" · ")}</span>
            </p>
          )}
        </>
      )}
    </div>
  )
}

function ProgressBar({ value, target, unit, label, color }: {
  value: number; target: number | null | undefined; unit: string; label: string; color: string
}) {
  const pct = target && target > 0 ? (value / target) * 100 : 0
  const capped = Math.min(pct, 120)
  const statusColor = pct > 110 ? "text-red-500" : pct > 100 ? "text-amber-500" : "text-emerald-600"
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-baseline text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`tabular-nums font-semibold ${statusColor}`}>
          {target ? `${pct.toFixed(0)}%` : "—"}
        </span>
      </div>
      <div className="h-2.5 bg-muted rounded overflow-hidden">
        <div className="h-full transition-all"
          style={{
            width: `${capped}%`,
            background: pct > 110 ? "#ef4444" : pct > 100 ? "#f59e0b" : color,
          }} />
      </div>
      <p className="text-sm tabular-nums">
        <span className="text-base font-semibold">{value.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</span>
        <span className="text-muted-foreground"> / {target ? target.toLocaleString("it-IT") : "—"} {unit}</span>
      </p>
    </div>
  )
}
