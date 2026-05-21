import { useMemo } from "react"
import { useCategories } from "@/lib/queries"
import { computeSleepScore } from "@/lib/sleepScore"

interface Props {
  /** YYYY-MM-DD del giorno di risveglio (stessa finestra di Hypnogram). */
  date: string
  /** Variante compatta: mostra solo punteggio + label, lista dettagli in
   *  un `<details>` collassabile. */
  compact?: boolean
}

const FOOTNOTE = "Criteri: NSF (Ohayon 2017, Hirshkowitz 2015), AASM Manual 2007."

export function SleepScoreCard({ date, compact = false }: Props) {
  const window = useMemo(() => {
    const [y, m, d] = date.split("-").map(Number)
    const start = new Date(y, m - 1, d - 1, 16, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 1)
    return { startIso: start.toISOString(), endIso: end.toISOString() }
  }, [date])

  const q = useCategories(
    "HKCategoryTypeIdentifierSleepAnalysis",
    window.startIso,
    window.endIso,
  )
  const result = useMemo(() => computeSleepScore(q.data ?? []), [q.data])

  if (q.isLoading) return null
  if (!result) {
    // No score: dati insufficienti — niente regressioni se inserito
    // dentro card di altri componenti.
    if (compact) return null
    return (
      <p className="text-xs text-muted-foreground">
        Dati insufficienti per la valutazione (manca il dettaglio fasi o
        sonno troppo breve).
      </p>
    )
  }

  if (compact) {
    return (
      <details className="mt-2 group">
        <summary className="cursor-pointer flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Valutazione</span>
          <span className="tabular-nums">
            <span className={`font-semibold ${result.color}`}>{result.score}</span>
            <span className="text-muted-foreground">/100 · {result.label}</span>
          </span>
        </summary>
        <div className="mt-2 space-y-1">
          {result.components.map(c => (
            <ScoreRow key={c.key} c={c} />
          ))}
          <p className="text-[10px] text-muted-foreground mt-2" title={FOOTNOTE}>
            {FOOTNOTE}
          </p>
        </div>
      </details>
    )
  }

  return (
    <div className="rounded-lg border bg-card/40 p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm uppercase tracking-wide text-muted-foreground">
          Valutazione
        </p>
        <div className="text-right">
          <span className={`text-3xl font-bold tabular-nums ${result.color}`}>{result.score}</span>
          <span className="text-muted-foreground">/100</span>
          <p className={`text-sm font-medium ${result.color}`}>{result.label}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        {result.components.map(c => (
          <ScoreRow key={c.key} c={c} />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground" title={FOOTNOTE}>
        {FOOTNOTE}
      </p>
    </div>
  )
}

function ScoreRow({ c }: { c: ReturnType<typeof computeSleepScore> extends infer R
  ? R extends { components: infer C } ? C extends Array<infer X> ? X : never : never : never
}) {
  const pct = (c.score / 20) * 100
  let barColor = "bg-red-500"
  if (c.score >= 18) barColor = "bg-emerald-500"
  else if (c.score >= 14) barColor = "bg-blue-500"
  else if (c.score >= 10) barColor = "bg-amber-500"
  return (
    <div className="text-xs">
      <div className="flex justify-between items-baseline">
        <span className="font-medium" title={c.hint}>{c.label}</span>
        <span className="tabular-nums">
          {c.value} <span className="text-muted-foreground">· target {c.target}</span>
          <span className="ml-2 text-muted-foreground">{c.score}/20</span>
        </span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden mt-0.5">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
