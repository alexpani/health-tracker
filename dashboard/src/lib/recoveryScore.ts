import type { Sample } from "@/lib/types"

/** Score di recupero giornaliero (0-100) basato sui biomarker NOTTURNI.
 *
 *  Allineato all'approccio Bevel: ogni segnale viene preso solo nella
 *  finestra di sonno (22:00 ieri → 10:00 oggi, ora locale) per evitare
 *  contaminazione da letture diurne (es. Breathe HRV durante il giorno
 *  gonfia falsamente la metrica).
 *
 *  Cinque componenti, pesati e confrontati col baseline rolling 30g:
 *  - HRV SDNN notturna (peso 0.35) — marker autonomico principale
 *  - FC a riposo (peso 0.25) — Apple Watch ne scrive 1/giorno a mezzanotte
 *  - Frequenza respiratoria notturna (peso 0.15) — basso = meglio
 *  - Saturazione O2 notturna (peso 0.10) — alto = meglio
 *  - Sleep score (peso 0.15) — qualita' del sonno via computeSleepScore
 *
 *  Se un segnale manca, i pesi degli altri sono rinormalizzati (badge
 *  "parziale"). Se mancano tutti torna null.
 */

export interface RecoveryComponent {
  key: "hrv" | "rhr" | "rr" | "spo2" | "sleep"
  label: string
  value: string
  baseline: string
  zOrPct: string
  contrib: number   // 0..1
}

export interface RecoveryScoreResult {
  score: number
  label: string
  color: string
  components: RecoveryComponent[]
  partial: boolean
}

const WEIGHTS = {
  hrv: 0.35,
  rhr: 0.25,
  rr: 0.15,
  spo2: 0.10,
  sleep: 0.15,
} as const

function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length }
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}
function normFromZ(z: number): number { return Math.max(0, Math.min(1, 0.5 + z / 4)) }

function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/** Per ogni "giorno di risveglio" D, ritorna i sample nella finestra
 *  notturna [D-1 22:00, D 10:00) ora locale. Media i valori dentro la
 *  finestra. Restituisce mappa `YYYY-MM-DD` -> avg. */
function nightlyAverage(samples: Sample[]): Map<string, number> {
  const buckets = new Map<string, number[]>()
  for (const s of samples) {
    const d = new Date(s.start_date)
    const h = d.getHours()
    // Se il sample e' fra le 22:00 e le 23:59, appartiene alla notte di domani
    // Se e' fra le 00:00 e le 09:59, appartiene alla notte di oggi
    // Altrimenti (10:00-21:59): sample diurno, ignorato
    let nightDay: Date | null = null
    if (h >= 22) {
      nightDay = new Date(d)
      nightDay.setDate(nightDay.getDate() + 1)
    } else if (h < 10) {
      nightDay = new Date(d)
    }
    if (!nightDay) continue
    const key = localISODate(nightDay)
    const arr = buckets.get(key)
    if (arr) arr.push(s.value); else buckets.set(key, [s.value])
  }
  const out = new Map<string, number>()
  for (const [k, v] of buckets) out.set(k, mean(v))
  return out
}

interface ComponentInput {
  key: RecoveryComponent["key"]
  label: string
  weight: number
  /** true se valori bassi sono "meglio" (es. RHR, RR). */
  lowerIsBetter: boolean
  /** Unita' per il formatting. */
  unit: string
  /** Cifre decimali da mostrare. */
  digits: number
  daily: Map<string, number>
}

function computeComponent(
  inp: ComponentInput,
  today: string,
  baselineDays: string[],
): { contrib: number; weight: number; comp: RecoveryComponent } | null {
  const todayVal = inp.daily.get(today)
  const base = baselineDays.map(d => inp.daily.get(d)).filter((v): v is number => v != null)
  if (todayVal == null || base.length < 7) return null
  const b = mean(base)
  const s = stdev(base) || 1
  const rawZ = (todayVal - b) / s
  const z = inp.lowerIsBetter ? -rawZ : rawZ
  const sub = normFromZ(z)
  const deltaPct = ((todayVal - b) / b) * 100
  return {
    contrib: sub,
    weight: inp.weight,
    comp: {
      key: inp.key,
      label: inp.label,
      value: `${todayVal.toFixed(inp.digits)} ${inp.unit}`.trim(),
      baseline: `${b.toFixed(inp.digits)} ${inp.unit}`.trim(),
      zOrPct: `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(0)}%`,
      contrib: sub,
    },
  }
}

export function computeRecoveryScore(
  today: string,
  hrvSamples: Sample[],
  rhrSamples: Sample[],
  rrSamples: Sample[],
  spo2Samples: Sample[],
  sleepScoreToday: number | null,
  sleepBaseline: number[] = [],
): RecoveryScoreResult | null {
  const todayDate = new Date(`${today}T12:00:00`)
  const baselineDays: string[] = []
  for (let k = 1; k <= 30; k++) {
    const d = new Date(todayDate)
    d.setDate(d.getDate() - k)
    baselineDays.push(localISODate(d))
  }

  const components: RecoveryComponent[] = []
  let totalWeight = 0
  let weighted = 0

  const inputs: ComponentInput[] = [
    { key: "hrv", label: "HRV (SDNN) notturna", weight: WEIGHTS.hrv,  lowerIsBetter: false, unit: "ms",     digits: 1, daily: nightlyAverage(hrvSamples) },
    { key: "rhr", label: "FC a riposo",         weight: WEIGHTS.rhr,  lowerIsBetter: true,  unit: "bpm",    digits: 1, daily: nightlyAverage(rhrSamples) },
    { key: "rr",  label: "Frequenza respiratoria notturna", weight: WEIGHTS.rr,   lowerIsBetter: true, unit: "/min", digits: 1, daily: nightlyAverage(rrSamples) },
    { key: "spo2",label: "Saturazione O2 notturna", weight: WEIGHTS.spo2, lowerIsBetter: false, unit: "%",   digits: 1, daily: nightlyAverage(spo2Samples) },
  ]

  for (const inp of inputs) {
    const r = computeComponent(inp, today, baselineDays)
    if (!r) continue
    weighted += r.contrib * r.weight
    totalWeight += r.weight
    components.push(r.comp)
  }

  // Sleep e' gia' 0-100; z-score relativo se ho baseline >= 7 notti,
  // altrimenti fallback assoluto (40 = pessimo, 100 = perfetto).
  if (sleepScoreToday != null) {
    let sub: number, baselineStr: string, deltaStr: string
    if (sleepBaseline.length >= 7) {
      const b = mean(sleepBaseline)
      const s = stdev(sleepBaseline) || 1
      sub = normFromZ((sleepScoreToday - b) / s)
      baselineStr = `${b.toFixed(0)}/100`
      const delta = sleepScoreToday - b
      deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}`
    } else {
      sub = Math.max(0, Math.min(1, (sleepScoreToday - 40) / 60))
      baselineStr = "n/d"
      deltaStr = ""
    }
    weighted += sub * WEIGHTS.sleep
    totalWeight += WEIGHTS.sleep
    components.push({
      key: "sleep",
      label: "Sonno",
      value: `${sleepScoreToday}/100`,
      baseline: baselineStr,
      zOrPct: deltaStr,
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
