import { useState } from 'react'
import { Regimen } from '@/lib/types'
import { RegimenTimelineTooltip } from './RegimenTimelineTooltip'
import {
  RegimenGroup,
  calculateBarPosition,
  getRegimenBarColor,
  computeYearBoundaries,
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

  // Oggi (ISO) per "ditherare" le barre dei regimi terminati.
  const todayIso = new Date().toISOString().slice(0, 10)

  // Decimazione markers: max 7 visibili
  const MAX_MARKERS = 7
  const totalMarkers = dateMarkers.length
  const stride = Math.max(1, Math.ceil(totalMarkers / MAX_MARKERS))
  const decimatedMarkers = dateMarkers.filter((_, idx) => idx % stride === 0)

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg flex bg-card overflow-hidden">
        {/* Y-axis labels — colonna FISSA, fuori dallo scroll */}
        <div className="w-32 sm:w-48 flex-shrink-0 border-r border-border bg-muted/30 flex flex-col">
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
        <div className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain">
          <div className="min-w-[600px] flex flex-col relative">
            {/* Linee verticali separatrici anno solare (1 gen di ogni anno
                tra rangeStart e rangeEnd). Spanno tutta l'altezza
                (header + righe gruppi) via absolute. */}
            {computeYearBoundaries(rangeStart, rangeEnd).map(({ year, pct }) => (
              <div
                key={year}
                className="absolute top-0 bottom-0 w-px bg-border/70 pointer-events-none z-0"
                style={{ left: `${pct}%` }}
              >
                <span className="absolute -top-0.5 left-1 text-[10px] font-medium text-muted-foreground/80 whitespace-nowrap">
                  {year}
                </span>
              </div>
            ))}
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
              const color = getRegimenBarColor(group.kind, group.regimens[0]?.name ?? '')
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
                    // Tolerance FP: per regimi con `start_date == end_date`
                    // (eventi puntuali, durata 0), `left + right` puo'
                    // essere ~100.0000001 in floating point e widthPct
                    // leggermente negativo. NON sono fuori range —
                    // `filterRegimensInRange` li ha gia' filtrati a monte,
                    // quindi qui ci arrivano solo se intersecano. Skip solo
                    // se davvero fuori (> 1% di slack).
                    if (widthPct < -1) return null
                    const safeWidthPct = Math.max(0, widthPct)

                    const tooNarrow = safeWidthPct < MIN_BAR_WIDTH_PCT
                    const anchorRight = barPos.right < 0.01
                    // Terminato = end_date passata → barra "ditherata"
                    // (opacità ridotta + tratteggio diagonale) per distinguerla
                    // dai periodi attivi.
                    const isEnded = !!regimen.end_date && regimen.end_date < todayIso

                    const barStyle: React.CSSProperties = {}
                    if (isEnded) {
                      barStyle.backgroundImage =
                        'repeating-linear-gradient(45deg, rgba(255,255,255,0) 0, rgba(255,255,255,0) 4px, rgba(255,255,255,0.4) 4px, rgba(255,255,255,0.4) 7px)'
                    }
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
                        } ${isEnded ? 'opacity-60' : ''}`}
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
