import { useMemo } from 'react'
import { Regimen } from '@/lib/types'

export type RegimenKind = 'medication' | 'supplement' | 'diet' | 'training'

const KIND_ORDER: Record<RegimenKind, number> = {
  medication: 0,
  supplement: 1,
  diet: 2,
  training: 3,
}

const KIND_COLORS: Record<RegimenKind, string> = {
  medication: 'bg-red-500 hover:bg-red-600',
  supplement: 'bg-blue-500 hover:bg-blue-600',
  diet: 'bg-green-500 hover:bg-green-600',
  training: 'bg-amber-500 hover:bg-amber-600',
}

const KIND_LABELS: Record<RegimenKind, string> = {
  medication: 'Farmaco',
  supplement: 'Integratore',
  diet: 'Dieta',
  training: 'Allenamento',
}

export interface DateRange {
  start: string // ISO YYYY-MM-DD
  end: string // ISO YYYY-MM-DD
}

export interface BarPosition {
  left: number // percentage 0-100 (anchor sinistro)
  right: number // percentage 0-100 (anchor destro, 0 = bordo destro)
  isUnknownStart: boolean
}

const PRESETS = [
  { label: 'Ultimo anno', days: 365 },
  { label: 'Ultimi 3 anni', days: 365 * 3 },
  { label: 'Ultimi 5 anni', days: 365 * 5 },
  { label: 'Tutto', days: null },
]

function dateToString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function stringToDate(iso: string): Date {
  return new Date(iso + 'T00:00:00Z')
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function getDateRange(presetIdx: number, regimens?: Regimen[]): DateRange {
  const today = new Date()
  const preset = PRESETS[presetIdx] || PRESETS[0]

  let start: Date
  if (preset.days === null) {
    // Intero storico: deriva dal regimen piu' antico (con padding 30gg).
    // Fallback: ultimi 5 anni se non ci sono date.
    const earliest = regimens
      ?.map(r => r.start_date)
      .filter((d): d is string => !!d)
      .sort()[0]
    if (earliest) {
      start = stringToDate(earliest)
      start = addDays(start, -30)
    } else {
      start = addDays(today, -365 * 5)
    }
  } else {
    start = addDays(today, -preset.days)
  }

  return {
    start: dateToString(start),
    end: dateToString(today),
  }
}

export function sortRegimens(regimens: Regimen[]): Regimen[] {
  return [...regimens].sort((a, b) => {
    const kindDiff = KIND_ORDER[a.kind as RegimenKind] - KIND_ORDER[b.kind as RegimenKind]
    if (kindDiff !== 0) return kindDiff

    const aStart = a.start_date || '9999-12-31'
    const bStart = b.start_date || '9999-12-31'
    return aStart.localeCompare(bStart)
  })
}

export function filterRegimensInRange(
  regimens: Regimen[],
  rangeStart: string,
  rangeEnd: string
): Regimen[] {
  return regimens.filter(r => isRegimenVisible(r, rangeStart, rangeEnd))
}

export function isRegimenVisible(
  regimen: Regimen,
  rangeStart: string,
  rangeEnd: string
): boolean {
  const effectiveEnd = regimen.end_date || rangeEnd

  // Regimen ends before range starts
  if (effectiveEnd < rangeStart) return false

  // Regimen starts after range ends (only if start_date is known)
  if (regimen.start_date && regimen.start_date > rangeEnd) return false

  return true
}

export function calculateBarPosition(
  regimen: Regimen,
  rangeStart: string,
  rangeEnd: string
): BarPosition {
  const startDate = stringToDate(rangeStart)
  const endDate = stringToDate(rangeEnd)
  const totalMs = endDate.getTime() - startDate.getTime()

  const isUnknownStart = !regimen.start_date
  const effectiveStart = regimen.start_date ? stringToDate(regimen.start_date) : startDate
  const effectiveEnd = regimen.end_date ? stringToDate(regimen.end_date) : endDate

  // Clamp to range
  const clampedStart = new Date(Math.max(effectiveStart.getTime(), startDate.getTime()))
  const clampedEnd = new Date(Math.min(effectiveEnd.getTime(), endDate.getTime()))

  const leftMs = clampedStart.getTime() - startDate.getTime()
  const rightMs = endDate.getTime() - clampedEnd.getTime()

  return {
    left: totalMs > 0 ? (leftMs / totalMs) * 100 : 0,
    right: totalMs > 0 ? (rightMs / totalMs) * 100 : 0,
    isUnknownStart,
  }
}

export function getKindColor(kind: RegimenKind): string {
  return KIND_COLORS[kind] || 'bg-gray-500 hover:bg-gray-600'
}

export function getKindLabel(kind: RegimenKind): string {
  return KIND_LABELS[kind] || kind
}

export function formatDateMarkers(rangeStart: string, rangeEnd: string): string[] {
  const start = stringToDate(rangeStart)
  const end = stringToDate(rangeEnd)
  const markers: string[] = []

  const current = new Date(start)
  const daysTotal = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))

  // Adjust granularity based on total range
  let stepMonths = 1
  if (daysTotal > 365 * 5) stepMonths = 12
  else if (daysTotal > 365 * 2) stepMonths = 6
  else if (daysTotal > 365) stepMonths = 3

  while (current <= end) {
    markers.push(dateToString(current))
    current.setMonth(current.getMonth() + stepMonths)
  }

  return markers
}

export function formatDateForDisplay(iso: string | null): string {
  if (!iso) return 'origine sconosciuta'

  const date = stringToDate(iso)
  const day = String(date.getUTCDate()).padStart(2, '0')
  const monthNames = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
  const month = monthNames[date.getUTCMonth()]
  const year = date.getUTCFullYear()

  return `${day} ${month} ${year}`
}

export function useRegimenTimeline(regimens: Regimen[], rangeStart: string, rangeEnd: string) {
  const sorted = useMemo(() => sortRegimens(regimens), [regimens])

  const visible = useMemo(() => filterRegimensInRange(sorted, rangeStart, rangeEnd), [sorted, rangeStart, rangeEnd])

  const dateMarkers = useMemo(() => formatDateMarkers(rangeStart, rangeEnd), [rangeStart, rangeEnd])

  return {
    sorted,
    visible,
    dateMarkers,
    presets: PRESETS,
  }
}

export const PRESET_COUNT = PRESETS.length
