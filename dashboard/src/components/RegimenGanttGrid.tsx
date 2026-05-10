import { useState } from 'react'
import { Regimen } from '@/lib/types'
import { RegimenTimelineTooltip } from './RegimenTimelineTooltip'
import {
  RegimenGroup,
  calculateBarPosition,
  getKindColor,
  formatDateMarkers,
  formatDateForDisplay,
} from '@/hooks/useRegimenTimeline'

interface RegimenGanttGridProps {
  groups: RegimenGroup[]
  rangeStart: string
  rangeEnd: string
  onSelectRegimen?: (regimen: Regimen) => void
  hoverRegimenId?: number | null
  /** Mappa regimenId -> km percorsi. Solo per regimens kind=gear. */
  kmByRegimenId?: Map<number, number>
}

const MIN_BAR_WIDTH_PCT = 0.6 // visibilita' minima per barre molto brevi

export function RegimenGanttGrid({
  groups,
  rangeStart,
  rangeEnd,
  onSelectRegimen,
  hoverRegimenId,
  kmByRegimenId,
}: RegimenGanttGridProps) {
  const [tooltipData, setTooltipData] = useState<{
    regimen: Regimen
    x: number
    y: number
    km?: number
  } | null>(null)

  const dateMarkers = formatDateMarkers(rangeStart, rangeEnd)

  const handleBarMouseEnter = (regimen: Regimen, e: React.MouseEvent) => {
    setTooltipData({
      regimen,
      x: e.clientX,
      y: e.clientY,
      km: kmByRegimenId?.get(regimen.id),
    })
  }

  const handleBarMouseLeave = () => setTooltipData(null)

  const handleBarClick = (regimen: Regimen) => {
    onSelectRegimen?.(regimen)
  }

  // Decimazione markers: max 7 visibili
  const MAX_MARKERS = 7
  const totalMarkers = dateMarkers.length
  const stride = Math.max(1, Math.ceil(totalMarkers / MAX_MARKERS))
  const decimatedMarkers = dateMarkers.filter((_, idx) => idx % stride === 0)

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg flex bg-card overflow-hidden">
        {/* Y-axis labels — colonna FISSA, fuori dallo scroll */}
        <div className="w-48 flex-shrink-0 border-r border-border bg-muted/30 flex flex-col">
          <div className="h-12 flex items-center px-3 border-b border-border text-xs font-semibold text-muted-foreground">
            Regimen
          </div>
          {groups.map(g => {
            // Per gear groups: somma i km di tutti i regimens del gruppo
            // (se l'utente ha cambiato il nome canonical ma e' lo stesso paio).
            const groupKm =
              g.kind === 'gear' && kmByRegimenId
                ? g.regimens.reduce((acc, r) => acc + (kmByRegimenId.get(r.id) ?? 0), 0)
                : null
            return (
              <div
                key={g.key}
                className="h-16 px-3 border-b border-border flex flex-col justify-center hover:bg-muted/50 transition-colors"
                title={g.name + (g.regimens.length > 1 ? ` (${g.regimens.length} periodi)` : '')}
              >
                <div className="flex items-center text-sm font-medium">
                  <span className="truncate">{g.name}</span>
                  {g.regimens.length > 1 && (
                    <span className="ml-2 text-xs text-muted-foreground flex-shrink-0">×{g.regimens.length}</span>
                  )}
                </div>
                {groupKm !== null && (
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {groupKm < 1 ? '0 km' : `${Math.round(groupKm)} km`}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Timeline scrollabile orizzontalmente */}
        <div className="flex-1 overflow-x-auto">
          <div className="min-w-[600px] flex flex-col">
            {/* Header con date markers */}
            <div className="h-12 border-b border-border flex items-end px-2 relative">
              {decimatedMarkers.map((marker, i) => {
                const pos = totalMarkers > 1 ? (dateMarkers.indexOf(marker) / (totalMarkers - 1)) * 100 : 0
                const transform =
                  i === 0
                    ? 'translateX(0)'
                    : i === decimatedMarkers.length - 1
                    ? 'translateX(-100%)'
                    : 'translateX(-50%)'
                return (
                  <div
                    key={marker}
                    className="absolute text-xs text-muted-foreground whitespace-nowrap"
                    style={{ left: `${pos}%`, bottom: '2px', transform }}
                  >
                    {formatDateForDisplay(marker)}
                  </div>
                )
              })}
            </div>

            {/* Una riga per gruppo, multiple barre se il gruppo ha piu' "vite" */}
            {groups.map(group => {
              const color = getKindColor(group.kind)
              const groupHasUnknownStart = group.regimens.some(r => !r.start_date)
              const hasMultipleBlocks = group.regimens.length > 1
              const barRounding = hasMultipleBlocks ? 'rounded-xl' : 'rounded'

              return (
                <div
                  key={group.key}
                  className="h-16 border-b border-border flex items-center px-2 relative bg-muted/5 hover:bg-muted/20 transition-colors"
                >
                  {/* Marker "?" per origine sconosciuta (a livello gruppo) */}
                  {groupHasUnknownStart && (
                    <div className="absolute left-0 h-full flex items-center pointer-events-none z-10">
                      <div className="border-l-2 border-dashed border-muted-foreground/50 h-3/4" />
                      <span className="text-xs text-muted-foreground ml-1">?</span>
                    </div>
                  )}

                  {/* Una barra per ogni regimen del gruppo */}
                  {group.regimens.map(regimen => {
                    const barPos = calculateBarPosition(regimen, rangeStart, rangeEnd)
                    const isHovered = hoverRegimenId === regimen.id
                    const widthPct = 100 - barPos.left - barPos.right
                    if (widthPct < 0) return null // fuori dal range visibile

                    const tooNarrow = widthPct < MIN_BAR_WIDTH_PCT
                    const anchorRight = barPos.right < 0.01

                    const barStyle: React.CSSProperties = {}
                    if (tooNarrow) {
                      if (anchorRight) {
                        barStyle.right = `${barPos.right}%`
                        barStyle.width = `${MIN_BAR_WIDTH_PCT}%`
                        barStyle.minWidth = '4px'
                      } else {
                        barStyle.left = `${barPos.left}%`
                        barStyle.width = `${MIN_BAR_WIDTH_PCT}%`
                        barStyle.minWidth = '4px'
                      }
                    } else {
                      barStyle.left = `${barPos.left}%`
                      barStyle.right = `${barPos.right}%`
                    }

                    return (
                      <div
                        key={regimen.id}
                        className={`absolute h-10 ${barRounding} cursor-pointer transition-all ${color} ${
                          isHovered ? 'ring-2 ring-primary shadow-md' : 'shadow-sm'
                        }`}
                        style={barStyle}
                        onClick={() => handleBarClick(regimen)}
                        onMouseEnter={e => handleBarMouseEnter(regimen, e)}
                        onMouseLeave={handleBarMouseLeave}
                        title={`${regimen.name} (${regimen.start_date || '?'} → ${regimen.end_date || 'oggi'})`}
                        aria-label={`${regimen.name}: ${regimen.start_date || 'origin unknown'} to ${
                          regimen.end_date || 'ongoing'
                        }`}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltipData && (
        <RegimenTimelineTooltip
          regimen={tooltipData.regimen}
          x={tooltipData.x}
          y={tooltipData.y}
          km={tooltipData.km}
        />
      )}

      {/* Empty state */}
      {groups.length === 0 && (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          Nessun regimen nel periodo selezionato
        </div>
      )}
    </div>
  )
}
