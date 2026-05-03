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
    setTooltipData({
      regimen,
      x: e.clientX,
      y: e.clientY,
    })
  }

  const handleBarMouseLeave = () => {
    setTooltipData(null)
  }

  const handleBarClick = (regimen: Regimen) => {
    onSelectRegimen?.(regimen)
  }

  return (
    <div className="space-y-4">
      {/* Main grid */}
      <div className="border border-border rounded-lg overflow-x-auto bg-card">
        <div className="min-w-[800px] flex">
          {/* Y-axis: regimen labels */}
          <div className="flex flex-col w-48 border-r border-border bg-muted/30 flex-shrink-0">
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

          {/* X-axis: timeline bars */}
          <div className="flex-1 flex flex-col">
            {/* Header with month markers */}
            <div className="h-12 border-b border-border flex items-end px-2 relative">
              {(() => {
                // Cap a max ~7 markers per evitare sovrapposizione su range
                // ampi. Decimazione uniforme dell'array completo.
                const MAX_MARKERS = 7
                const total = dateMarkers.length
                const stride = Math.max(1, Math.ceil(total / MAX_MARKERS))
                const decimated = dateMarkers.filter((_, idx) => idx % stride === 0)
                return decimated.map((marker, i) => {
                  const pos = total > 1 ? (dateMarkers.indexOf(marker) / (total - 1)) * 100 : 0
                  return (
                    <div
                      key={marker}
                      className="absolute text-xs text-muted-foreground whitespace-nowrap"
                      style={{
                        left: `${pos}%`,
                        bottom: '2px',
                        transform: i === 0 ? 'translateX(0)' : i === decimated.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                      }}
                    >
                      {formatDateForDisplay(marker)}
                    </div>
                  )
                })
              })()}
            </div>

            {/* Bars for each regimen */}
            {regimens.map(regimen => {
              const barPos = calculateBarPosition(regimen, rangeStart, rangeEnd)
              const color = getKindColor(regimen.kind as any)
              const isHovered = hoverRegimenId === regimen.id

              return (
                <div
                  key={regimen.id}
                  className="h-16 border-b border-border flex items-center px-2 relative group bg-muted/5 hover:bg-muted/20 transition-colors"
                >
                  {/* Unknown start marker */}
                  {barPos.isUnknownStart && (
                    <div className="absolute left-0 h-full flex items-center">
                      <div className="border-l-2 border-dashed border-muted-foreground/50 h-3/4" />
                      <span className="text-xs text-muted-foreground ml-1">?</span>
                    </div>
                  )}

                  {/* Bar */}
                  <div
                    className={`absolute h-10 rounded cursor-pointer transition-all ${color} ${
                      isHovered ? 'ring-2 ring-primary shadow-md' : 'shadow-sm'
                    }`}
                    style={{
                      left: `${barPos.left}%`,
                      width: `${Math.max(2, barPos.width)}%`, // min 2px for visibility
                      minWidth: '4px',
                    }}
                    onClick={() => handleBarClick(regimen)}
                    onMouseEnter={e => handleBarMouseEnter(regimen, e)}
                    onMouseLeave={handleBarMouseLeave}
                    title={`${regimen.name} (${regimen.start_date || '?'} → ${regimen.end_date || 'oggi'})`}
                    aria-label={`${regimen.name}: ${regimen.start_date || 'origin unknown'} to ${regimen.end_date || 'ongoing'}`}
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
