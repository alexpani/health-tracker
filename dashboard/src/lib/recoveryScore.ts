import type { Sample } from "@/lib/types"

/** Risultato dello score di recupero giornaliero (0-100).
 *
 *  Combina tre segnali personali rispetto al baseline rolling 30g:
 *  - HRV SDNN della notte (peso 0.5, marker piu' validato)
 *  - FC a riposo della notte (peso 0.25)
 *  - Sleep score della notte (peso 0.25, gia' 0-100 da computeSleepScore)
 *
 *  I segnali HRV/RHR sono normalizzati via z-score sul baseline personale
 *  degli ultimi 30 giorni, poi mappati linearmente in [0, 1] con
 *  saturazione a ±2σ. Se uno dei tre segnali manca, i pesi degli altri
 *  vengono rinormalizzati. Se mancano TUTTI e tre torna null.
 */

export interface RecoveryComponent {
  key: "hrv" | "rhr" | "sleep"
  label: string
  value: string        // valore di oggi formattato
  baseline: string     // baseline 30g formattato
  zOrPct: string       // delta in forma leggibile ("+8%", "−1.4 bpm")
  contrib: number      // contributo 0..1 al sub-score
}

export interface RecoveryScoreResult {
  score: number        // 0..100 arrotondato
  label: string        // "Pronto" / "Buono" / "Cauto" / "Scarso"
  color: string        // tailwind text class
  components: RecoveryComponent[]
  /** True se almeno un segnale e' mancante (score basato su parziali). */
  partial: boolean
}

const WEIGHTS = { hrv: 0.5, rhr: 0.25, sleep: 0.25 } as const

/** Media aritmetica, robusta a array vuoti. */
function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

/** Mappa uno z-score a [0, 1] con saturazione a ±2σ. */
function normFromZ(z: number): number {
  return Math.max(0, Math.min(1, 0.5 + z / 4))
}

/** Estrae la data locale YYYY-MM-DD da un timestamp ISO. */
function localDay(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/** Aggrega i sample per giorno locale e ritorna media. */
function dailyAverage(samples: Sample[]): Map<string, number> {
  const buckets = new Map<string, number[]>()
  for (const s of samples) {
    const day = localDay(s.start_date)
    const arr = buckets.get(day)
    if (arr) arr.push(s.value)
    else buckets.set(day, [s.value])
  }
  const out = new Map<string, number>()
  for (const [k, v] of buckets) out.set(k, mean(v))
  return out
}

/** Compute today's recovery score.
 *
 *  @param today  YYYY-MM-DD
 *  @param hrvSamples sample HRV degli ultimi N giorni (>=30)
 *  @param rhrSamples sample RHR degli ultimi N giorni (>=30)
 *  @param sleepScoreToday score 0-100 del sonno della notte appena passata,
 *                        o null se non calcolabile.
 *  @param sleepBaseline  array degli score di sonno delle 30 notti precedenti
 *                        (puo' essere vuoto: in tal caso il quality e' assoluto)
 */
export function computeRecoveryScore(
  today: string,
  hrvSamples: Sample[],
  rhrSamples: Sample[],
  sleepScoreToday: number | null,
  sleepBaseline: number[] = [],
): RecoveryScoreResult | null {
  const hrvDaily = dailyAverage(hrvSamples)
  const rhrDaily = dailyAverage(rhrSamples)

  const todayDate = new Date(`${today}T12:00:00`)
  // Baseline: ultimi 30 giorni *prima* di oggi
  const baselineDays: string[] = []
  for (let k = 1; k <= 30; k++) {
    const d = new Date(todayDate)
    d.setDate(d.getDate() - k)
    baselineDays.push(localDay(d.toISOString()))
  }

  const components: RecoveryComponent[] = []
  let totalWeight = 0
  let weighted = 0

  // --- HRV ---
  const hrvToday = hrvDaily.get(today)
  const hrvBase = baselineDays.map(d => hrvDaily.get(d)).filter((v): v is number => v != null)
  if (hrvToday != null && hrvBase.length >= 7) {
    const b = mean(hrvBase)
    const s = stdev(hrvBase) || 1
    const z = (hrvToday - b) / s
    const sub = normFromZ(z)
    weighted += sub * WEIGHTS.hrv
    totalWeight += WEIGHTS.hrv
    components.push({
      key: "hrv",
      label: "HRV (SDNN)",
      value: `${hrvToday.toFixed(1)} ms`,
      baseline: `${b.toFixed(1)} ms`,
      zOrPct: `${z >= 0 ? "+" : ""}${(((hrvToday - b) / b) * 100).toFixed(0)}%`,
      contrib: sub,
    })
  }

  // --- RHR (basso = meglio, segno invertito) ---
  const rhrToday = rhrDaily.get(today)
  const rhrBase = baselineDays.map(d => rhrDaily.get(d)).filter((v): v is number => v != null)
  if (rhrToday != null && rhrBase.length >= 7) {
    const b = mean(rhrBase)
    const s = stdev(rhrBase) || 1
    const z = -(rhrToday - b) / s   // basso = meglio
    const sub = normFromZ(z)
    weighted += sub * WEIGHTS.rhr
    totalWeight += WEIGHTS.rhr
    components.push({
      key: "rhr",
      label: "FC a riposo",
      value: `${rhrToday.toFixed(1)} bpm`,
      baseline: `${b.toFixed(1)} bpm`,
      zOrPct: `${rhrToday - b >= 0 ? "+" : ""}${(rhrToday - b).toFixed(1)} bpm`,
      contrib: sub,
    })
  }

  // --- Sleep ---
  if (sleepScoreToday != null) {
    let sub: number
    let baselineStr = "—"
    if (sleepBaseline.length >= 7) {
      const b = mean(sleepBaseline)
      const s = stdev(sleepBaseline) || 1
      const z = (sleepScoreToday - b) / s
      sub = normFromZ(z)
      baselineStr = `${b.toFixed(0)}/100`
    } else {
      // Fallback assoluto: 70/100 = neutro
      sub = Math.max(0, Math.min(1, (sleepScoreToday - 40) / 60))
      baselineStr = "n/d"
    }
    weighted += sub * WEIGHTS.sleep
    totalWeight += WEIGHTS.sleep
    components.push({
      key: "sleep",
      label: "Sonno",
      value: `${sleepScoreToday}/100`,
      baseline: baselineStr,
      zOrPct: sleepBaseline.length >= 7
        ? `${sleepScoreToday - mean(sleepBaseline) >= 0 ? "+" : ""}${(sleepScoreToday - mean(sleepBaseline)).toFixed(0)}`
        : "",
      contrib: sub,
    })
  }

  if (totalWeight === 0) return null

  const score = Math.round((weighted / totalWeight) * 100)
  const partial = totalWeight < 0.99

  let label: string, color: string
  if (score >= 75)      { label = "Pronto";  color = "text-emerald-600" }
  else if (score >= 60) { label = "Buono";   color = "text-blue-600" }
  else if (score >= 45) { label = "Cauto";   color = "text-amber-600" }
  else                  { label = "Scarso";  color = "text-rose-600" }

  return { score, label, color, components, partial }
}
