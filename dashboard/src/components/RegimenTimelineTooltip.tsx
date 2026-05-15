import { Regimen } from '@/lib/types'
import { formatDateForDisplay, getKindLabel } from '@/hooks/useRegimenTimeline'
import { formatPeriodDuration } from '@/lib/duration'

interface RegimenTimelineTooltipProps {
  regimen: Regimen
  x: number // cursor X in viewport
  y: number // cursor Y in viewport
  km?: number // se presente, mostra "X km percorsi" (per gear)
}

export function RegimenTimelineTooltip({ regimen, x, y, km }: RegimenTimelineTooltipProps) {
  const kindLabel = getKindLabel(regimen.kind as any)
  const startStr = formatDateForDisplay(regimen.start_date)
  const endStr = formatDateForDisplay(regimen.end_date)
  const periodStr = regimen.end_date ? `${startStr} → ${endStr}` : `${startStr} → in corso`
  // Durata "smart": null se manca lo start (raro — solo regimi con
  // `start_date IS NULL` = "iniziato prima del tracking"). Con end null,
  // calcoliamo "in corso da": il prefisso lo aggiunge il template sotto.
  const durationStr = formatPeriodDuration(regimen.start_date, regimen.end_date)

  // Adjust position to avoid overflow
  let tooltipX = x + 10
  let tooltipY = y + 10

  return (
    <div
      className="fixed z-50 bg-popover text-popover-foreground rounded-md border border-border shadow-lg p-3 max-w-xs text-sm pointer-events-none"
      style={{
        left: `${tooltipX}px`,
        top: `${tooltipY}px`,
      }}
    >
      <div className="font-semibold">{regimen.name}</div>

      {regimen.dose && <div className="text-xs text-muted-foreground mt-1">{regimen.dose}</div>}

      <div className="text-xs text-muted-foreground mt-2">{periodStr}</div>
      {durationStr && (
        <div className="text-xs mt-0.5">
          {regimen.end_date ? (
            <>Durata: <span className="font-medium">{durationStr}</span></>
          ) : (
            <>In corso da <span className="font-medium">{durationStr}</span></>
          )}
        </div>
      )}

      {km !== undefined && (
        <div className="text-xs mt-1 font-medium text-purple-600 dark:text-purple-400 tabular-nums">
          {km < 1 ? '0 km percorsi' : `${Math.round(km)} km percorsi`}
        </div>
      )}

      <div className="text-xs text-muted-foreground mt-1 opacity-75">{kindLabel}</div>

      {regimen.notes && <div className="text-xs mt-2 italic line-clamp-2">{regimen.notes}</div>}
    </div>
  )
}
