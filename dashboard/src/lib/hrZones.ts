import type { Sample } from "./types"

export interface ZoneRange {
  idx: number
  label: string
  low: number
  high: number
  color: string
  pctLow: number
  pctHigh: number
}

export interface ZoneDuration {
  idx: number
  seconds: number
}

const ZONE_PCTS: Array<{ idx: number; pctLow: number; pctHigh: number; color: string; label: string }> = [
  { idx: 0, pctLow: 0, pctHigh: 0.5, color: "#9ca3af", label: "Zona 0" },
  { idx: 1, pctLow: 0.5, pctHigh: 0.6, color: "#3b82f6", label: "Zona 1" },
  { idx: 2, pctLow: 0.6, pctHigh: 0.7, color: "#eab308", label: "Zona 2" },
  { idx: 3, pctLow: 0.7, pctHigh: 0.8, color: "#f97316", label: "Zona 3" },
  { idx: 4, pctLow: 0.8, pctHigh: 0.9, color: "#ef4444", label: "Zona 4" },
  { idx: 5, pctLow: 0.9, pctHigh: 1.0, color: "#a855f7", label: "Zona 5" },
]

export function tanakaMaxHR(age: number): number {
  return Math.round(208 - 0.7 * age)
}

export function computeMaxHR(opts: { override?: number | null; age?: number | null }): {
  value: number
  source: "override" | "tanaka"
  age: number
} {
  if (opts.override && opts.override > 0) {
    return { value: Math.round(opts.override), source: "override", age: opts.age ?? 0 }
  }
  const age = opts.age && opts.age > 0 ? opts.age : 35
  return { value: tanakaMaxHR(age), source: "tanaka", age }
}

export function zoneRangesFromMax(maxHR: number): ZoneRange[] {
  return ZONE_PCTS.map((z, i) => {
    const low = Math.round(maxHR * z.pctLow)
    const nextLow = i < ZONE_PCTS.length - 1 ? Math.round(maxHR * ZONE_PCTS[i + 1].pctLow) : maxHR + 1
    const high = nextLow - 1
    return { idx: z.idx, label: z.label, color: z.color, pctLow: z.pctLow, pctHigh: z.pctHigh, low, high }
  })
}

function zoneIndexForValue(value: number, ranges: ZoneRange[]): number {
  for (let i = ranges.length - 1; i >= 0; i--) {
    if (value >= ranges[i].low) return ranges[i].idx
  }
  return 0
}

const MAX_GAP_SECONDS = 60

export function computeZoneDurations(
  samples: Pick<Sample, "start_date" | "value">[],
  ranges: ZoneRange[],
  workoutEnd?: string,
): ZoneDuration[] {
  const out: ZoneDuration[] = ranges.map(r => ({ idx: r.idx, seconds: 0 }))
  if (samples.length < 2) return out

  const sorted = [...samples].sort((a, b) => a.start_date.localeCompare(b.start_date))
  const dts: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const dt = (new Date(sorted[i + 1].start_date).getTime() - new Date(sorted[i].start_date).getTime()) / 1000
    if (dt > 0 && dt <= MAX_GAP_SECONDS) {
      out[zoneIndexForValue(sorted[i].value, ranges)].seconds += dt
      dts.push(dt)
    }
  }

  if (dts.length > 0) {
    const sortedDts = [...dts].sort((a, b) => a - b)
    const median = sortedDts[Math.floor(sortedDts.length / 2)]
    const last = sorted[sorted.length - 1]
    let tail = median
    if (workoutEnd) {
      const tailRaw = (new Date(workoutEnd).getTime() - new Date(last.start_date).getTime()) / 1000
      if (tailRaw > 0) tail = Math.min(tailRaw, median)
    }
    if (tail > 0 && tail <= MAX_GAP_SECONDS) {
      out[zoneIndexForValue(last.value, ranges)].seconds += tail
    }
  }

  return out
}

export function formatHHMMSS(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
}

const HR_ZONES_LS_KEY = "hr_zones_v1"
const BODY_CALC_LS_KEY = "body_calculator_v1"
const USER_PROFILE_LS_KEY = "user_profile_v1"

function ageFromBirthdate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age > 0 ? age : null
}

const DEFAULT_BIRTHDATE = "1969-06-23"

export function readUserBirthdateAge(): number | null {
  try {
    const raw = localStorage.getItem(USER_PROFILE_LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const bd = parsed?.birthdate
      if (typeof bd === "string") return ageFromBirthdate(bd)
    }
  } catch {
    // fall through to default
  }
  return ageFromBirthdate(DEFAULT_BIRTHDATE)
}

export function readHRZonesOverride(): number | null {
  try {
    const raw = localStorage.getItem(HR_ZONES_LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const v = parsed?.maxHR
    return typeof v === "number" && v > 0 ? v : null
  } catch {
    return null
  }
}

export function writeHRZonesOverride(maxHR: number | null): void {
  try {
    if (maxHR == null) {
      localStorage.removeItem(HR_ZONES_LS_KEY)
    } else {
      localStorage.setItem(HR_ZONES_LS_KEY, JSON.stringify({ maxHR }))
    }
  } catch {
    // ignore
  }
}

export function readBodyCalculatorAge(): number | null {
  try {
    const raw = localStorage.getItem(BODY_CALC_LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const v = parsed?.manualAge
    return typeof v === "number" && v > 0 ? v : null
  } catch {
    return null
  }
}
