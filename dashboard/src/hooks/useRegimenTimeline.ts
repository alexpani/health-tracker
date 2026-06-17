import { useMemo } from 'react'
import { Regimen, Workout } from '@/lib/types'
import { useWorkouts } from '@/lib/queries'

export type RegimenKind = 'medication' | 'supplement' | 'diet' | 'training' | 'gear'

const KIND_ORDER: Record<RegimenKind, number> = {
  medication: 0,
  supplement: 1,
  diet: 2,
  training: 3,
  gear: 4,
}

const KIND_COLORS: Record<RegimenKind, string> = {
  medication: 'bg-red-500 hover:bg-red-600',
  supplement: 'bg-blue-500 hover:bg-blue-600',
  diet: 'bg-green-500 hover:bg-green-600',
  training: 'bg-amber-500 hover:bg-amber-600',
  gear: 'bg-purple-500 hover:bg-purple-600',
}

const KIND_LABELS: Record<RegimenKind, string> = {
  medication: 'Farmaco',
  supplement: 'Integratore',
  diet: 'Dieta',
  training: 'Allenamento',
  gear: 'Scarpe da corsa',
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
  { label: 'Ultimo mese', days: 30 },
  { label: 'Ultimi 3 mesi', days: 90 },
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

const MAX_YEAR_ISO = '2100-01-01'

export function getDateRange(presetIdx: number, regimens?: Regimen[]): DateRange {
  const today = new Date()
  const todayIso = dateToString(today)
  const preset = PRESETS[presetIdx] || PRESETS[0]

  let start: Date
  if (preset.days === null) {
    // Intero storico: deriva dal regimen piu' antico (con padding 30gg).
    // Fallback: ultimi 5 anni se non ci sono date.
    // Defensive: ignora date < 2000 e > 2100 — sono typo (es. "0018-12-19"
    // che sarebbe "2018-12-19" con i 2 mancanti). Senza questo filtro un
    // singolo record con anno 18 d.C. estende il range a ~2000 anni e
    // schiaccia tutte le barre reali in fondo.
    const MIN_YEAR_ISO = '2000-01-01'
    const earliest = regimens
      ?.map(r => r.start_date)
      .filter((d): d is string => !!d && d >= MIN_YEAR_ISO && d <= MAX_YEAR_ISO)
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

  // Estendi la fine del range nel FUTURO cosi' i regimi in corso mostrano
  // una coda proiettata (ditherata, vedi grid) e i regimi con end_date
  // pianificata nel futuro entrano per intero nella vista.
  const spanDays = Math.max(1, (today.getTime() - start.getTime()) / 86_400_000)
  const futurePad = Math.min(60, Math.max(7, Math.round(spanDays * 0.05)))
  let end = addDays(today, futurePad)

  // Se un regimen ha una data di fine pianificata oltre il padding,
  // allarga il range fino a contenerla (con un piccolo margine a destra).
  const maxFutureEnd = regimens
    ?.map(r => r.end_date)
    .filter((d): d is string => !!d && d > todayIso && d <= MAX_YEAR_ISO)
    .sort()
    .pop()
  if (maxFutureEnd) {
    const futureEndDate = addDays(stringToDate(maxFutureEnd), Math.max(7, Math.round(futurePad / 2)))
    if (futureEndDate.getTime() > end.getTime()) end = futureEndDate
  }

  return {
    start: dateToString(start),
    end: dateToString(end),
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

export interface RegimenGroup {
  key: string // `${kind}|${normalizedName}`
  kind: RegimenKind
  name: string // canonical (presa dal regimen piu' recente per readability)
  regimens: Regimen[]
}

/** Normalizza il nome: trim + lowercase. Due regimi con lo stesso
 * normalizedName + kind sono considerati lo stesso "regime" mostrato
 * sulla stessa riga timeline. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

/** Raggruppa per (kind, name normalizzato). Ogni gruppo riunisce le
 * "vite" successive dello stesso regime (es. Coenzima Q10 preso ad
 * aprile, sospeso, ripreso a maggio). Ordina i gruppi per kind poi
 * per earliest start_date del gruppo. */
export function groupRegimens(regimens: Regimen[]): RegimenGroup[] {
  const map = new Map<string, RegimenGroup>()
  for (const r of regimens) {
    const key = `${r.kind}|${normalizeName(r.name)}`
    const existing = map.get(key)
    if (existing) {
      existing.regimens.push(r)
      // Display name: usa quello del regime piu' recente (id maggiore)
      // come canonical. Garantisce capitalization consistente.
      if (r.id > existing.regimens[0].id) {
        existing.name = r.name
      }
    } else {
      map.set(key, {
        key,
        kind: r.kind as RegimenKind,
        name: r.name,
        regimens: [r],
      })
    }
  }
  // Ordina regimens dentro ogni gruppo per start_date
  for (const group of map.values()) {
    group.regimens.sort((a, b) => {
      const aStart = a.start_date || '9999-12-31'
      const bStart = b.start_date || '9999-12-31'
      return aStart.localeCompare(bStart)
    })
  }
  // Ordina gruppi: kind > earliest start_date del gruppo
  return Array.from(map.values()).sort((a, b) => {
    const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    if (kindDiff !== 0) return kindDiff
    const aStart = a.regimens[0].start_date || '9999-12-31'
    const bStart = b.regimens[0].start_date || '9999-12-31'
    return aStart.localeCompare(bStart)
  })
}

/** Un gruppo e' visibile nel range se almeno uno dei suoi regimens lo e'. */
export function isGroupVisible(group: RegimenGroup, rangeStart: string, rangeEnd: string): boolean {
  return group.regimens.some(r => isRegimenVisible(r, rangeStart, rangeEnd))
}

/** Calcola km dei workout running per ogni regimen di kind="gear".
 * Single-fetch sull'intero range coperto dai gear regimens, poi
 * partizione per intervallo. Ritorna Map<regimenId, km>. Vuoto se
 * non ci sono gear. */
export function useGearKm(regimens: Regimen[]): Map<number, number> {
  const gearRegimens = useMemo(() => regimens.filter(r => r.kind === 'gear'), [regimens])

  // Range globale (min start, max end). Per regimen senza start_date
  // usiamo un anno indietro come fallback (raro ma possibile).
  const globalRange = useMemo(() => {
    if (gearRegimens.length === 0) return { start: null, end: null }
    const today = new Date().toISOString().slice(0, 10)
    const fallbackStart = new Date()
    fallbackStart.setFullYear(fallbackStart.getFullYear() - 1)
    const fallback = fallbackStart.toISOString().slice(0, 10)
    const starts = gearRegimens.map(r => r.start_date || fallback)
    const ends = gearRegimens.map(r => r.end_date || today)
    return {
      start: starts.sort()[0],
      end: ends.sort().reverse()[0],
    }
  }, [gearRegimens])

  const workoutsQ = useWorkouts(
    globalRange.start && globalRange.end
      ? {
          effective_types: ['type_37', 'treadmill_run'],
          start: globalRange.start,
          end: globalRange.end,
        }
      : {}
  )

  return useMemo(() => {
    const map = new Map<number, number>()
    if (gearRegimens.length === 0 || !workoutsQ.data) return map
    for (const r of gearRegimens) {
      const today = new Date().toISOString().slice(0, 10)
      const s = r.start_date || '0000-01-01'
      const e = r.end_date || today
      let totalMeters = 0
      for (const w of workoutsQ.data as Workout[]) {
        const wDate = w.start_date.slice(0, 10)
        if (wDate >= s && wDate <= e && w.total_distance) {
          totalMeters += w.total_distance
        }
      }
      map.set(r.id, totalMeters / 1000)
    }
    return map
  }, [gearRegimens, workoutsQ.data])
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

/** Posizione (left/right in %) di un intervallo [startIso, endIso]
 * clampato a [rangeStart, rangeEnd]. startIso null = inizio sconosciuto
 * → ancorato a sinistra del range. */
function positionForInterval(
  startIso: string | null,
  endIso: string,
  rangeStart: string,
  rangeEnd: string
): { left: number; right: number } {
  const startDate = stringToDate(rangeStart)
  const endDate = stringToDate(rangeEnd)
  const totalMs = endDate.getTime() - startDate.getTime()

  const effStart = startIso ? stringToDate(startIso) : startDate
  const effEnd = stringToDate(endIso)

  const clampedStart = new Date(Math.max(effStart.getTime(), startDate.getTime()))
  const clampedEnd = new Date(Math.min(effEnd.getTime(), endDate.getTime()))

  const leftMs = clampedStart.getTime() - startDate.getTime()
  const rightMs = endDate.getTime() - clampedEnd.getTime()

  return {
    left: totalMs > 0 ? (leftMs / totalMs) * 100 : 0,
    right: totalMs > 0 ? (rightMs / totalMs) * 100 : 0,
  }
}

export function calculateBarPosition(
  regimen: Regimen,
  rangeStart: string,
  rangeEnd: string
): BarPosition {
  const endIso = regimen.end_date || rangeEnd
  return {
    ...positionForInterval(regimen.start_date, endIso, rangeStart, rangeEnd),
    isUnknownStart: !regimen.start_date,
  }
}

/** Parte "solida" (certa) della barra. Per i regimi in corso (end_date
 * null) la parte solida si ferma a OGGI: il periodo futuro non e'
 * confermato, viene reso come coda ditherata (vedi calculateFutureTailPosition).
 * I regimi con end_date pianificata restano solidi fino a quella data. */
export function calculateSolidBarPosition(
  regimen: Regimen,
  rangeStart: string,
  rangeEnd: string,
  todayIso: string
): BarPosition {
  const cappedEnd = regimen.end_date
    ? regimen.end_date
    : todayIso < rangeEnd
    ? todayIso
    : rangeEnd
  return {
    ...positionForInterval(regimen.start_date, cappedEnd, rangeStart, rangeEnd),
    isUnknownStart: !regimen.start_date,
  }
}

/** Coda futura ditherata per i regimi in corso (da oggi a fine range).
 * Ritorna null se non applicabile: regimen con end_date pianificata
 * (in quel caso la barra resta solida, niente dither) o range che non
 * arriva nel futuro. */
export function calculateFutureTailPosition(
  regimen: Regimen,
  rangeStart: string,
  rangeEnd: string,
  todayIso: string
): { left: number; right: number } | null {
  if (regimen.end_date) return null // fine pianificata → niente dither
  if (rangeEnd <= todayIso) return null // il range non mostra il futuro
  // Se il regimen inizia nel futuro, la coda parte dal suo inizio.
  const tailStart = regimen.start_date && regimen.start_date > todayIso ? regimen.start_date : todayIso
  if (tailStart >= rangeEnd) return null
  return positionForInterval(tailStart, rangeEnd, rangeStart, rangeEnd)
}

/** Posizione (%) di "oggi" dentro [rangeStart, rangeEnd], o null se
 * oggi cade fuori dal range visibile (allora non si disegna la linea). */
export function computeTodayPct(rangeStart: string, rangeEnd: string): number | null {
  const start = stringToDate(rangeStart).getTime()
  const end = stringToDate(rangeEnd).getTime()
  const today = stringToDate(dateToString(new Date())).getTime()
  if (end <= start) return null
  if (today <= start || today >= end) return null
  return ((today - start) / (end - start)) * 100
}

export function getKindColor(kind: RegimenKind): string {
  return KIND_COLORS[kind] || 'bg-gray-500 hover:bg-gray-600'
}

/** Calcola le posizioni (in %) dei confini anno solare (1 gen) tra
 * rangeStart e rangeEnd, per disegnare le linee verticali separatrici. */
export function computeYearBoundaries(rangeStart: string, rangeEnd: string): Array<{ year: number; pct: number }> {
  const start = stringToDate(rangeStart)
  const end = stringToDate(rangeEnd)
  const totalMs = end.getTime() - start.getTime()
  if (totalMs <= 0) return []
  const result: Array<{ year: number; pct: number }> = []
  for (let y = start.getFullYear() + 1; y <= end.getFullYear(); y++) {
    const boundary = new Date(y, 0, 1).getTime()
    if (boundary > start.getTime() && boundary < end.getTime()) {
      result.push({ year: y, pct: ((boundary - start.getTime()) / totalMs) * 100 })
    }
  }
  return result
}

/** Colore della barra timeline. Per training distingue tre famiglie:
 *  - Corsa outdoor → sky-blue
 *  - Tapis roulant (corsa/camminata indoor) → teal
 *  - Altro (forza/HIIT/flessibilita'/…) → amber default kind color */
export function getRegimenBarColor(kind: RegimenKind, name: string): string {
  if (kind === 'training') {
    if (/tapis roulant|treadmill/i.test(name)) {
      return 'bg-teal-500 hover:bg-teal-600'
    }
    if (/\bcorsa\b/i.test(name)) {
      return 'bg-sky-500 hover:bg-sky-600'
    }
  }
  return getKindColor(kind)
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
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const year = date.getUTCFullYear()

  return `${day}-${month}-${year}`
}

export function useRegimenTimeline(regimens: Regimen[], rangeStart: string, rangeEnd: string) {
  const sorted = useMemo(() => sortRegimens(regimens), [regimens])

  const visible = useMemo(() => filterRegimensInRange(sorted, rangeStart, rangeEnd), [sorted, rangeStart, rangeEnd])

  const groups = useMemo(() => groupRegimens(regimens), [regimens])

  const visibleGroups = useMemo(
    () => groups.filter(g => isGroupVisible(g, rangeStart, rangeEnd)),
    [groups, rangeStart, rangeEnd]
  )

  const dateMarkers = useMemo(() => formatDateMarkers(rangeStart, rangeEnd), [rangeStart, rangeEnd])

  return {
    sorted,
    visible,
    groups,
    visibleGroups,
    dateMarkers,
    presets: PRESETS,
  }
}

export const PRESET_COUNT = PRESETS.length
