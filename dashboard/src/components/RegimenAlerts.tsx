import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useRegimens } from "@/lib/queries"
import { KIND_LABELS } from "@/components/RegimenForm"
import type { Regimen } from "@/lib/types"
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock"

const ACK_KEY = "regimen_alerts_ack_v1"

type AlertType = "start" | "end"
interface RegimenAlert {
  regimen: Regimen
  type: AlertType
  /** Chiave stabile per il giorno: id:type:YYYY-MM-DD */
  key: string
}

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Legge le chiavi gia' confermate dal localStorage, scartando quelle
 * di giorni diversi da oggi (cosi' la lista non cresce all'infinito). */
function loadAck(today: string): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_KEY)
    if (!raw) return new Set()
    const arr: string[] = JSON.parse(raw)
    const kept = arr.filter(k => k.endsWith(`:${today}`))
    if (kept.length !== arr.length) {
      localStorage.setItem(ACK_KEY, JSON.stringify(kept))
    }
    return new Set(kept)
  } catch {
    return new Set()
  }
}

function persistAck(acked: Set<string>) {
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify([...acked]))
  } catch {
    /* no-op */
  }
}

/**
 * Mostra un popup quando un regime INIZIA oggi o e' al suo ULTIMO giorno
 * (end_date === oggi). Gli avvisi compaiono uno alla volta a ogni accesso
 * alla dashboard finche' non si clicca la spunta; ogni avviso richiede la
 * propria conferma. Lo stato "visto" e' persistito in localStorage per
 * giorno, quindi sopravvive ai reload ma riparte ogni nuovo giorno.
 */
export function RegimenAlerts() {
  const today = useMemo(() => todayLocalISO(), [])
  // Regimi attivi oggi (start <= oggi <= end): include sia chi inizia oggi
  // sia chi finisce oggi (l'ultimo giorno e' ancora "attivo").
  const { data: regimens } = useRegimens({ active_on: today, include_ended: true })

  const [acked, setAcked] = useState<Set<string>>(() => loadAck(today))

  const alerts = useMemo<RegimenAlert[]>(() => {
    if (!regimens) return []
    const out: RegimenAlert[] = []
    for (const r of regimens) {
      // I piani sintetici dal diario (id negativi) non vanno avvisati.
      if (r.id < 0) continue
      if (r.start_date === today) {
        out.push({ regimen: r, type: "start", key: `${r.id}:start:${today}` })
      }
      if (r.end_date === today) {
        out.push({ regimen: r, type: "end", key: `${r.id}:end:${today}` })
      }
    }
    return out
  }, [regimens, today])

  // Primo avviso non ancora confermato.
  const current = alerts.find(a => !acked.has(a.key)) ?? null

  if (!current) return null
  return (
    <RegimenAlertDialog
      alert={current}
      onAck={() => {
        setAcked(prev => {
          const next = new Set(prev)
          next.add(current.key)
          persistAck(next)
          return next
        })
      }}
    />
  )
}

function RegimenAlertDialog({ alert, onAck }: { alert: RegimenAlert; onAck: () => void }) {
  useBodyScrollLock()
  const navigate = useNavigate()
  const { regimen, type } = alert
  const isStart = type === "start"
  const kindLabel = KIND_LABELS[regimen.kind] ?? regimen.kind

  // Ack via spunta: appena selezionata, conferma e passa al prossimo.
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    if (checked) {
      const t = setTimeout(onAck, 150)
      return () => clearTimeout(t)
    }
  }, [checked, onAck])

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 sm:p-8">
      <Card className="w-full max-w-md shadow-2xl mt-[10vh]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${isStart ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            {isStart ? "Un regime inizia oggi" : "Ultimo giorno di un regime"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/40 px-3 py-2.5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{kindLabel}</div>
            <div className="text-base font-semibold">{regimen.name}</div>
            {regimen.dose && (
              <div className="text-sm text-muted-foreground">{regimen.dose}</div>
            )}
            <div className="mt-1 text-sm">
              {isStart
                ? "Oggi è il primo giorno previsto per questo regime."
                : "Oggi è l'ultimo giorno previsto: ricordati di interromperlo o di prolungarlo."}
            </div>
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
            Ho letto l'avviso, non mostrarlo più oggi
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
