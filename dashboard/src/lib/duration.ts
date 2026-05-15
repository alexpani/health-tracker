/**
 * Formattazione "smart" della durata di un regime/periodo.
 *
 * Spezza la differenza fra due date in anni/mesi/giorni con math
 * calendar-based (non approssimativo con 365.25 / 30.44, che porta a
 * errori visibili su anni multipli) — ogni borrow tiene conto dei giorni
 * realmente presenti nel mese.
 *
 * Esempio: 2024-01-01 → 2025-03-04 = 428 giorni totali
 *   → "1 anno, 2 mesi e 3 giorni"
 *
 * Convenzione: `end` ESCLUSIVO. Una fascia 2024-01-01 → 2024-01-01 = 0
 * giorni ("stesso giorno"); 2024-01-01 → 2024-01-02 = 1 giorno.
 */

interface YMD {
  y: number
  m: number
  d: number
  totalDays: number
}

/**
 * Aggiunge `n` mesi a una data, clampando il giorno se il mese di
 * destinazione e' piu' corto (es. 31 jan + 1 mese → 28/29 feb).
 */
function addMonths(d: Date, n: number): Date {
  const totalMonths = d.getMonth() + n
  const newYear = d.getFullYear() + Math.floor(totalMonths / 12)
  const monthIdx = ((totalMonths % 12) + 12) % 12
  const lastDayOfTargetMonth = new Date(newYear, monthIdx + 1, 0).getDate()
  return new Date(newYear, monthIdx, Math.min(d.getDate(), lastDayOfTargetMonth))
}

function ymdDiff(start: Date, end: Date): YMD {
  // Normalizza a "giorno" (azzera ore/minuti) per evitare drift su DST.
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  const totalDays = Math.max(
    0,
    Math.floor((e.getTime() - s.getTime()) / 86_400_000),
  )

  // Approccio anchor-based: aggiungi N mesi a start finche' anchor <= end.
  // Il giorno residuo e' end - anchor. Evita il caso edge del "doppio
  // borrow" (es. 31 gen → 1 mar, dove il differenziale giorni e' -30 ma
  // febbraio ha solo 28/29 giorni e il borrow naive lascia d negativo).
  let months =
    (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth())
  let anchor = addMonths(s, months)
  if (anchor.getTime() > e.getTime()) {
    months -= 1
    anchor = addMonths(s, months)
  }
  const d = Math.floor((e.getTime() - anchor.getTime()) / 86_400_000)
  const y = Math.trunc(months / 12)
  const m = months - y * 12

  return { y, m, d, totalDays }
}

function plural(n: number, sing: string, plur: string): string {
  return `${n} ${n === 1 ? sing : plur}`
}

function joinIT(parts: string[]): string {
  if (parts.length === 0) return ""
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return parts.join(" e ")
  return parts.slice(0, -1).join(", ") + " e " + parts[parts.length - 1]
}

/**
 * Formatta la durata fra due date come stringa "smart".
 *
 * - `start` null/undefined → null (nessuna data di partenza nota, non
 *   abbiamo modo di calcolare la durata).
 * - `end` null/undefined → "in corso da today": usa Date.now() come fine.
 *   Anche il caller riceve la stringa pronta da prefissare con "Da"
 *   se vuole.
 * - Durate sotto il mese: solo "N giorni" (senza "pari a ...").
 * - Durate ≥ 1 mese: "N giorni pari a Y anni, M mesi e D giorni"
 *   (componenti zero omesse, plurali italiani corretti).
 */
export function formatPeriodDuration(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string | null {
  if (!start) return null
  const s = start instanceof Date ? start : new Date(start)
  if (isNaN(s.getTime())) return null

  const eRaw = end ? (end instanceof Date ? end : new Date(end)) : new Date()
  if (isNaN(eRaw.getTime())) return null

  const { y, m, d, totalDays } = ymdDiff(s, eRaw)

  if (totalDays === 0) return "stesso giorno"

  const parts: string[] = []
  if (y > 0) parts.push(plural(y, "anno", "anni"))
  if (m > 0) parts.push(plural(m, "mese", "mesi"))
  if (d > 0) parts.push(plural(d, "giorno", "giorni"))

  const smart = joinIT(parts)
  // Sotto il mese → output diretto in giorni (senza "pari a")
  if (y === 0 && m === 0) return smart
  // Altrimenti totale giorni + decomposizione
  return `${totalDays} giorni pari a ${smart}`
}
