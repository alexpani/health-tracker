import type { CategorySample } from "@/lib/types"

/** Risultato della valutazione qualitativa di una notte di sonno.
 *
 *  Criteri pubblicati:
 *  - National Sleep Foundation – "Sleep Quality Recommendations"
 *    (Ohayon M. et al., Sleep Health 2017;3:6-19)
 *  - NSF "Sleep Duration Recommendations"
 *    (Hirshkowitz M. et al., Sleep Health 2015)
 *  - AASM Manual for the Scoring of Sleep (Iber et al., 2007 e succ.) per
 *    le percentuali tipiche di Profondo/REM/Principale negli adulti.
 */
export interface SleepScoreComponent {
  key: string
  label: string
  value: string
  target: string
  score: number       // 0..20
  hint: string        // sorgente o spiegazione
}

export interface SleepScoreResult {
  score: number       // 0..100 arrotondato
  label: string       // Eccellente / Buono / Discreto / Scarso
  color: string       // tailwind text class
  components: SleepScoreComponent[]
}

const CITATION_NSF_QUAL = "NSF Ohayon 2017"
const CITATION_NSF_DUR = "NSF Hirshkowitz 2015"
const CITATION_AASM = "AASM Manual 2007"

/** Interpolazione triangolare: pieno se v in [full_lo, full_hi], scende
 *  linearmente a 0 ai bordi (zero_lo / zero_hi). */
function triScore(v: number, fullLo: number, fullHi: number, zeroLo: number, zeroHi: number): number {
  if (v >= fullLo && v <= fullHi) return 20
  if (v <= zeroLo || v >= zeroHi) return 0
  if (v < fullLo) return Math.round(((v - zeroLo) / (fullLo - zeroLo)) * 20)
  return Math.round((1 - (v - fullHi) / (zeroHi - fullHi)) * 20)
}

/** Score "monotono" alto-è-meglio fra zero (≥zeroAt) e pieno (≤fullAt).
 *  Usato per efficienza (più alta → meglio). */
function monoUpScore(v: number, fullAt: number, zeroAt: number): number {
  if (v >= fullAt) return 20
  if (v <= zeroAt) return 0
  return Math.round(((v - zeroAt) / (fullAt - zeroAt)) * 20)
}

/** Score "monotono" basso-è-meglio fra zero (≥zeroAt) e pieno (≤fullAt).
 *  Usato per numero risvegli. */
function monoDownScore(v: number, fullAt: number, zeroAt: number): number {
  if (v <= fullAt) return 20
  if (v >= zeroAt) return 0
  return Math.round((1 - (v - fullAt) / (zeroAt - fullAt)) * 20)
}

function fmtDur(min: number): string {
  const h = Math.floor(min / 60)
  const mm = Math.round(min % 60)
  return h > 0 ? `${h}h ${mm.toString().padStart(2, "0")}m` : `${mm} min`
}

