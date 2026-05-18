import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { useWorkoutFacets } from "@/lib/queries"
import { effectiveTypeLabel } from "@/lib/healthkit"
import type { WorkoutFilters } from "@/lib/types"

interface Props {
  value: WorkoutFilters
  onChange: (v: WorkoutFilters) => void
  onClose?: () => void
}

const PACE_MIN_SEC = 180   // 3:00 /km
const PACE_MAX_SEC = 900   // 15:00 /km
const PACE_STEP = 10

function formatPace(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

const PACE_PRESETS: { label: string; min?: number; max?: number }[] = [
  { label: "< 4:30", max: 270 },
  { label: "4:30 - 5:30", min: 270, max: 330 },
  { label: "5:30 - 6:30", min: 330, max: 390 },
  { label: "6:30 - 7:30", min: 390, max: 450 },
  { label: "> 7:30", min: 450 },
]

// Distance presets in meters
const DISTANCE_PRESETS: { label: string; min?: number; max?: number }[] = [
  { label: "< 5 km", max: 5000 },
  { label: "5 - 10 km", min: 5000, max: 10000 },
  { label: "10 - 21 km", min: 10000, max: 21097 },
  { label: "Mezza (21+ km)", min: 21097, max: 30000 },
  { label: "Maratona (30+ km)", min: 30000 },
]

// Duration presets in seconds
const DURATION_PRESETS: { label: string; min?: number; max?: number }[] = [
  { label: "< 30 min", max: 1800 },
  { label: "30 - 60 min", min: 1800, max: 3600 },
  { label: "1 - 2 h", min: 3600, max: 7200 },
  { label: "> 2 h", min: 7200 },
]

export function WorkoutFiltersSidebar({ value, onChange, onClose }: Props) {
  const { data: facets } = useWorkoutFacets(value)

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
    value.title_contains,
    value.notes_contains,
  ].filter(Boolean).length

  return (
    <div className="space-y-5 p-4 pb-24 h-full overflow-y-auto">
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

      {/* Periodo (precise datetime range + preset chips) */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">Periodo</Label>
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
        <div className="flex flex-wrap gap-1">
          {([
            { label: "1g", days: 1 },
            { label: "2g", days: 2 },
            { label: "7g", days: 7 },
            { label: "14g", days: 14 },
            { label: "1m", days: 30 },
            { label: "3m", days: 90 },
            { label: "6m", days: 180 },
            { label: "12m", days: 365 },
          ] as const).map(p => (
            <button
              key={p.label}
              type="button"
              className="text-xs px-2 py-1 rounded border bg-secondary hover:bg-accent"
              onClick={() => {
                const end = new Date()
                const start = new Date()
                start.setDate(start.getDate() - p.days)
                onChange({
                  ...value,
                  start: start.toISOString(),
                  end: end.toISOString(),
                })
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border bg-secondary hover:bg-accent"
            onClick={() => onChange({ ...value, start: undefined, end: undefined })}
          >
            ✕
          </button>
        </div>
      </section>

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
                  onClick={() => {
                    const nextYears = toggleList(value.years, y.year)
                    // Sincronizza Periodo: span dal 1 gen del min anno al 31 dic
                    // del max anno (locale, poi ISO). Nessun anno = clear range.
                    let start: string | undefined = value.start
                    let end: string | undefined = value.end
                    if (nextYears.length === 0) {
                      start = undefined
                      end = undefined
                    } else {
                      const min = Math.min(...nextYears)
                      const max = Math.max(...nextYears)
                      start = new Date(min, 0, 1, 0, 0, 0).toISOString()
                      end = new Date(max, 11, 31, 23, 59, 59, 999).toISOString()
                    }
                    onChange({ ...value, years: nextYears, start, end })
                  }}
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

      {/* Title search */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">Ricerca nel titolo</Label>
        <Input
          placeholder="es. Livello 2, Tapis..."
          value={value.title_contains ?? ""}
          onChange={e => set("title_contains", e.target.value || undefined)}
        />
      </section>

      {/* Notes search */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">Ricerca nelle note</Label>
        <Input
          placeholder="es. ritmo, serie, soglia..."
          value={value.notes_contains ?? ""}
          onChange={e => set("notes_contains", e.target.value || undefined)}
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
        <div className="flex flex-wrap gap-1">
          {DISTANCE_PRESETS.map(p => {
            const active = value.distance_min === p.min && value.distance_max === p.max
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange({ ...value, distance_min: p.min, distance_max: p.max })}
                className={`text-xs px-2 py-1 rounded-md border ${
                  active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                }`}
              >
                {p.label}
              </button>
            )
          })}
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
        <div className="flex flex-wrap gap-1">
          {DURATION_PRESETS.map(p => {
            const active = value.duration_min === p.min && value.duration_max === p.max
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange({ ...value, duration_min: p.min, duration_max: p.max })}
                className={`text-xs px-2 py-1 rounded-md border ${
                  active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Pace */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Ritmo</Label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatPace(value.pace_min ?? PACE_MIN_SEC)} - {formatPace(value.pace_max ?? PACE_MAX_SEC)} /km
          </span>
        </div>
        <Slider
          min={PACE_MIN_SEC}
          max={PACE_MAX_SEC}
          step={PACE_STEP}
          value={[value.pace_min ?? PACE_MIN_SEC, value.pace_max ?? PACE_MAX_SEC]}
          onValueChange={(vals) => {
            const [lo, hi] = vals
            onChange({
              ...value,
              pace_min: lo === PACE_MIN_SEC ? undefined : lo,
              pace_max: hi === PACE_MAX_SEC ? undefined : hi,
            })
          }}
        />
        <div className="flex flex-wrap gap-1">
          {PACE_PRESETS.map(p => {
            const active = value.pace_min === p.min && value.pace_max === p.max
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange({ ...value, pace_min: p.min, pace_max: p.max })}
                className={`text-xs px-2 py-1 rounded-md border ${
                  active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Applica solo ai workout con distanza.
        </p>
      </section>
    </div>
  )
}
