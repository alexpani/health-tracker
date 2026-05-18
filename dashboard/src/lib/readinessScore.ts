import type { Sample, Workout } from "@/lib/types"

/** Risultato del Readiness Score: "domani posso allenarmi forte?".
 *
 *  Combina:
 *  - **Recupero oggi** (peso 0.4): stato autonomico attuale via HRV/RHR/sleep
 *    rispetto al baseline. Calcolato a monte da `computeRecoveryScore`.
 *  - **Carico settimanale (ACWR)** (peso 0.4): rapporto Acute:Chronic Workload.
 *    7g acuto / media (28g/4) cronica. Zona "sweet" 0.8–1.3.
 *    Sopra 1.5 = zona di infortunio (Gabbett 2016, Hulin 2014).
 *  - **Trend HRV** (peso 0.2): pendenza lineare degli ultimi 7g.
 *    HRV in calo monotono = warning, indipendentemente dal valore di oggi.
 *
 *  Se un segnale manca, i pesi vengono rinormalizzati (badge "parziale").
 */

export interface ReadinessReason {
  kind: "ok" | "warn" | "bad"
  text: string
}

export interface ReadinessResult {
  score: number          // 0..100
  label: string          // Pronto / Buono / Cauto / Riposo
  color: string          // tailwind text class
  reasons: ReadinessReason[]
  /** Numeri grezzi a corredo del breakdown */
  acwr: number | null
  acuteKcal: number      // ultimi 7g
  chronicKcalWeekly: number  // media settimanale ultimi 28g
  hrvSlopePerDay: number | null
  partial: boolean
}

function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length }

/** Pendenza lineare (least squares) di un array di valori indicizzati 0..n-1. */
function slope(ys: number[]): number {
  const n = ys.length
  if (n < 3) return 0
  const xs = ys.map((_, i) => i)
  const mx = (n - 1) / 2
  const my = mean(ys)
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  return den === 0 ? 0 : num / den
}

function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/** Mappa ACWR ratio a [0, 1].
 *  - 0.8-1.3 → 1.0 (carico ottimale)
 *  - 0.5-0.8 e 1.3-1.5 → lineare 0.5..1
 *  - <0.5 → 0.5 (detraining)
 *  - >1.5 → lineare 0..0.5 fino a 2.0, oltre 0
 */
function acwrToScore(ratio: number): number {
  if (ratio >= 0.8 && ratio <= 1.3) return 1
  if (ratio < 0.5) return 0.5
  if (ratio < 0.8) return 0.5 + ((ratio - 0.5) / 0.3) * 0.5
  if (ratio <= 1.5) return 1 - ((ratio - 1.3) / 0.2) * 0.5
  if (ratio <= 2.0) return Math.max(0, 0.5 - ((ratio - 1.5) / 0.5) * 0.5)
  return 0
}

/** Mappa la pendenza HRV (ms/giorno) a [0, 1].
 *  - slope >= 0 → 1 (stabile o in salita)
 *  - slope = -1.5 ms/g → 0 (calo monotono significativo)
 *  - lineare interpolato.
 */
function hrvSlopeToScore(s: number): number {
  if (s >= 0) return 1
  if (s <= -1.5) return 0
  return 1 + s / 1.5
}

