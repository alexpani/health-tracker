import { useState, useMemo } from 'react'
import { Regimen } from '@/lib/types'
import { Button } from './ui/button'
import { RegimenGanttGrid } from './RegimenGanttGrid'
import { RegimenForm } from './RegimenForm'
import { useRegimenTimeline, getDateRange } from '@/hooks/useRegimenTimeline'

interface RegimenTimelineProps {
  regimens: Regimen[]
  isLoading?: boolean
  onRegimensChange?: () => void
}

export function RegimenTimeline({ regimens, isLoading, onRegimensChange }: RegimenTimelineProps) {
  const [presetIdx, setPresetIdx] = useState(1) // "Ultimo anno" default
  const [showEnded, setShowEnded] = useState(true)
  const [hoverRegimenId, setHoverRegimenId] = useState<number | null>(null)
  const [editingRegimen, setEditingRegimen] = useState<Regimen | null>(null)

  const dateRange = useMemo(() => getDateRange(presetIdx, regimens), [presetIdx, regimens])
  const { visible } = useRegimenTimeline(regimens, dateRange.start, dateRange.end)

  const filteredRegimens = useMemo(() => {
    if (showEnded) return visible
    return visible.filter(r => !r.end_date || new Date(r.end_date) >= new Date())
  }, [visible, showEnded])

  const handleSelectRegimen = (regimen: Regimen) => {
    setEditingRegimen(regimen)
  }

  const handleFormClose = () => {
    setEditingRegimen(null)
    onRegimensChange?.()
  }

  const presets = [
    { label: 'Ultimo anno', idx: 0 },
    { label: 'Ultimi 3 anni', idx: 1 },
    { label: 'Ultimi 5 anni', idx: 2 },
    { label: 'Tutto', idx: 3 },
  ]

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Preset buttons */}
        <div className="flex gap-1">
          {presets.map(preset => (
            <Button
              key={preset.idx}
              variant={presetIdx === preset.idx ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPresetIdx(preset.idx)}
              disabled={isLoading}
            >
              {preset.label}
            </Button>
          ))}
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

      {/* Timeline Gantt */}
      <RegimenGanttGrid
        regimens={filteredRegimens}
        rangeStart={dateRange.start}
        rangeEnd={dateRange.end}
        onSelectRegimen={handleSelectRegimen}
        hoverRegimenId={hoverRegimenId}
      />

      {/* Edit modal */}
      {editingRegimen && (
        <RegimenForm
          regimen={editingRegimen}
          onClose={handleFormClose}
        />
      )}
    </div>
  )
}
