import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useWorkouts } from "@/lib/queries"
import { computeWorkloadStatus } from "@/lib/readinessScore"
import type { FlagStatus } from "@/lib/recoveryScore"

function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

const STATUS_DOT: Record<FlagStatus, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
}
const STATUS_TEXT: Record<FlagStatus, string> = {
  green: "text-emerald-600",
  amber: "text-amber-600",
  red: "text-rose-600",
}

export function ReadinessCard() {
  const { todayISO, startISO, endISO } = useMemo(() => {
    const t = new Date()
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate())
    const start = new Date(today); start.setDate(start.getDate() - 35)
    const end = new Date(today); end.setDate(end.getDate() + 1)
    return {
      todayISO: localISODate(today),
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [new Date().toDateString()])

  const workoutsQ = useWorkouts({ start: startISO, end: endISO })

  const result = useMemo(() => {
    if (!workoutsQ.data) return null
    return computeWorkloadStatus(todayISO, workoutsQ.data)
  }, [workoutsQ.data, todayISO])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Carico settimanale</CardTitle>
        <CardDescription>
          Rapporto Acute:Chronic Workload (ACWR) — sweet spot 0.8-1.3 (Gabbett 2016, Hulin 2014)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {workoutsQ.isLoading ? (
          <div className="h-20 animate-pulse bg-muted rounded" />
        ) : !result ? (
          <p className="text-sm text-muted-foreground">Dati insufficienti.</p>
        ) : (
          <div className="space-y-4">
            <details className="text-xs text-muted-foreground bg-muted/30 rounded p-3">
              <summary className="cursor-pointer font-medium text-foreground">Come funziona l'ACWR</summary>
              <div className="mt-2 space-y-2 leading-relaxed">
                <p>
                  <strong>ACWR = Acute:Chronic Workload Ratio</strong>. Confronta il carico
                  delle ultime <strong>1 settimana</strong> (acuto) con la <strong>media
                  settimanale delle ultime 4 settimane</strong> (cronico). Misura quanto sei
                  uscito dalla tua routine.
                </p>
                <p>
                  Gabbett 2016 (BJSM) ha mostrato che il <strong>sweet spot 0.8-1.3</strong> e' la
                  zona di adattamento progressivo. <strong>Sopra 1.5</strong> il rischio infortuni
                  aumenta del ~50%: il corpo non ha avuto tempo di adattarsi all'incremento.
                  <strong> Sotto 0.5</strong> il carico e' insufficiente per mantenere la forma
                  fisica (detraining).
                </p>
                <p>
                  Misurato in <strong>kcal totali</strong> dei workout — proxy del TRIMP (Training
                  Impulse) classico, dato che non ho la FC massima personalizzata per ogni sport.
                  Funziona bene per chi corre/pedala col Watch; meno preciso con app esterne.
                </p>
              </div>
            </details>

            <div className="flex items-center gap-3">
              <span className={`inline-block w-3 h-3 rounded-full flex-shrink-0 ${STATUS_DOT[result.status]}`} />
              <div className={`text-2xl font-bold ${STATUS_TEXT[result.status]}`}>{result.verdict}</div>
            </div>

            <p className={`text-sm ${STATUS_TEXT[result.status]}`}>{result.detail}</p>

            <div className="pt-2 border-t grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">Carico 7g</div>
                <div className="font-medium tabular-nums">{Math.round(result.acuteKcal)} kcal</div>
              </div>
              <div>
                <div className="text-muted-foreground">Media sett. 28g</div>
                <div className="font-medium tabular-nums">{Math.round(result.chronicKcalWeekly)} kcal</div>
              </div>
              <div>
                <div className="text-muted-foreground">ACWR</div>
                <div className="font-medium tabular-nums">{result.acwr != null ? result.acwr.toFixed(2) : "—"}</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
