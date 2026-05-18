import type { Sample } from "@/lib/types"

/** Stato di recupero "evidence-based": tre flag indipendenti che derivano
 *  da soglie supportate dalla letteratura sportiva, invece di una media
 *  pesata di z-score (che e' un'euristica come quella di Bevel/Whoop/Oura).
 *
 *  Segnali:
 *  1. HRV rolling 7g vs baseline 60g — z-score con saturazione ±1σ:
 *     Plews 2013 ("Heart rate variability in elite triathletes"),
 *     Buchheit 2014. Rolling 7g elimina il rumore quotidiano dell'HRV
 *     notturna (±20%); baseline 60g e' la finestra raccomandata.
 *  2. FC a riposo vs baseline 60g — soglie operative:
 *     Achten & Jeukendrup 2003. +5 bpm dal baseline e' il marker di
 *     stress/malattia incipiente.
 *  3. Streak HRV decrescente consecutiva — Plews 2013, Stanley 2013:
 *     3+ giorni consecutivi con HRV sotto il baseline = warning,
 *     indipendentemente dal valore assoluto.
 *
 *  Verdetto = peggior flag (RED -> "Riposo", AMBER -> "Cauto",
 *  tutti GREEN -> "Pronto"). Niente score 0-100, niente media pesata.
 */

export type FlagStatus = "green" | "amber" | "red"

export interface RecoveryFlag {
  key: "hrv_rolling" | "rhr_delta" | "hrv_streak"
  label: string
  value: string
  baseline: string
  detail: string
  status: FlagStatus
  /** Punti recenti per sparkline (most-recent-last). */
  spark?: number[]
}

export interface RecoveryStatus {
  verdict: "Pronto" | "Cauto" | "Riposo"
  color: string
  flags: RecoveryFlag[]
  /** True se uno o piu' flag non sono valutabili per dati insufficienti. */
  partial: boolean
}

function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length }
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/** Riduce i sample alla "finestra notturna" del giorno di risveglio D:
 *  [D-1 22:00, D 10:00 ora locale). Ritorna map giorno → media valori. */
export function nightlyAverage(samples: Sample[]): Map<string, number> {
  const buckets = new Map<string, number[]>()
  for (const s of samples) {
    const d = new Date(s.start_date)
    const h = d.getHours()
    let nightDay: Date | null = null
    if (h >= 22) { nightDay = new Date(d); nightDay.setDate(nightDay.getDate() + 1) }
    else if (h < 10) { nightDay = new Date(d) }
    if (!nightDay) continue
    const key = localISODate(nightDay)
    const arr = buckets.get(key)
    if (arr) arr.push(s.value); else buckets.set(key, [s.value])
  }
  const out = new Map<string, number>()
  for (const [k, v] of buckets) out.set(k, mean(v))
  return out
}

/** Helper: estrae i valori giornalieri ordinati (most-recent-first) per N
 *  giorni fino a `today`, escludendo quelli senza dato. */
function valuesUpTo(daily: Map<string, number>, today: string, days: number): number[] {
  const out: number[] = []
  const start = new Date(`${today}T12:00:00`)
  for (let k = 0; k < days; k++) {
    const d = new Date(start); d.setDate(d.getDate() - k)
    const v = daily.get(localISODate(d))
    if (v != null) out.push(v)
  }
  return out
}

/** Flag 1: HRV rolling 7g vs baseline 60g (Plews 2013).
 *  GREEN se rolling >= baseline_mean - 0.5σ, AMBER fra -0.5 e -1σ,
 *  RED se rolling < -1σ. */
function flagHrvRolling(hrvDaily: Map<string, number>, today: string): RecoveryFlag | null {
  const rolling = valuesUpTo(hrvDaily, today, 7)
  const baseline = valuesUpTo(hrvDaily, today, 60)
  if (rolling.length < 4 || baseline.length < 14) return null
  const r = mean(rolling)
  const b = mean(baseline)
  const s = stdev(baseline) || 1
  const z = (r - b) / s
  let status: FlagStatus
  let detail: string
  if (z >= -0.5) { status = "green"; detail = `rolling 7g in linea col baseline 60g (z ${z.toFixed(2)})` }
  else if (z >= -1) { status = "amber"; detail = `rolling 7g sotto il baseline (z ${z.toFixed(2)})` }
  else { status = "red"; detail = `rolling 7g molto sotto il baseline (z ${z.toFixed(2)})` }
  return {
    key: "hrv_rolling",
    label: "HRV rolling 7g vs baseline 60g",
    value: `${r.toFixed(1)} ms`,
    baseline: `${b.toFixed(1)} ± ${s.toFixed(1)} ms`,
    detail,
    status,
    spark: rolling.slice().reverse(),
  }
}

