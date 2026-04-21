import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CATEGORIES, getMeta } from "@/lib/healthkit"
import type { Aggregation, BodyFilters } from "@/lib/types"

interface Props {
  value: BodyFilters
  onChange: (v: BodyFilters) => void
  availableSources: string[]
  availableYears: number[]
  onClose?: () => void
}

const BODY_TYPES = CATEGORIES.body.types
const DEFAULT_TYPE = "HKQuantityTypeIdentifierBodyMass"

export function makeDefaultBodyFilters(): BodyFilters {
  const end = new Date()
  const start = new Date(end.getTime() - 365 * 86400_000)
  return {
    aggregation: "daily",
    types: [DEFAULT_TYPE],
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

function isoToDateInput(iso: string | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function dateInputToIso(val: string, isEnd: boolean): string | undefined {
  if (!val) return undefined
  const [y, m, d] = val.split("-").map(Number)
  const date = new Date(y, m - 1, d, isEnd ? 23 : 0, isEnd ? 59 : 0, isEnd ? 59 : 0, isEnd ? 999 : 0)
  return date.toISOString()
}

function shiftYear(iso: string | undefined, delta: number, isEnd: boolean): string | undefined {
  const base = iso ? new Date(iso) : new Date()
  base.setFullYear(base.getFullYear() + delta)
  if (isEnd) base.setHours(23, 59, 59, 999)
  else base.setHours(0, 0, 0, 0)
  return base.toISOString()
}

function DateRow({ label, isoValue, isEnd, onChange }: {
  label: string; isoValue: string | undefined; isEnd: boolean; onChange: (iso: string | undefined) => void
}) {
  const currentYear = isoValue ? new Date(isoValue).getFullYear() : new Date().getFullYear()
  return (
    <div className="flex gap-1 items-center">
      <Input
        type="date"
        className="flex-1"
        value={isoToDateInput(isoValue)}
        onChange={e => onChange(dateInputToIso(e.target.value, isEnd))}
        placeholder={label}
      />
      <button
        type="button"
        title="Anno precedente"
        className="h-9 w-7 shrink-0 rounded-md border bg-background hover:bg-accent inline-flex items-center justify-center"
        onClick={() => onChange(shiftYear(isoValue, -1, isEnd))}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="text-xs tabular-nums text-muted-foreground w-10 text-center">{currentYear}</span>
      <button
        type="button"
        title="Anno successivo"
        className="h-9 w-7 shrink-0 rounded-md border bg-background hover:bg-accent inline-flex items-center justify-center"
        onClick={() => onChange(shiftYear(isoValue, +1, isEnd))}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

const RANGE_PRESETS: { label: string; days: number | null }[] = [
  { label: "7g", days: 7 },
  { label: "30g", days: 30 },
  { label: "90g", days: 90 },
  { label: "1a", days: 365 },
  { label: "Tutto", days: null },
]

export function BodyFiltersSidebar({ value, onChange, availableSources, availableYears, onClose }: Props) {
  const set = <K extends keyof BodyFilters>(k: K, v: BodyFilters[K]) =>
    onChange({ ...value, [k]: v })

  const toggleList = <T extends string>(list: T[] | undefined, item: T): T[] => {
    const arr = list ?? []
    return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]
  }

  const clear = () => onChange(makeDefaultBodyFilters())

  const applyRange = (days: number | null) => {
    if (days === null) {
      onChange({ ...value, start: undefined, end: undefined })
      return
    }
    const end = new Date()
    const start = new Date(end.getTime() - days * 86400_000)
    onChange({ ...value, start: start.toISOString(), end: end.toISOString() })
  }

  const selectedTypes = value.types && value.types.length > 0 ? value.types : [DEFAULT_TYPE]

  const activeCount = [
    value.start, value.end,
    value.types?.length && value.types.length < BODY_TYPES.length ? 1 : undefined,
    value.sources?.length,
    value.weight_min !== undefined ? 1 : undefined,
    value.weight_max !== undefined ? 1 : undefined,
  ].filter(Boolean).length

  const applyYear = (year: number) => {
    const start = new Date(year, 0, 1, 0, 0, 0, 0).toISOString()
    const end = new Date(year, 11, 31, 23, 59, 59, 999).toISOString()
    onChange({ ...value, start, end, years: undefined })
  }

  // Is a given year currently selected? (start/end exactly span Jan 1 – Dec 31)
  const isYearActive = (year: number) => {
    if (!value.start || !value.end) return false
    const s = new Date(value.start)
    const e = new Date(value.end)
    return s.getFullYear() === year && s.getMonth() === 0 && s.getDate() === 1
        && e.getFullYear() === year && e.getMonth() === 11 && e.getDate() === 31
  }

  return (
    <div className="space-y-5 p-4 pb-24 h-full overflow-y-auto">
      <div className="flex items-center justify-between pb-3 border-b">
        <h3 className="font-semibold">
          Filtri {activeCount > 0 && <span className="text-xs text-muted-foreground">({activeCount})</span>}
        </h3>
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

      {/* Tipi */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">Metriche</Label>
        <div className="flex flex-wrap gap-1">
          {BODY_TYPES.map(t => {
            const meta = getMeta(t)
            const sel = selectedTypes.includes(t)
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  const current = value.types && value.types.length > 0 ? value.types : [DEFAULT_TYPE]
                  const next = toggleList(current, t)
                  set("types", next.length === 0 ? [DEFAULT_TYPE] : next)
                }}
                className={`text-xs px-2 py-1 rounded-md border inline-flex items-center gap-1.5 ${
                  sel ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                }`}
              >
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: meta.color }} />
                {meta.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Aggregazione */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">Aggregazione grafico</Label>
        <Select
          value={value.aggregation ?? "none"}
          onValueChange={v => set("aggregation", v as Aggregation)}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nessuna (grezzi)</SelectItem>
            <SelectItem value="daily">Giornaliero</SelectItem>
            <SelectItem value="weekly">Settimanale</SelectItem>
            <SelectItem value="monthly">Mensile</SelectItem>
          </SelectContent>
        </Select>
      </section>

      {/* Periodo */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">Periodo preciso</Label>
        <DateRow
          label="Da"
          isoValue={value.start}
          isEnd={false}
          onChange={iso => set("start", iso)}
        />
        <DateRow
          label="A"
          isoValue={value.end}
          isEnd={true}
          onChange={iso => set("end", iso)}
        />
        <div className="flex flex-wrap gap-1 pt-1">
          {RANGE_PRESETS.map(p => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyRange(p.days)}
              className="text-xs px-2 py-1 rounded-md border bg-background hover:bg-accent"
            >
              {p.label}
            </button>
          ))}
        </div>
        {availableYears.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {availableYears.map(y => {
              const active = isYearActive(y)
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => applyYear(y)}
                  className={`text-xs px-2 py-1 rounded-md border ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-accent"
                  }`}
                >
                  {y}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Peso range (solo BodyMass) */}
      <section className="space-y-2">
        <Label className="text-xs font-medium">Peso (kg)</Label>
        <div className="flex gap-2">
          <Input
            type="number" step="0.1" placeholder="min"
            value={value.weight_min ?? ""}
            onChange={e => set("weight_min", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
          <Input
            type="number" step="0.1" placeholder="max"
            value={value.weight_max ?? ""}
            onChange={e => set("weight_max", e.target.value ? parseFloat(e.target.value) : undefined)}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">Applica solo ai campioni di peso.</p>
      </section>

      {/* Sources */}
      {availableSources.length > 0 && (
        <section className="space-y-2">
          <Label className="text-xs font-medium">Sorgente</Label>
          <div className="flex flex-wrap gap-1">
            {availableSources.map(s => {
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
    </div>
  )
}
