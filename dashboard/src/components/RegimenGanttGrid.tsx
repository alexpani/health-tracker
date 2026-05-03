import { useState } from 'react'
import { Regimen } from '@/lib/types'
import { RegimenTimelineTooltip } from './RegimenTimelineTooltip'
import {
  calculateBarPosition,
  getKindColor,
  formatDateMarkers,
  formatDateForDisplay,
} from '@/hooks/useRegimenTimeline'

interface RegimenGanttGridProps {
  regimens: Regimen[]
  rangeStart: string
  rangeEnd: string
  onSelectRegimen?: (regimen: Regimen) => void
  hoverRegimenId?: number | null
}

const MIN_BAR_WIDTH_PCT = 0.6 // visibilita' minima per barre molto brevi

export function RegimenGanttGrid({
  regimens,
  rangeStart,
  rangeEnd,
  onSelectRegimen,
  hoverRegimenId,
}: RegimenGanttGridProps) {
  const [tooltipData, setTooltipData] = useState<{
    regimen: Regimen
    x: number
    y: number
  } | null>(null)

  const dateMarkers = formatDateMarkers(rangeStart, rangeEnd)

  const handleBarMouseEnter = (regimen: Regimen, e: React.MouseEvent) => {
    setTooltipData({ regimen, x: e.clientX, y: e.clientY })
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
          {regimens.map(r => (
            <div
              key={r.id}
              className="h-16 px-3 border-b border-border flex items-center text-sm font-medium truncate hover:bg-muted/50 transition-colors"
              title={r.name}
            >
              {r.name}
            </div>
          ))}
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

            {/* Barre per ogni regimen */}
            {regimens.map(regimen => {
              const barPos = calculateBarPosition(regimen, rangeStart, rangeEnd)
              const color = getKindColor(regimen.kind as any)
              const isHovered = hoverRegimenId === regimen.id

              const widthPct = 100 - barPos.left - barPos.right
              const tooNarrow = widthPct < MIN_BAR_WIDTH_PCT

              // Ancoraggio: se la barra termina entro il range (es. "in corso"
              // che termina al rangeEnd, right=0), ancoriamo a destra cosi'
              // tutte le barre "in corso" finiscono sulla stessa linea
              // verticale anche se forzate ad allargarsi per visibilita'.
              // Altrimenti ancoriamo a sinistra (mantiene la data di inizio).
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
                  className="h-16 border-b border-border flex items-center px-2 relative group bg-muted/5 hover:bg-muted/20 transition-colors"
                >
                  {/* Marker "?" per origine sconosciuta */}
                  {barPos.isUnknownStart && (
                    <div className="absolute left-0 h-full flex items-center pointer-events-none z-10">
                      <div className="border-l-2 border-dashed border-muted-foreground/50 h-3/4" />
                      <span className="text-xs text-muted-foreground ml-1">?</span>
                    </div>
                  )}

                  {/* Bar */}
                  <div
                    className={`absolute h-10 rounded cursor-pointer transition-all ${color} ${
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
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltipData && <RegimenTimelineTooltip regimen={tooltipData.regimen} x={tooltipData.x} y={tooltipData.y} />}

      {/* Empty state */}
      {regimens.length === 0 && (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          Nessun regimen nel periodo selezionato
        </div>
      )}
    </div>
  )
}
