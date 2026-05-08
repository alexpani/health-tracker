import type { HealthNoteCategory } from "./types"

export const CATEGORY_LABELS: Record<HealthNoteCategory, string> = {
  pain: "Dolore",
  illness: "Malattia",
  discomfort: "Fastidio",
  symptom: "Sintomo",
  other: "Altro",
}

/** Colori usati per i pallini del calendario, i chip e i bordi delle note. */
export const CATEGORY_COLORS: Record<HealthNoteCategory, { bg: string; text: string; dot: string }> = {
  pain:       { bg: "bg-rose-500/15",   text: "text-rose-700 dark:text-rose-400",     dot: "bg-rose-500" },
  illness:    { bg: "bg-amber-500/15",  text: "text-amber-700 dark:text-amber-400",   dot: "bg-amber-500" },
  discomfort: { bg: "bg-blue-500/15",   text: "text-blue-700 dark:text-blue-400",     dot: "bg-blue-500" },
  symptom:    { bg: "bg-violet-500/15", text: "text-violet-700 dark:text-violet-400", dot: "bg-violet-500" },
  other:      { bg: "bg-slate-500/15",  text: "text-slate-700 dark:text-slate-400",   dot: "bg-slate-500" },
}

export const CATEGORY_ORDER: HealthNoteCategory[] = ["pain", "illness", "discomfort", "symptom", "other"]

/** Suggerimenti di zona corporea (italiano). L'utente puo' anche scrivere libero. */
export const BODY_ZONES_PRESET: string[] = [
  "Testa",
  "Cervicale/collo",
  "Spalla dx",
  "Spalla sx",
  "Gomito dx",
  "Gomito sx",
  "Polso/mano",
  "Schiena/lombare",
  "Petto",
  "Addome",
  "Anca",
  "Ginocchio dx",
  "Ginocchio sx",
  "Caviglia/piede dx",
  "Caviglia/piede sx",
  "Generale",
]
