import { useState, useMemo } from 'react'
import { Regimen } from '@/lib/types'
import { Button } from './ui/button'
import { RegimenGanttGrid } from './RegimenGanttGrid'
import { RegimenForm } from './RegimenForm'
import { useRegimenTimeline, getDateRange, useGearKm } from '@/hooks/useRegimenTimeline'

interface RegimenTimelineProps {
  regimens: Regimen[]
  isLoading?: boolean
  onRegimensChange?: () => void
}

export function RegimenTimeline({ regimens, isLoading, onRegimensChange }: RegimenTimelineProps) {
  const [presetIdx, setPresetIdx] = useState(0) // "Ultimo mese" default
  const [showEnded, setShowEnded] = useState(true)
  const [hoverRegimenId, setHoverRegimenId] = useState<number | null>(null)
  const [editingRegimen, setEditingRegimen] = useState<Regimen | null>(null)
  // Sorgente per la modalità "duplica" (create pre-compilata, date vuote).
  const [duplicatingFrom, setDuplicatingFrom] = useState<Regimen | null>(null)
  // Anni selezionati come filtro multi-select. Vuoto = nessun filtro
  // (vince il preset temporale). Set non vuoto: il range viene override
  // dall'unione degli anni selezionati (1 gen min → 31 dic max).
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set())

  // Filtra out i regimen di tipo 'diet' dalla timeline
  const timelineRegimens = useMemo(() => regimens.filter(r => r.kind !== 'diet'), [regimens])

  // Lista anni disponibili dal regimen piu' vecchio all'anno corrente
  // (sortati ascendente). I record con date sballate (< 2000) vengono
  // ignorati — vedi commenti in `getDateRange`.
  const availableYears = useMemo(() => {
    const MIN_YEAR = 2000
    const currentYear = new Date().getFullYear()
    let earliest = currentYear
    for (const r of timelineRegimens) {
      if (!r.start_date) continue
      const y = parseInt(r.start_date.slice(0, 4), 10)
      if (y >= MIN_YEAR && y < earliest) earliest = y
    }
    const years: number[] = []
    for (let y = earliest; y <= currentYear; y++) years.push(y)
    return years
  }, [timelineRegimens])

  const toggleYear = (y: number) => {
    setSelectedYears(prev => {
      const next = new Set(prev)
      if (next.has(y)) next.delete(y)
      else next.add(y)
      return next
    })
  }

  // Range effettivo: se ci sono anni selezionati, override del preset.
  const dateRange = useMemo(() => {
    if (selectedYears.size > 0) {
      const sorted = Array.from(selectedYears).sort((a, b) => a - b)
      const min = sorted[0]
      const max = sorted[sorted.length - 1]
      return { start: `${min}-01-01`, end: `${max}-12-31` }
    }
    return getDateRange(presetIdx, timelineRegimens)
  }, [selectedYears, presetIdx, timelineRegimens])
  const { visibleGroups } = useRegimenTimeline(timelineRegimens, dateRange.start, dateRange.end)
  const kmByRegimenId = useGearKm(timelineRegimens)

  // Filtro "mostra terminati": un gruppo e' "in corso" se almeno uno
  // dei suoi regimens lo e' (end_date null o futuro). I gruppi
  // completamente terminati vengono nascosti se showEnded=false.
  const filteredGroups = useMemo(() => {
    if (showEnded) return visibleGroups
    const today = new Date()
    return visibleGroups.filter(g =>
      g.regimens.some(r => !r.end_date || new Date(r.end_date) >= today)
    )
  }, [visibleGroups, showEnded])

  const handleSelectRegimen = (regimen: Regimen) => {
    setEditingRegimen(regimen)
  }

  const handleFormClose = () => {
    setEditingRegimen(null)
    onRegimensChange?.()
  }

  // Duplica: chiude il modale di edit e apre quello della copia (date vuote).
  const handleDuplicate = (source: Regimen) => {
    setEditingRegimen(null)
    setDuplicatingFrom(source)
  }

  const handleDuplicateClose = () => {
    setDuplicatingFrom(null)
    onRegimensChange?.()
  }

  const presets = [
    { label: 'Ultimo mese', idx: 0 },
    { label: 'Ultimi 3 mesi', idx: 1 },
    { label: 'Ultimo anno', idx: 2 },
    { label: 'Ultimi 3 anni', idx: 3 },
    { label: 'Ultimi 5 anni', idx: 4 },
    { label: 'Tutto', idx: 5 },
  ]

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Preset buttons */}
        <div className="flex flex-wrap gap-1">
          {presets.map(preset => {
            // Quando ci sono anni selezionati, i preset diventano "secondari"
            // (il range e' override dagli anni). Il click sul preset svuota
            // gli anni per ripristinare il comportamento normale.
            const isActive = selectedYears.size === 0 && presetIdx === preset.idx
            return (
              <Button
                key={preset.idx}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setPresetIdx(preset.idx)
                  setSelectedYears(new Set())
                }}
                disabled={isLoading}
              >
                {preset.label}
              </Button>
            )
          })}
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* Show ended toggle */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="show-ended"
            checked={showEnded}
            onChange={e => setShowEnded(e.target.checked)}
            disabled={isLoading}
          />
          <label htmlFor="show-ended" className="text-sm font-medium cursor-pointer">
            Mostra terminati
          </label>
        </div>
      </div>

      {/* Year filter — multi-select, override del preset quando attivo */}
      {availableYears.length > 1 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-xs text-muted-foreground mr-1">Anno:</span>
          {availableYears.map(y => (
            <Button
              key={y}
              variant={selectedYears.has(y) ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => toggleYear(y)}
              disabled={isLoading}
            >
              {y}
            </Button>
          ))}
          {selectedYears.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setSelectedYears(new Set())}
              disabled={isLoading}
            >
              Reset
            </Button>
          )}
        </div>
      )}

      {/* Timeline Gantt */}
      <RegimenGanttGrid
        groups={filteredGroups}
        rangeStart={dateRange.start}
        rangeEnd={dateRange.end}
        onSelectRegimen={handleSelectRegimen}
        hoverRegimenId={hoverRegimenId}
        kmByRegimenId={kmByRegimenId}
      />

      {/* Edit modal */}
      {editingRegimen && (
        <RegimenForm
          regimen={editingRegimen}
          onClose={handleFormClose}
          onDuplicate={handleDuplicate}
        />
      )}

      {/* Duplica modal: create pre-compilato dalla copia, date vuote */}
      {duplicatingFrom && (
        <RegimenForm
          duplicateFrom={duplicatingFrom}
          onClose={handleDuplicateClose}
        />
      )}
    </div>
  )
}
