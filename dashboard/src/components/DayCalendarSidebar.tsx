import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useHealthNoteDays, useWorkouts } from "@/lib/queries"

interface Props {
  /// Data corrente selezionata in formato YYYY-MM-DD (locale).
  selectedDate: string
  /// Callback quando l'utente clicca un giorno; argomento in formato YYYY-MM-DD.
  onSelectDate: (iso: string) => void
  /// Bottone di chiusura per il drawer mobile.
  onClose?: () => void
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

/// Estrae la chiave YYYY-MM-DD dalla `start_date` ISO di un workout, in
/// timezone LOCALE (non UTC) — stessa convenzione usata da Day.tsx.
function workoutDayKey(startDateIso: string): string {
  const d = new Date(startDateIso)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const WEEK_LABELS = ["L", "M", "M", "G", "V", "S", "D"]
const MONTH_NAMES = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
]

export function DayCalendarSidebar({ selectedDate, onSelectDate, onClose }: Props) {
  // Mese visualizzato, indipendente da selectedDate (l'utente puo' navigare
  // i mesi senza spostare il giorno selezionato).
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const [y, m] = selectedDate.split("-").map(Number)
    return { year: y, month: m - 1 }
  })

  const { startIso, endIso, startLocal, endLocal } = useMemo(() => {
    const first = new Date(view.year, view.month, 1)
    const last = new Date(view.year, view.month + 1, 0, 23, 59, 59, 999)
    return {
      startIso: first.toISOString(),
      endIso: last.toISOString(),
      startLocal: isoLocal(first),
      endLocal: isoLocal(last),
    }
  }, [view])

  // Fetch dei workout del mese visualizzato. Usiamo il filtro temporale
  // dell'endpoint esistente; per il mini-calendario serve solo la data.
  const { data: workouts } = useWorkouts({ start: startIso, end: endIso })
  // Fetch delle note di salute del mese visualizzato (date espanse server-side).
  const { data: noteDays } = useHealthNoteDays(startLocal, endLocal)

  // Set di date YYYY-MM-DD col workout (per lookup O(1) nel render griglia).
  const workoutDays = useMemo(() => {
    const s = new Set<string>()
    for (const w of workouts ?? []) s.add(workoutDayKey(w.start_date))
    return s
  }, [workouts])

  const noteDaysSet = useMemo(() => new Set(noteDays ?? []), [noteDays])

  // Costruzione griglia: settimana lunedi-domenica.
  // Padding di giorni "fuori mese" all'inizio per allineare il primo
  // giorno del mese al weekday corretto.
  const grid = useMemo(() => {
    const first = new Date(view.year, view.month, 1)
    // JS getDay(): 0=Dom..6=Sab. Vogliamo 0=Lun..6=Dom.
    const firstWeekdayMonStart = (first.getDay() + 6) % 7
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
    const cells: Array<{ iso: string; day: number; inMonth: boolean }> = []
    // Padding iniziale (mese precedente, mostrato grigio chiaro)
    for (let i = firstWeekdayMonStart - 1; i >= 0; i--) {
      const d = new Date(view.year, view.month, -i)
      cells.push({ iso: isoLocal(d), day: d.getDate(), inMonth: false })
    }
    // Giorni del mese
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ iso: `${view.year}-${pad2(view.month + 1)}-${pad2(d)}`, day: d, inMonth: true })
    }
    // Padding finale per completare l'ultima settimana
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1]
      const [y, m, dd] = last.iso.split("-").map(Number)
      const next = new Date(y, m - 1, dd + 1)
      cells.push({ iso: isoLocal(next), day: next.getDate(), inMonth: false })
    }
    return cells
  }, [view])

  const today = todayIsoLocal()
  const monthLabel = `${MONTH_NAMES[view.month]} ${view.year}`

  function shiftMonth(delta: number) {
    setView(v => {
      const d = new Date(v.year, v.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  function goToToday() {
    const t = new Date()
    setView({ year: t.getFullYear(), month: t.getMonth() })
    onSelectDate(today)
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Label className="text-base font-semibold">Calendario</Label>
        </div>
        {onClose && (
          <Button size="icon" variant="ghost" className="h-7 w-7 md:hidden" onClick={onClose}>
            ✕
          </Button>
        )}
      </div>

      {/* Header mese + navigazione */}
      <div className="flex items-center justify-between">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => shiftMonth(-1)}
          aria-label="Mese precedente"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium capitalize">{monthLabel}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => shiftMonth(1)}
          aria-label="Mese successivo"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Header giorni della settimana */}
      <div className="grid grid-cols-7 gap-1 text-[10px] text-center text-muted-foreground">
        {WEEK_LABELS.map((d, i) => (
          <div key={i} className="py-1">{d}</div>
        ))}
      </div>

      {/* Griglia giorni */}
      <div className="grid grid-cols-7 gap-1">
        {grid.map(cell => {
          const isSelected = cell.iso === selectedDate
          const isToday = cell.iso === today
          const hasWorkout = workoutDays.has(cell.iso)
          const hasNote = noteDaysSet.has(cell.iso)
          // Stile combinato. Selezione vince su tutto.
          let cls = "relative h-9 rounded text-xs font-medium tabular-nums transition-colors flex items-center justify-center "
          if (!cell.inMonth) {
            cls += "text-muted-foreground/40 hover:bg-accent/50 "
          } else if (isSelected) {
            cls += "bg-primary text-primary-foreground "
          } else if (hasWorkout) {
            cls += "bg-emerald-500/25 text-emerald-900 dark:text-emerald-100 hover:bg-emerald-500/40 "
          } else {
            cls += "hover:bg-accent "
          }
          if (isToday && !isSelected) {
            cls += "ring-1 ring-primary "
          }
          const titleParts: string[] = [cell.iso]
          if (hasWorkout) titleParts.push("workout")
          if (hasNote) titleParts.push("nota di salute")
          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => onSelectDate(cell.iso)}
              className={cls}
              title={titleParts.join(" · ")}
            >
              {cell.day}
              {hasNote && cell.inMonth && (
                <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full ${isSelected ? "bg-primary-foreground" : "bg-rose-500"}`} />
              )}
            </button>
          )
        })}
      </div>

      {/* Legenda + bottone Oggi */}
      <div className="space-y-2 pt-1 border-t">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-2">
          <span className="inline-block w-3 h-3 rounded bg-emerald-500/25 ring-emerald-500/40" />
          <span>= giorno con workout</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500" />
          <span>= giorno con nota di salute</span>
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={goToToday}>
          Vai a oggi
        </Button>
      </div>
    </div>
  )
}
