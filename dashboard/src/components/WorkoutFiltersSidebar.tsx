import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWorkoutFacets } from "@/lib/queries"
import { effectiveTypeLabel } from "@/lib/healthkit"
import type { WorkoutFilters } from "@/lib/types"

interface Props {
  value: WorkoutFilters
  onChange: (v: WorkoutFilters) => void
  onClose?: () => void
}

function paceSecToInput(sec?: number): string {
  if (sec === undefined || sec === null || !isFinite(sec)) return ""
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}
function paceInputToSec(v: string): number | undefined {
  if (!v.trim()) return undefined
  const parts = v.split(":")
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10)
    const s = parseInt(parts[1], 10)
    if (!isNaN(m) && !isNaN(s)) return m * 60 + s
  }
  const n = parseFloat(v)
  return isNaN(n) ? undefined : n
}

export function WorkoutFiltersSidebar({ value, onChange, onClose }: Props) {
  const { data: facets } = useWorkoutFacets()

  const set = <K extends keyof WorkoutFilters>(k: K, v: WorkoutFilters[K]) =>
    onChange({ ...value, [k]: v })

  const toggleList = <T extends string | number>(list: T[] | undefined, item: T): T[] => {
    const arr = list ?? []
    return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]
  }

  const clear = () => onChange({})

  const activeCount = [
    value.start, value.end, value.years?.length, value.effective_types?.length,
    value.sources?.length,
    value.distance_min !== undefined ? 1 : undefined,
    value.distance_max !== undefined ? 1 : undefined,
    value.duration_min !== undefined ? 1 : undefined,
    value.duration_max !== undefined ? 1 : undefined,
    value.pace_min !== undefined ? 1 : undefined,
    value.pace_max !== undefined ? 1 : undefined,
  ].filter(Boolean).length

  return (
    <div className="space-y-5 p-4 h-full overflow-y-auto">
      <div className="flex items-center justify-between pb-3 border-b">
        <h3 className="font-semibold">Filtri {activeCount > 0 && <span className="text-xs text-muted-foreground">({activeCount})</span>}</h3>
        <div className="flex gap-1">
          {activeCount > 0 && (
            <Button size="sm" variant="ghost" onClick={clear}>Pulisci</Button>
          )}
          {onClose && (
            <Button size="icon" variant="ghost" className="h-7 w-7 md:hidden" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Years */}
      {facets?.years && facets.years.length > 0 && (
        <section className="space-y-2">
          <Label className="text-xs font-medium">Anno</Label>
          <div className="flex flex-wrap gap-1">
            {facets.years.map(y => {
              const sel = value.years?.includes(y.year) ?? false
              return (
                <button
                  key={y.year}
                  type="button"
                  onClick={() => set("years", toggleList(value.years, y.year))}
                  className={`text-xs px-2 py-1 rounded-md border ${
                    sel ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                  }`}
                >
                  {y.year} <span className="opacity-60">({y.count})</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Activity (effective types) */}
      {facets?.effective_types && facets.effective_types.length > 0 && (
        <section className="space-y-2">
          <Label className="text-xs font-medium">Attivita</Label>
          <div className="flex flex-wrap gap-1">
            {facets.effective_types.map(t => {
              const sel = value.effective_types?.includes(t.slug) ?? false
              return (
                <button
                  key={t.slug}
                  type="button"
                  onClick={() => set("effective_types", toggleList(value.effective_types, t.slug))}
                  className={`text-xs px-2 py-1 rounded-md border ${
                    sel ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                  }`}
                >
                  {effectiveTypeLabel(t.slug, t.activity_type)} <span className="opacity-60">({t.count})</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Sources */}
      {facets?.sources && facets.sources.length > 0 && (
        <section className="space-y-2">
          <Label className="text-xs font-medium">Sorgente</Label>
          <div className="flex flex-wrap gap-1">
            {facets.sources.map(s => {
              const sel = value.sources?.includes(s) ?? false
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => set("sources", toggleList(value.sources, s))}
                  className={`text-xs px-2 py-1 rounded-md border ${
                    sel ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                  }`}
                >
                  {s}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Period precise */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">Periodo preciso</Label>
        <Input
          type="datetime-local"
          value={value.start ? value.start.slice(0, 16) : ""}
          onChange={e => set("start", e.target.value ? new Date(e.target.value).toISOString() : undefined)}
          placeholder="Da"
        />
        <Input
          type="datetime-local"
          value={value.end ? value.end.slice(0, 16) : ""}
          onChange={e => set("end", e.target.value ? new Date(e.target.value).toISOString() : undefined)}
          placeholder="A"
        />
      </section>

      {/* Distance */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">
          Distanza (km)
          {facets?.distance_max != null && (
            <span className="text-muted-foreground font-normal ml-1">
              DB: 0 - {(facets.distance_max / 1000).toFixed(1)}
            </span>
          )}
        </Label>
        <div className="flex gap-2">
          <Input
            type="number" step="any" placeholder="min"
            value={value.distance_min !== undefined ? value.distance_min / 1000 : ""}
            onChange={e => set("distance_min", e.target.value ? parseFloat(e.target.value) * 1000 : undefined)}
          />
          <Input
            type="number" step="any" placeholder="max"
            value={value.distance_max !== undefined ? value.distance_max / 1000 : ""}
            onChange={e => set("distance_max", e.target.value ? parseFloat(e.target.value) * 1000 : undefined)}
          />
        </div>
      </section>

      {/* Duration */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">
          Durata (minuti)
          {facets?.duration_max != null && (
            <span className="text-muted-foreground font-normal ml-1">
              DB: 0 - {Math.round(facets.duration_max / 60)}
            </span>
          )}
        </Label>
        <div className="flex gap-2">
          <Input
            type="number" step="1" placeholder="min"
            value={value.duration_min !== undefined ? Math.round(value.duration_min / 60) : ""}
            onChange={e => set("duration_min", e.target.value ? parseFloat(e.target.value) * 60 : undefined)}
          />
          <Input
            type="number" step="1" placeholder="max"
            value={value.duration_max !== undefined ? Math.round(value.duration_max / 60) : ""}
            onChange={e => set("duration_max", e.target.value ? parseFloat(e.target.value) * 60 : undefined)}
          />
        </div>
      </section>

      {/* Pace */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">Ritmo (m:ss/km)</Label>
        <div className="flex gap-2">
          <Input
            type="text" placeholder="piu' veloce di"
            value={paceSecToInput(value.pace_min)}
            onChange={e => set("pace_min", paceInputToSec(e.target.value))}
          />
          <Input
            type="text" placeholder="piu' lento di"
            value={paceSecToInput(value.pace_max)}
            onChange={e => set("pace_max", paceInputToSec(e.target.value))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Es. 5:30 = 5 min 30 sec/km. Applica solo ai workout con distanza.
        </p>
      </section>
    </div>
  )
}
