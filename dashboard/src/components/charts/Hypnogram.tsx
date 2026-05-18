import { useMemo } from "react"
import { useCategories } from "@/lib/queries"
import { SLEEP_STAGES } from "@/lib/healthkit"

interface Props {
  /** YYYY-MM-DD del giorno di risveglio. La finestra coperta va dalle
   *  16:00 del giorno prima alle 16:00 di questo giorno (gestisce
   *  bedtime anticipati e sveglie tardive). */
  date: string
  height?: number
}

const STAGE_LABEL: Record<number, string> = {
  0: SLEEP_STAGES[0].label,
  1: SLEEP_STAGES[1].label,
  2: SLEEP_STAGES[2].label,
  3: SLEEP_STAGES[3].label,
  4: SLEEP_STAGES[4].label,
  5: SLEEP_STAGES[5].label,
}

/** Ipnogramma: timeline orizzontale colorata per fase del sonno.
 *  Filtra fuori i wrapper (stage 0 in_bed e 1 asleep_unspecified) che
 *  double-conterebbero rispetto a Core/Deep/REM/Veglia. */
export function Hypnogram({ date, height = 60 }: Props) {
  const window = useMemo(() => {
    const [y, m, d] = date.split("-").map(Number)
    const end = new Date(y, m - 1, d, 16, 0, 0)
    const start = new Date(end)
    start.setDate(end.getDate() - 1)
    return { startIso: start.toISOString(), endIso: end.toISOString() }
  }, [date])

  const q = useCategories(
    "HKCategoryTypeIdentifierSleepAnalysis",
    window.startIso,
    window.endIso,
  )
  const samples = q.data ?? []

  const filtered = useMemo(
    () => samples.filter(s => s.value >= 2 && s.value <= 5),
    [samples],
  )

  if (filtered.length === 0) return null

  // Finestra effettiva: min start / max end dei sample, con un piccolo
  // padding per non incollare i bordi.
  const tMin = Math.min(...filtered.map(s => new Date(s.start_date).getTime()))
  const tMax = Math.max(...filtered.map(s => new Date(s.end_date).getTime()))
  const span = tMax - tMin
  if (span <= 0) return null

  // Tick orari ogni 2h all'interno della finestra.
  const ticks: { x: number; label: string }[] = []
  const startHour = new Date(tMin)
  startHour.setMinutes(0, 0, 0)
  startHour.setHours(startHour.getHours() + 1)
  for (let t = startHour.getTime(); t <= tMax; t += 2 * 3600_000) {
    const x = ((t - tMin) / span) * 100
    const d = new Date(t)
    ticks.push({ x, label: `${String(d.getHours()).padStart(2, "0")}:00` })
  }

  // Legenda: solo le fasi effettivamente presenti.
  const presentStages = Array.from(new Set(filtered.map(s => s.value))).sort()

  return (
    <div className="mt-3 pt-3 border-t">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Andamento notte
        </p>
        <div className="flex flex-wrap gap-2">
          {presentStages.map(v => (
            <span key={v} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ background: SLEEP_STAGES[v].color }}
              />
              {STAGE_LABEL[v]}
            </span>
          ))}
        </div>
      </div>
      <div className="relative w-full" style={{ height }}>
        <svg
          width="100%"
          height={height}
          preserveAspectRatio="none"
          viewBox={`0 0 100 ${height}`}
        >
          {filtered.map((s, i) => {
            const x = ((new Date(s.start_date).getTime() - tMin) / span) * 100
            const w = ((new Date(s.end_date).getTime() - new Date(s.start_date).getTime()) / span) * 100
            const color = SLEEP_STAGES[s.value]?.color ?? "#94a3b8"
            const startTxt = new Date(s.start_date).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
            const endTxt = new Date(s.end_date).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
            const dur = Math.round((new Date(s.end_date).getTime() - new Date(s.start_date).getTime()) / 60_000)
            return (
              <rect
                key={`${s.uuid}-${i}`}
                x={x}
                y={4}
                width={Math.max(w, 0.1)}
                height={height - 18}
                fill={color}
              >
                <title>{`${STAGE_LABEL[s.value]} · ${startTxt} → ${endTxt} · ${dur} min`}</title>
              </rect>
            )
          })}
          {ticks.map((t, i) => (
            <line
              key={`tick-${i}`}
              x1={t.x}
              x2={t.x}
              y1={4}
              y2={height - 14}
              stroke="hsl(var(--border))"
              strokeWidth={0.2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        <div className="relative w-full" style={{ height: 12 }}>
          {ticks.map((t, i) => (
            <span
              key={`lbl-${i}`}
              className="absolute text-[9px] text-muted-foreground tabular-nums -translate-x-1/2"
              style={{ left: `${t.x}%`, top: 0 }}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