/** Flag 2: FC a riposo vs baseline 60g (Achten & Jeukendrup 2003).
 *  GREEN delta ≤ +3 bpm, AMBER fra +3 e +5, RED > +5 bpm. */
function flagRhrDelta(rhrDaily: Map<string, number>, today: string): RecoveryFlag | null {
  // RHR e' 1 sample al giorno: prendiamo il piu' recente disponibile entro 3gg
  // per evitare il falso "manca" quando l'Apple Watch e' in ritardo a sincare.
  const recent = valuesUpTo(rhrDaily, today, 3)
  const baseline = valuesUpTo(rhrDaily, today, 60)
  if (recent.length === 0 || baseline.length < 14) return null
  const todayVal = recent[0]
  const b = mean(baseline)
  const delta = todayVal - b
  let status: FlagStatus
  let detail: string
  if (delta <= 3) { status = "green"; detail = `RHR in linea col baseline (${delta >= 0 ? "+" : ""}${delta.toFixed(1)} bpm)` }
  else if (delta <= 5) { status = "amber"; detail = `RHR sopra il baseline di +${delta.toFixed(1)} bpm` }
  else { status = "red"; detail = `RHR molto sopra il baseline (+${delta.toFixed(1)} bpm, soglia stress 5 bpm)` }
  return {
    key: "rhr_delta",
    label: "FC a riposo vs baseline 60g",
    value: `${todayVal.toFixed(1)} bpm`,
    baseline: `${b.toFixed(1)} bpm`,
    detail,
    status,
    spark: valuesUpTo(rhrDaily, today, 14).slice().reverse(),
  }
}

/** Flag 3: streak HRV consecutiva sotto baseline (Plews 2013, Stanley 2013).
 *  GREEN se streak ≤ 2, AMBER fra 3 e 4, RED ≥ 5. */
function flagHrvStreak(hrvDaily: Map<string, number>, today: string): RecoveryFlag | null {
  const baseline = valuesUpTo(hrvDaily, today, 60)
  if (baseline.length < 14) return null
  const b = mean(baseline)
  // Conta giorni consecutivi a partire da oggi con HRV < baseline_mean
  let streak = 0
  const start = new Date(`${today}T12:00:00`)
  for (let k = 0; k < 14; k++) {
    const d = new Date(start); d.setDate(d.getDate() - k)
    const v = hrvDaily.get(localISODate(d))
    if (v == null) break  // gap = interruzione streak
    if (v < b) streak++
    else break
  }
  let status: FlagStatus
  let detail: string
  if (streak <= 2) { status = "green"; detail = `${streak} giorni consecutivi sotto baseline (soglia 3)` }
  else if (streak <= 4) { status = "amber"; detail = `${streak} giorni consecutivi sotto baseline (warning)` }
  else { status = "red"; detail = `${streak} giorni consecutivi sotto baseline (overtraining/illness)` }
  return {
    key: "hrv_streak",
    label: "Streak HRV sotto baseline",
    value: `${streak} giorn${streak === 1 ? "o" : "i"}`,
    baseline: `media 60g ${b.toFixed(1)} ms`,
    detail,
    status,
  }
}

export function computeRecoveryStatus(
  today: string,
  hrvSamples: Sample[],
  rhrSamples: Sample[],
): RecoveryStatus | null {
  const hrvDaily = nightlyAverage(hrvSamples)
  const rhrDaily = nightlyAverage(rhrSamples)

  const flags: RecoveryFlag[] = []
  for (const f of [flagHrvRolling(hrvDaily, today), flagRhrDelta(rhrDaily, today), flagHrvStreak(hrvDaily, today)]) {
    if (f) flags.push(f)
  }
  if (flags.length === 0) return null

  const hasRed = flags.some(f => f.status === "red")
  const hasAmber = flags.some(f => f.status === "amber")
  let verdict: RecoveryStatus["verdict"]
  let color: string
  if (hasRed)        { verdict = "Riposo"; color = "text-rose-600" }
  else if (hasAmber) { verdict = "Cauto";  color = "text-amber-600" }
  else               { verdict = "Pronto"; color = "text-emerald-600" }

  return { verdict, color, flags, partial: flags.length < 3 }
}