export function computeReadiness(
  today: string,
  todayRecoveryScore: number | null,
  workouts: Workout[],
  hrvSamples: Sample[],
): ReadinessResult {
  const todayDate = new Date(`${today}T12:00:00`)

  // --- Carico 7g acuto e 28g cronico ---
  const kcalByDay = new Map<string, number>()
  for (const w of workouts) {
    const kcal = w.total_energy_burned
    if (!kcal) continue
    const d = localISODate(new Date(w.start_date))
    kcalByDay.set(d, (kcalByDay.get(d) ?? 0) + kcal)
  }

  let acuteKcal = 0
  for (let k = 1; k <= 7; k++) {
    const d = new Date(todayDate); d.setDate(d.getDate() - k)
    acuteKcal += kcalByDay.get(localISODate(d)) ?? 0
  }
  let chronicKcal = 0
  for (let k = 1; k <= 28; k++) {
    const d = new Date(todayDate); d.setDate(d.getDate() - k)
    chronicKcal += kcalByDay.get(localISODate(d)) ?? 0
  }
  const chronicWeekly = chronicKcal / 4

  const reasons: ReadinessReason[] = []
  let weighted = 0
  let totalWeight = 0

  // ACWR
  let acwr: number | null = null
  if (chronicWeekly >= 100) {
    acwr = acuteKcal / chronicWeekly
    const sub = acwrToScore(acwr)
    weighted += sub * 0.4
    totalWeight += 0.4
    if (acwr > 1.5) reasons.push({
      kind: "bad",
      text: `Carico settimanale alto (ACWR ${acwr.toFixed(2)}, zona di rischio infortuni)`,
    })
    else if (acwr > 1.3) reasons.push({
      kind: "warn",
      text: `Carico settimanale sopra la norma (ACWR ${acwr.toFixed(2)})`,
    })
    else if (acwr < 0.5) reasons.push({
      kind: "warn",
      text: `Hai accumulato poco volume (ACWR ${acwr.toFixed(2)}, detraining)`,
    })
    else reasons.push({
      kind: "ok",
      text: `Carico settimanale nel range ottimale (ACWR ${acwr.toFixed(2)})`,
    })
  } else if (acuteKcal === 0) {
    reasons.push({ kind: "ok", text: "Nessun carico recente registrato" })
  }

  // Today recovery
  if (todayRecoveryScore != null) {
    const sub = todayRecoveryScore / 100
    weighted += sub * 0.4
    totalWeight += 0.4
    if (todayRecoveryScore >= 75) reasons.push({ kind: "ok", text: `Recupero di oggi alto (${todayRecoveryScore}/100)` })
    else if (todayRecoveryScore >= 60) reasons.push({ kind: "ok", text: `Recupero di oggi nella norma (${todayRecoveryScore}/100)` })
    else if (todayRecoveryScore >= 45) reasons.push({ kind: "warn", text: `Recupero di oggi sotto la norma (${todayRecoveryScore}/100)` })
    else reasons.push({ kind: "bad", text: `Recupero di oggi scarso (${todayRecoveryScore}/100)` })
  }

  // HRV trend ultimi 7 giorni
  const hrvByDay = new Map<string, number[]>()
  for (const s of hrvSamples) {
    const d = localISODate(new Date(s.start_date))
    const arr = hrvByDay.get(d)
    if (arr) arr.push(s.value); else hrvByDay.set(d, [s.value])
  }
  const last7: number[] = []
  for (let k = 6; k >= 0; k--) {
    const d = new Date(todayDate); d.setDate(d.getDate() - k)
    const vs = hrvByDay.get(localISODate(d))
    if (vs && vs.length) last7.push(mean(vs))
  }
  let hrvSlopePerDay: number | null = null
  if (last7.length >= 4) {
    hrvSlopePerDay = slope(last7)
    const sub = hrvSlopeToScore(hrvSlopePerDay)
    weighted += sub * 0.2
    totalWeight += 0.2
    if (hrvSlopePerDay <= -1) reasons.push({
      kind: "bad",
      text: `HRV in calo netto (${hrvSlopePerDay.toFixed(1)} ms/giorno negli ultimi 7g)`,
    })
    else if (hrvSlopePerDay <= -0.4) reasons.push({
      kind: "warn",
      text: `HRV in calo lieve negli ultimi 7g (${hrvSlopePerDay.toFixed(1)} ms/g)`,
    })
    else reasons.push({
      kind: "ok",
      text: `HRV stabile o in crescita (${hrvSlopePerDay >= 0 ? "+" : ""}${hrvSlopePerDay.toFixed(1)} ms/g)`,
    })
  }

  const partial = totalWeight < 0.99
  const score = totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) : 50

  let label: string, color: string
  if (score >= 75)      { label = "Pronto";  color = "text-emerald-600" }
  else if (score >= 60) { label = "Buono";   color = "text-blue-600" }
  else if (score >= 45) { label = "Cauto";   color = "text-amber-600" }
  else                  { label = "Riposo";  color = "text-rose-600" }

  return {
    score, label, color, reasons,
    acwr, acuteKcal, chronicKcalWeekly: chronicWeekly,
    hrvSlopePerDay, partial,
  }
}
