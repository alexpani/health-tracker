import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { BellRing } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useRegimens } from "@/lib/queries"
import { useRegimenReminderSettings } from "@/lib/regimenReminderSettings"
import { KIND_LABELS } from "@/components/RegimenForm"
import type { Regimen } from "@/lib/types"

type ReminderType = "start" | "end"
interface Reminder {
  regimen: Regimen
  type: ReminderType
  /** Data dell'evento (start_date o end_date), ISO YYYY-MM-DD */
  date: string
  /** Giorni mancanti all'evento (0 = oggi). */
  daysUntil: number
}

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
}

function daysBetween(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split("-").map(Number)
  const [ty, tm, td] = toISO.split("-").map(Number)
  const a = new Date(fy, fm - 1, fd).getTime()
  const b = new Date(ty, tm - 1, td).getTime()
  return Math.round((b - a) / 86_400_000)
}

function whenLabel(days: number): string {
  if (days <= 0) return "oggi"
  if (days === 1) return "domani"
  return `tra ${days} giorni`
}

/**
 * Promemoria in home page: regimi che stanno per **cominciare** (start_date
 * nei prossimi N giorni) o per **finire** (end_date nei prossimi N giorni).
 * Si auto-nasconde se non c'e' nulla nell'orizzonte. Click su una voce →
 * pagina Regimi. I piani sintetici dal diario (id negativi) e i gear sono
 * esclusi (non hanno una vera scadenza azionabile).
 */
export function RegimenUpcomingCard() {
  const navigate = useNavigate()
  const today = useMemo(() => todayLocalISO(), [])
  const [{ startDays, endDays }] = useRegimenReminderSettings()
  const startHorizon = useMemo(() => shiftISO(today, startDays), [today, startDays])
  const endHorizon = useMemo(() => shiftISO(today, endDays), [today, endDays])
  const { data: regimens } = useRegimens({ include_ended: true })

  const reminders = useMemo<Reminder[]>(() => {
    if (!regimens) return []
    const out: Reminder[] = []
    for (const r of regimens) {
      if (r.id < 0) continue // piani sintetici dal diario
      if (r.kind === "gear") continue // niente scadenza azionabile
      // Sta per cominciare: oggi <= start_date <= orizzonte inizio
      if (r.start_date && r.start_date >= today && r.start_date <= startHorizon) {
        out.push({ regimen: r, type: "start", date: r.start_date, daysUntil: daysBetween(today, r.start_date) })
      }
      // Sta per finire: oggi <= end_date <= orizzonte fine (e gia' iniziato o senza inizio noto)
      if (
        r.end_date &&
        r.end_date >= today &&
        r.end_date <= endHorizon &&
        (!r.start_date || r.start_date <= today)
      ) {
        out.push({ regimen: r, type: "end", date: r.end_date, daysUntil: daysBetween(today, r.end_date) })
      }
    }
    // Ordina per imminenza, poi inizio prima di fine a parita' di giorno
    out.sort((a, b) => a.daysUntil - b.daysUntil || (a.type === b.type ? 0 : a.type === "start" ? -1 : 1))
    return out
  }, [regimens, today, startHorizon, endHorizon])

  if (reminders.length === 0) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between p-3 pb-1 space-y-0">
        <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
          <BellRing className="h-4 w-4" /> Promemoria regimi
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <ul className="space-y-1.5">
          {reminders.map(rm => {
            const isStart = rm.type === "start"
            const kindLabel = KIND_LABELS[rm.regimen.kind] ?? rm.regimen.kind
            return (
              <li key={`${rm.regimen.id}:${rm.type}`}>
                <button
                  onClick={() => navigate("/regimens")}
                  className="w-full text-left flex items-center gap-2 rounded-md border bg-card/40 px-2.5 py-1.5 hover:bg-accent transition-colors"
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${isStart ? "bg-emerald-500" : "bg-amber-500"}`}
                  />
                  <span className="flex-1 min-w-0 text-sm">
                    <span className="font-medium">{rm.regimen.name}</span>
                    {rm.regimen.dose && (
                      <span className="ml-1 text-xs text-muted-foreground">{rm.regimen.dose}</span>
                    )}
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{kindLabel}</span>
                  </span>
                  <span className="shrink-0 text-xs text-right">
                    <span className={isStart ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                      {isStart ? "inizia" : "finisce"}
                    </span>{" "}
                    <span className="font-medium">{whenLabel(rm.daysUntil)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

export default RegimenUpcomingCard
