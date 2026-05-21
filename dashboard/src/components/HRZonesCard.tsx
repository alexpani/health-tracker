import { useMemo, useState } from "react"
import { Pencil, RotateCcw, Check, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Sample } from "@/lib/types"
import {
  computeMaxHR,
  computeZoneDurations,
  formatHHMMSS,
  readBodyCalculatorAge,
  readHRZonesOverride,
  readUserBirthdateAge,
  writeHRZonesOverride,
  zoneRangesFromMax,
} from "@/lib/hrZones"

interface Props {
  samples: Sample[]
  workoutEnd?: string
}

export function HRZonesCard({ samples, workoutEnd }: Props) {
  const [override, setOverride] = useState<number | null>(() => readHRZonesOverride())
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string>("")
  const age = useMemo(() => readUserBirthdateAge() ?? readBodyCalculatorAge(), [])

  const max = useMemo(() => computeMaxHR({ override, age }), [override, age])
  const ranges = useMemo(() => zoneRangesFromMax(max.value), [max.value])
  const durations = useMemo(
    () => computeZoneDurations(samples, ranges, workoutEnd),
    [samples, ranges, workoutEnd],
  )

  const maxSeconds = Math.max(1, ...durations.map(d => d.seconds))

  const startEdit = () => {
    setDraft(String(max.value))
    setEditing(true)
  }
  const save = () => {
    const v = parseInt(draft, 10)
    if (Number.isFinite(v) && v > 50 && v < 250) {
      writeHRZonesOverride(v)
      setOverride(v)
    }
    setEditing(false)
  }
  const reset = () => {
    writeHRZonesOverride(null)
    setOverride(null)
    setEditing(false)
  }

  const sourceText =
    max.source === "override"
      ? `FC max ${max.value} bpm (manuale)`
      : `FC max ${max.value} bpm (Tanaka${age ? `, ${age} a` : ""})`

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Zone di freq. cardiaca</CardTitle>
        <div className="flex items-center gap-2">
          {editing ? (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                className="h-8 w-20"
                min={50}
                max={250}
                onKeyDown={e => {
                  if (e.key === "Enter") save()
                  if (e.key === "Escape") setEditing(false)
                }}
                autoFocus
              />
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={save} aria-label="Salva">
                <Check className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditing(false)} aria-label="Annulla">
                <X className="h-4 w-4" />
              </Button>
              {override != null && (
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={reset} aria-label="Reset">
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
            </div>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">{sourceText}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={startEdit} aria-label="Modifica FC max">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {ranges.map(r => {
            const dur = durations.find(d => d.idx === r.idx)?.seconds ?? 0
            const widthPct = (dur / maxSeconds) * 100
            const zero = dur === 0
            const highLabel = r.idx === 5 ? `${r.high} bpm` : `${r.high} bpm`
            return (
              <div
                key={r.idx}
                className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2"
              >
                <span className={`w-4 text-sm tabular-nums ${zero ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
                  {r.idx}
                </span>
                <div className="flex flex-1 items-center gap-3 min-w-0">
                  <div className="relative h-3 flex-shrink-0" style={{ width: `${Math.max(8, widthPct)}%`, maxWidth: "55%" }}>
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{
                        backgroundColor: zero ? "transparent" : r.color,
                        opacity: zero ? 0.15 : 1,
                        border: zero ? `1px dashed ${r.color}` : undefined,
                      }}
                    />
                  </div>
                  <span className={`text-sm tabular-nums ${zero ? "text-muted-foreground/60" : "font-medium"}`}>
                    {formatHHMMSS(dur)}
                  </span>
                </div>
                <span className={`text-sm tabular-nums whitespace-nowrap ${zero ? "text-muted-foreground/60" : "text-muted-foreground"}`}>
                  {r.low} – {highLabel}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
