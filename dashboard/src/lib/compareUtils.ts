import type { Sample, Workout, WorkoutActivity, WorkoutDetail, WorkoutSplit } from "./types"

/**
 * Derive the effective_type slug client-side using the same rules the backend
 * applies in `_apply_effective_type_filter`. Used to gate "compare same type"
 * selection in the workouts list.
 */
export function deriveEffectiveType(w: Workout | WorkoutDetail): string {
  const m = (w.metadata ?? {}) as Record<string, unknown>
  const indoor = m.HKIndoorWorkout === "1"
  const swimLoc = m.HKSwimmingLocationType
  if (indoor) {
    if (w.activity_type === 37) return "treadmill_run"
    if (w.activity_type === 52) return "treadmill_walk"
    if (w.activity_type === 13) return "cyclette"
  }
  if (w.activity_type === 46) {
    if (swimLoc === "1") return "swim_pool"
    if (swimLoc === "2") return "swim_open_water"
  }
  return `type_${w.activity_type}`
}

export interface ElapsedPoint {
  /** Seconds elapsed since the workout start. */
  t: number
  value: number
}

/**
 * Convert raw HK samples to {t, value} ordered by elapsed seconds.
 * Samples before workoutStart are kept with negative t (rare) but still sorted.
 */
export function toElapsedSeries(
  samples: Sample[] | undefined,
  workoutStart: string,
  valueTransform: (v: number) => number = v => v,
): ElapsedPoint[] {
  if (!samples || samples.length === 0) return []
  const base = new Date(workoutStart).getTime()
  return samples
    .map(s => ({
      t: Math.round((new Date(s.start_date).getTime() - base) / 1000),
      value: valueTransform(s.value),
    }))
    .filter(p => Number.isFinite(p.value))
    .sort((a, b) => a.t - b.t)
}

export interface MergedPoint {
  t: number
  a: number | null
  b: number | null
}

/**
 * Merge two elapsed series on the union of their t ticks. Missing values
 * are returned as null so recharts can `connectNulls` across the gaps.
 */
export function mergeSeries(a: ElapsedPoint[], b: ElapsedPoint[]): MergedPoint[] {
  const mapA = new Map<number, number>()
  const mapB = new Map<number, number>()
  for (const p of a) mapA.set(p.t, p.value)
  for (const p of b) mapB.set(p.t, p.value)
  const ts = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort((x, y) => x - y)
  return ts.map(t => ({ t, a: mapA.get(t) ?? null, b: mapB.get(t) ?? null }))
}

export interface MergedSplit {
  n: number
  a: WorkoutSplit | null
  b: WorkoutSplit | null
  paceDelta: number | null
}

export function mergeSplits(
  splitsA: WorkoutSplit[] | undefined,
  splitsB: WorkoutSplit[] | undefined,
): MergedSplit[] {
  const max = Math.max(splitsA?.length ?? 0, splitsB?.length ?? 0)
  const out: MergedSplit[] = []
  for (let i = 0; i < max; i++) {
    const a = splitsA?.[i] ?? null
    const b = splitsB?.[i] ?? null
    const paceDelta = a?.pace_sec_per_km != null && b?.pace_sec_per_km != null
      ? a.pace_sec_per_km - b.pace_sec_per_km
      : null
    out.push({ n: i + 1, a, b, paceDelta })
  }
  return out
}

export interface MergedActivity {
  n: number
  a: WorkoutActivity | null
  b: WorkoutActivity | null
  /** A.duration - B.duration (seconds). null when one side missing. */
  durationDelta: number | null
  /** A.pace - B.pace (sec/km). null when missing. */
  paceDelta: number | null
  /** A.avg_hr - B.avg_hr (bpm). null when missing. */
  hrDelta: number | null
}

/**
 * Two activity sequences are considered "coherent" (= worth comparing
 * row-by-row) when both have entries and follow the same kind pattern.
 * If the lengths differ, we still allow comparison but flag it.
 */
export interface ActivitiesCoherence {
  comparable: boolean
  /** true if the kind sequence (work/rest/lap...) matches exactly. */
  sameStructure: boolean
  reason?: string
}

export function checkActivitiesCoherence(
  a: WorkoutActivity[] | null | undefined,
  b: WorkoutActivity[] | null | undefined,
): ActivitiesCoherence {
  if (!a || !b || a.length === 0 || b.length === 0) {
    return { comparable: false, sameStructure: false, reason: "Uno dei workout non ha intervalli." }
  }
  if (a.length !== b.length) {
    return {
      comparable: true,
      sameStructure: false,
      reason: `Numero di intervalli diverso (A: ${a.length}, B: ${b.length}).`,
    }
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i].kind !== b[i].kind) {
      return {
        comparable: true,
        sameStructure: false,
        reason: "La sequenza work/rest differisce: confronto per indice.",
      }
    }
  }
  return { comparable: true, sameStructure: true }
}

export function mergeActivities(
  a: WorkoutActivity[] | null | undefined,
  b: WorkoutActivity[] | null | undefined,
): MergedActivity[] {
  const max = Math.max(a?.length ?? 0, b?.length ?? 0)
  const out: MergedActivity[] = []
  for (let i = 0; i < max; i++) {
    const av = a?.[i] ?? null
    const bv = b?.[i] ?? null
    const durationDelta = av && bv ? av.duration_s - bv.duration_s : null
    const paceDelta = av?.pace_s_per_km != null && bv?.pace_s_per_km != null
      ? av.pace_s_per_km - bv.pace_s_per_km
      : null
    const hrDelta = av?.avg_hr != null && bv?.avg_hr != null
      ? av.avg_hr - bv.avg_hr
      : null
    out.push({ n: i + 1, a: av, b: bv, durationDelta, paceDelta, hrDelta })
  }
  return out
}

export interface MetricDiff {
  delta: number | null
  pct: number | null
  /** true if the delta favors A; null when undefined. */
  betterIsA: boolean | null
}

/**
 * Compute the A - B delta plus percentage and which side is "better".
 * `lowerIsBetter`: pace, duration, HR → smaller is better.
 */
export function diffMetric(
  a: number | null | undefined,
  b: number | null | undefined,
  lowerIsBetter: boolean,
): MetricDiff {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) {
    return { delta: null, pct: null, betterIsA: null }
  }
  const delta = a - b
  const pct = b !== 0 ? (delta / b) * 100 : null
  let betterIsA: boolean | null
  if (delta === 0) betterIsA = null
  else betterIsA = lowerIsBetter ? delta < 0 : delta > 0
  return { delta, pct, betterIsA }
}

export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds)) return ""
  const sign = seconds < 0 ? "-" : ""
  const s = Math.abs(Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${sign}${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  return `${sign}${m}:${String(sec).padStart(2, "0")}`
}

export function formatPaceSecPerKm(secPerKm: number | null | undefined): string {
  if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0) return "-"
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}'${String(s).padStart(2, "0")}"/km`
}

export function formatSignedSeconds(deltaSec: number): string {
  const sign = deltaSec > 0 ? "+" : deltaSec < 0 ? "−" : ""
  const abs = Math.abs(deltaSec)
  const m = Math.floor(abs / 60)
  const s = Math.round(abs % 60)
  if (m === 0) return `${sign}${s}s`
  return `${sign}${m}'${String(s).padStart(2, "0")}"`
}
