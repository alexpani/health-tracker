import type { Workout } from "@/lib/types"

/** Carico settimanale valutato via ACWR (Acute:Chronic Workload Ratio).
 *
 *  Riferimenti:
 *  - Gabbett TJ (2016). "The training-injury prevention paradox", BJSM.
 *  - Hulin BT et al. (2014). "Spikes in acute workload..." BJSM.
 *
 *  Sweet spot 0.8-1.3. Sopra 1.5 = zona di rischio infortuni; sotto 0.5
 *  = detraining. Misura del carico: kcal totali dei workout (proxy del
 *  TRIMP non disponendo di max-HR personale per ogni sport).
 */

import type { FlagStatus } from "@/lib/recoveryScore"

export interface WorkloadStatus {
  status: FlagStatus
  verdict: string  // breve etichetta in italiano
  detail: string
  acwr: number | null
  acuteKcal: number
  chronicKcalWeekly: number
}

function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

export function computeWorkloadStatus(today: string, workouts: Workout[]): WorkloadStatus {
  const todayDate = new Date(`${today}T12:00:00`)

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
  const chronicKcalWeekly = chronicKcal / 4

  if (chronicKcalWeekly < 100) {
    return {
      status: "green",
      verdict: "Carico basso",
      detail: acuteKcal === 0
        ? "Nessun carico recente registrato — sei in piena freschezza."
        : `Carico cronico minimo (${Math.round(chronicKcalWeekly)} kcal/sett media 28g) — niente rischio sovraccarico.`,
      acwr: null,
      acuteKcal,
      chronicKcalWeekly,
    }
  }

  const acwr = acuteKcal / chronicKcalWeekly
  let status: FlagStatus, verdict: string, detail: string
  if (acwr > 1.5)        { status = "red";   verdict = "Sovraccarico"; detail = `ACWR ${acwr.toFixed(2)} (>1.5 = zona di rischio infortuni, Gabbett 2016)` }
  else if (acwr > 1.3)   { status = "amber"; verdict = "Sopra la norma"; detail = `ACWR ${acwr.toFixed(2)} (sopra il sweet spot 0.8-1.3)` }
  else if (acwr >= 0.8)  { status = "green"; verdict = "Ottimale";    detail = `ACWR ${acwr.toFixed(2)} dentro il sweet spot 0.8-1.3` }
  else if (acwr >= 0.5)  { status = "amber"; verdict = "Sotto la norma"; detail = `ACWR ${acwr.toFixed(2)} sotto il sweet spot — leggero detraining` }
  else                   { status = "red";   verdict = "Detraining";  detail = `ACWR ${acwr.toFixed(2)} (<0.5 = carico insufficiente per mantenere la forma)` }

  return { status, verdict, detail, acwr, acuteKcal, chronicKcalWeekly }
}