export function computeSleepScore(samples: CategorySample[]): SleepScoreResult | null {
  // Filtro: solo fasi dettagliate (esclude wrapper 0 in_bed e 1
  // asleep_unspecified, che double-conterebbero su Apple e non danno
  // dettaglio se da sorgenti terze).
  const real = samples.filter(s => s.value >= 2 && s.value <= 5)
  if (real.length === 0) return null

  let coreMin = 0, deepMin = 0, remMin = 0, awakeMin = 0
  for (const s of real) {
    const dur = (new Date(s.end_date).getTime() - new Date(s.start_date).getTime()) / 60_000
    if (dur <= 0) continue
    if (s.value === 2) awakeMin += dur
    else if (s.value === 3) coreMin += dur
    else if (s.value === 4) deepMin += dur
    else if (s.value === 5) remMin += dur
  }
  const tst = coreMin + deepMin + remMin
  if (tst < 60) return null

  // TIB: dal primo start all'ultimo end dei sample "reali".
  const tStart = Math.min(...real.map(s => new Date(s.start_date).getTime()))
  const tEnd = Math.max(...real.map(s => new Date(s.end_date).getTime()))
  const tib = Math.max(tst, (tEnd - tStart) / 60_000)
  const efficiency = (tst / tib) * 100

  const deepPct = (deepMin / tst) * 100
  const remPct = (remMin / tst) * 100

  // Risvegli "veri": sample stage=2 con durata > 5 min (NSF Ohayon).
  const awakenings = real.filter(s => {
    if (s.value !== 2) return false
    const dur = (new Date(s.end_date).getTime() - new Date(s.start_date).getTime()) / 60_000
    return dur > 5
  }).length

  const cDurata: SleepScoreComponent = {
    key: "duration",
    label: "Durata",
    value: fmtDur(tst),
    target: "7h-9h",
    score: triScore(tst, 7 * 60, 9 * 60, 5 * 60, 11 * 60),
    hint: CITATION_NSF_DUR,
  }
  const cEff: SleepScoreComponent = {
    key: "efficiency",
    label: "Efficienza",
    value: `${Math.round(efficiency)}%`,
    target: "≥ 85%",
    score: monoUpScore(efficiency, 85, 65),
    hint: CITATION_NSF_QUAL,
  }
  const cDeep: SleepScoreComponent = {
    key: "deep",
    label: "Profondo",
    value: `${Math.round(deepPct)}%`,
    target: "13-23%",
    score: triScore(deepPct, 13, 23, 5, 35),
    hint: CITATION_AASM,
  }
  const cRem: SleepScoreComponent = {
    key: "rem",
    label: "REM",
    value: `${Math.round(remPct)}%`,
    target: "20-25%",
    score: triScore(remPct, 20, 25, 8, 40),
    hint: CITATION_AASM,
  }
  const cWake: SleepScoreComponent = {
    key: "continuity",
    label: "Continuità",
    value: `${awakenings} risveglio${awakenings === 1 ? "" : "i"} >5 min`,
    target: "≤ 1",
    score: monoDownScore(awakenings, 1, 6),
    hint: CITATION_NSF_QUAL,
  }

  // Suppressione tristezza: se awakeMin = 0 e awakenings = 0 ma TST e
  // efficienza ok, lasciamo cWake con 20 — gia' coperto dalla funzione.
  const components = [cDurata, cEff, cDeep, cRem, cWake]
  const total = components.reduce((a, c) => a + c.score, 0)

  let label = "Scarso", color = "text-red-600"
  if (total >= 90) { label = "Eccellente"; color = "text-emerald-600" }
  else if (total >= 75) { label = "Buono"; color = "text-blue-600" }
  else if (total >= 60) { label = "Discreto"; color = "text-amber-600" }

  return { score: total, label, color, components }
}

/** Genera un commento discorsivo in italiano su com'e' andata la notte,
 *  a partire dai componenti gia' calcolati dello score. Mette in evidenza
 *  i punti di forza e le criticita' principali. */
export function sleepNarrative(result: SleepScoreResult): string {
  const get = (k: string) => result.components.find(c => c.key === k)
  const dur = get("duration")
  const eff = get("efficiency")
  const deep = get("deep")
  const rem = get("rem")
  const wake = get("continuity")

  const parts: string[] = []

  const opener: Record<string, string> = {
    Eccellente: "Notte di sonno eccellente.",
    Buono: "Buona notte di sonno.",
    Discreto: "Notte di riposo nella media.",
    Scarso: "Notte poco ristoratrice.",
  }
  parts.push(opener[result.label] ?? "Notte di sonno.")

  if (dur) {
    if (dur.score >= 18) parts.push(`Hai dormito ${dur.value}, una durata ottimale.`)
    else if (dur.score >= 10) parts.push(`Durata di ${dur.value}, un po' fuori dalla fascia ideale di 7-9 ore.`)
    else parts.push(`Durata di sole ${dur.value}: il riposo e' stato troppo breve.`)
  }

  if (eff) {
    if (eff.score >= 18) parts.push(`Sonno molto continuo (efficienza ${eff.value}).`)
    else if (eff.score < 10) parts.push(`Hai passato parecchio tempo sveglio a letto (efficienza ${eff.value}).`)
  }

  if (deep) {
    if (deep.score >= 14) parts.push(`Buona quota di sonno profondo (${deep.value}), utile al recupero fisico.`)
    else if (deep.score < 10) parts.push(`Poco sonno profondo (${deep.value}): il recupero fisico potrebbe risentirne.`)
  }

  if (rem) {
    if (rem.score >= 14) parts.push(`Fase REM nella norma (${rem.value}).`)
    else if (rem.score < 10) parts.push(`Fase REM ridotta (${rem.value}), legata a memoria e umore.`)
  }

  if (wake) {
    if (wake.score >= 18) parts.push("Sonno praticamente ininterrotto.")
    else if (wake.score < 10) parts.push(`Diversi risvegli hanno frammentato la notte (${wake.value}).`)
  }

  return parts.join(" ")
}
