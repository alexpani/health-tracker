import { useSyncStatus } from "@/lib/queries"
import { formatDateTime } from "@/lib/utils"

function relativeFromNow(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "ora"
  if (minutes < 60) return `${minutes} min fa`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h fa`
  const days = Math.floor(hours / 24)
  return `${days} g fa`
}

export function LastSyncIndicator() {
  const { data } = useSyncStatus()
  const lastSync = data?.last_sync ?? null

  let color = "bg-red-500"
  let label = "nessun sync"
  let title = "Nessuna sincronizzazione registrata"

  if (lastSync) {
    const ageHours = (Date.now() - new Date(lastSync).getTime()) / 3600_000
    if (ageHours < 1) color = "bg-emerald-500"
    else if (ageHours < 4) color = "bg-amber-500"
    else color = "bg-red-500"
    label = relativeFromNow(lastSync)
    title = `Ultima sincronizzazione: ${formatDateTime(lastSync)}`
  }

  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0"
      title={title}
      aria-label={title}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="hidden sm:inline tabular-nums">{label}</span>
    </div>
  )
}
