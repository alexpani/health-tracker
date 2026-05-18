import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useSyncSessions, useSyncStatus } from "@/lib/queries"
import { formatDateTime, formatNumber } from "@/lib/utils"

function formatDuration(seconds: number): string {
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m < 60) return `${m}m ${sec}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function SyncOverview() {
  const status = useSyncStatus()
  const sessions = useSyncSessions(10)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Stato sincronizzazione</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Campioni totali</span>
            <span className="font-medium tabular-nums">{formatNumber(status.data?.total_samples ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sonno</span>
            <span className="font-medium tabular-nums">{formatNumber(status.data?.total_categories ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Workout</span>
            <span className="font-medium tabular-nums">{formatNumber(status.data?.total_workouts ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tipi distinti</span>
            <span className="font-medium tabular-nums">{status.data?.types.length ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ultima sync</span>
            <span className="font-medium">
              {status.data?.last_sync ? formatDateTime(status.data.last_sync) : "-"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ultime sincronizzazioni</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.data && sessions.data.length > 0 ? (
            <div className="space-y-1 text-sm">
              <p className="text-xs text-muted-foreground pb-2">
                Le righe contrassegnate <span className="inline-flex items-center rounded-md bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-300">wake-up</span> sono sync vuoti: l'app si è svegliata in background (es. SLC, BGAppRefreshTask, observer) ma HealthKit non ha restituito nuovi sample — tipicamente perché il telefono era lockato e i tipi protetti non erano leggibili. Nessun dato perso: l'anchor non avanza e i sample arrivano al sync successivo con device sbloccato.
              </p>
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground border-b pb-2">
                <div className="col-span-5">Quando</div>
                <div className="col-span-2 text-right">Campioni</div>
                <div className="col-span-2 text-right">Batch</div>
                <div className="col-span-3 text-right">Durata</div>
              </div>
              {sessions.data.map((s, i) => {
                const isWakeUp = s.total_samples === 0
                return (
                  <div
                    key={i}
                    className={`grid grid-cols-12 gap-2 py-1.5 border-b last:border-0 ${
                      isWakeUp ? "opacity-60" : ""
                    }`}
                  >
                    <div className="col-span-5 flex items-center gap-2">
                      <span className="font-medium">{formatDateTime(s.started_at)}</span>
                      {isWakeUp && (
                        <span
                          title="Sync vuoto: app svegliata in BG ma HK non ha restituito sample (device probabilmente lockato)"
                          className="inline-flex items-center rounded-md bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-300"
                        >
                          wake-up
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 text-right tabular-nums">{formatNumber(s.total_samples)}</div>
                    <div className="col-span-2 text-right tabular-nums text-muted-foreground">{s.batches}</div>
                    <div className="col-span-3 text-right tabular-nums text-muted-foreground">
                      {formatDuration(s.duration_seconds)}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nessuna sync registrata</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
