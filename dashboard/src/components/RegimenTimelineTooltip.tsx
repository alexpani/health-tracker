import { Regimen } from '@/lib/types'
import { formatDateForDisplay, getKindLabel } from '@/hooks/useRegimenTimeline'

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
