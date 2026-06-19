import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useRegimens } from "@/lib/queries"
import { useAppSetting } from "@/lib/appSettings"
import { KIND_LABELS } from "@/components/RegimenForm"
import type { Regimen } from "@/lib/types"
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock"

// Chiavi in app_settings (server-side, condivise tra dispositivi).
const ACK_SETTING = "regimen_alerts_ack" // string[] di chiavi confermate
const EPOCH_SETTING = "regimen_alerts_epoch" // ISO YYYY-MM-DD

type AlertType = "start" | "end"
interface RegimenAlert {
  regimen: Regimen
  type: AlertType
  /** Data dell'evento (start_date o end_date), ISO YYYY-MM-DD */
  date: string
  /** Chiave di conferma stabile: id:type:data-evento (permanente) */
  key: string
}

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatIT(iso: string): string {
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

/**
 * Mostra un popup quando un regime INIZIA (start_date raggiunto) o e' arrivato
 * al suo ULTIMO giorno previsto (end_date raggiunto). A differenza di un avviso
 * "una tantum", l'avviso **persiste anche nei giorni successivi** finche' non
 * viene confermato UNA volta. Conferme ed "epoca" sono persistite **lato
 * server** (`app_settings`), quindi condivise tra dispositivi: confermare un
 * avviso su un browser lo zittisce ovunque. Si risolve da solo anche se il
 * regime viene prolungato (end_date spostato nel futuro) o eliminato. Gli
 * avvisi compaiono uno alla volta, in coda.
 *
 * "Epoca": il primo giorno in cui questa logica gira (impostata una volta sul
 * server). Solo gli eventi con data >= epoca generano avvisi, cosi' al primo
 * caricamento NON esplodono popup per tutti i regimi storici. I regimi futuri
 * hanno sempre data >= epoca, quindi funzionano sempre.
 */
export function RegimenAlerts() {
  const today = useMemo(() => todayLocalISO(), [])
  // Tutti i regimi (anche terminati): serve per avvisare di fine anche DOPO
  // la scadenza, che `active_on=oggi` escluderebbe.
  const { data: regimens } = useRegimens({ include_ended: true })

  const { value: ackedList, isLoaded: ackLoaded, set: setAck } = useAppSetting<string[]>(ACK_SETTING, [])
  const {
    rawValue: epochRaw,
    isLoaded: epochLoaded,
    set: setEpoch,
  } = useAppSetting<string>(EPOCH_SETTING, "")
  const epoch = epochRaw // string | null

  // Inizializza l'epoca lato server una sola volta (al primo giorno in cui la
  // feature gira), se non e' mai stata impostata.
  useEffect(() => {
    if (epochLoaded && epochRaw == null) {
      setEpoch(today)
    }
  }, [epochLoaded, epochRaw, today, setEpoch])

  const acked = useMemo(() => new Set(ackedList), [ackedList])

  const alerts = useMemo<RegimenAlert[]>(() => {
    if (!regimens || !epoch) return []
    const out: RegimenAlert[] = []
    for (const r of regimens) {
      // Piani sintetici dal diario (id negativi): niente avvisi.
      if (r.id < 0) continue
      // Inizio raggiunto: epoca <= start_date <= oggi
      if (r.start_date && r.start_date >= epoch && r.start_date <= today) {
        out.push({ regimen: r, type: "start", date: r.start_date, key: `${r.id}:start:${r.start_date}` })
      }
      // Ultimo giorno raggiunto o passato: epoca <= end_date <= oggi
      if (r.end_date && r.end_date >= epoch && r.end_date <= today) {
        out.push({ regimen: r, type: "end", date: r.end_date, key: `${r.id}:end:${r.end_date}` })
      }
    }
    return out
  }, [regimens, today, epoch])

  // Aspetta che ack + epoca siano caricati dal server: senza, mostreremmo
  // popup gia' confermati o con epoca sbagliata.
  const ready = ackLoaded && epochLoaded && epoch != null
  const current = ready ? alerts.find(a => !acked.has(a.key)) ?? null : null

  if (!current) return null
  return (
    <RegimenAlertDialog
      alert={current}
      today={today}
      onAck={() => {
        setAck(Array.from(new Set([...ackedList, current.key])))
      }}
    />
  )
}

function RegimenAlertDialog({
  alert,
  today,
  onAck,
}: {
  alert: RegimenAlert
  today: string
  onAck: () => void
}) {
  useBodyScrollLock()
  const navigate = useNavigate()
  const { regimen, type, date } = alert
  const isStart = type === "start"
  const isToday = date === today
  const kindLabel = KIND_LABELS[regimen.kind] ?? regimen.kind

  let message: string
  if (isStart) {
    message = isToday
      ? "Oggi è il primo giorno previsto per questo regime."
      : `Avrebbe dovuto iniziare il ${formatIT(date)}.`
  } else {
    message = isToday
      ? "Oggi è l'ultimo giorno previsto: ricordati di interromperlo o di prolungarlo."
      : `L'ultimo giorno previsto era il ${formatIT(date)}: ricordati di interromperlo o di prolungarlo.`
  }

  // La spunta abilita solo il pulsante "Conferma": l'avviso si chiude SOLO
  // quando l'utente clicca esplicitamente "Conferma" (o "Apri Regimi").
  const [checked, setChecked] = useState(false)

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 sm:p-8">
      <Card className="w-full max-w-md shadow-2xl mt-[10vh]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${isStart ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            {isStart ? "Un regime è iniziato" : "Ultimo giorno di un regime"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/40 px-3 py-2.5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{kindLabel}</div>
            <div className="text-base font-semibold">{regimen.name}</div>
            {regimen.dose && (
              <div className="text-sm text-muted-foreground">{regimen.dose}</div>
            )}
            <div className="mt-1 text-sm">{message}</div>
            {regimen.notes && (
              <div className="mt-1 text-sm text-muted-foreground italic">{regimen.notes}</div>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={checked}
              onChange={e => setChecked(e.target.checked)}
            />
            Ho letto l'avviso, non mostrarlo più
          </label>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onAck()
                navigate("/regimens")
              }}
            >
              Apri Regimi
            </Button>
            <Button size="sm" disabled={!checked} onClick={onAck}>
              Conferma
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
