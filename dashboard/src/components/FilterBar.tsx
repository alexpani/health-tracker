import { useEffect, useState } from "react"
import { Filter, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSampleFacets } from "@/lib/queries"
import type { AdvancedFilters } from "@/lib/types"

interface Props {
  type: string
  value: AdvancedFilters
  onChange: (v: AdvancedFilters) => void
}

function localToISO(s: string): string | undefined {
  if (!s) return undefined
  // s is "YYYY-MM-DDTHH:MM" in local time
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

function isoToLocal(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function FilterBar({ type, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const { data: facets } = useSampleFacets(type, open)

  const [startLocal, setStartLocal] = useState(isoToLocal(value.start))
  const [endLocal, setEndLocal] = useState(isoToLocal(value.end))
  const [valueMin, setValueMin] = useState<string>(value.value_min?.toString() ?? "")
  const [valueMax, setValueMax] = useState<string>(value.value_max?.toString() ?? "")
  const [sources, setSources] = useState<string[]>(value.sources ?? [])
  const [devices, setDevices] = useState<string[]>(value.devices ?? [])

  // Sync local state when value changes externally (e.g., range preset changes start/end)
  useEffect(() => {
    setStartLocal(isoToLocal(value.start))
    setEndLocal(isoToLocal(value.end))
  }, [value.start, value.end])

  const hasActive =
    value.sources?.length ||
    value.devices?.length ||
    value.value_min !== undefined ||
    value.value_max !== undefined ||
    (value.start && isoToLocal(value.start) !== "")

  const activeCount =
    (value.sources?.length ? 1 : 0) +
    (value.devices?.length ? 1 : 0) +
    (value.value_min !== undefined || value.value_max !== undefined ? 1 : 0)

  const toggle = (list: string[], item: string): string[] =>
    list.includes(item) ? list.filter(x => x !== item) : [...list, item]

  const apply = () => {
    onChange({
      start: localToISO(startLocal),
      end: localToISO(endLocal),
      value_min: valueMin !== "" ? parseFloat(valueMin) : undefined,
      value_max: valueMax !== "" ? parseFloat(valueMax) : undefined,
      sources: sources.length ? sources : undefined,
      devices: devices.length ? devices : undefined,
    })
    setOpen(false)
  }

  const clear = () => {
    setStartLocal("")
    setEndLocal("")
    setValueMin("")
    setValueMax("")
    setSources([])
    setDevices([])
    onChange({})
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
          <Filter className="h-4 w-4 mr-2" />
          Filtri {activeCount > 0 && <span className="ml-1 bg-primary text-primary-foreground rounded-full px-2 text-xs">{activeCount}</span>}
        </Button>
        {hasActive && (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X className="h-4 w-4 mr-1" /> Pulisci
          </Button>
        )}
      </div>

      {open && (
        <Card>
          <CardContent className="p-4 space-y-4">
            {/* Period */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Da</Label>
                <Input type="datetime-local" value={startLocal} onChange={e => setStartLocal(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">A</Label>
                <Input type="datetime-local" value={endLocal} onChange={e => setEndLocal(e.target.value)} />
              </div>
            </div>

            {/* Value range */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">
                  Valore minimo {facets?.value_min != null && <span className="text-muted-foreground">(DB min: {facets.value_min.toFixed(2)})</span>}
                </Label>
                <Input type="number" step="any" value={valueMin} onChange={e => setValueMin(e.target.value)} placeholder="qualsiasi" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  Valore massimo {facets?.value_max != null && <span className="text-muted-foreground">(DB max: {facets.value_max.toFixed(2)})</span>}
                </Label>
                <Input type="number" step="any" value={valueMax} onChange={e => setValueMax(e.target.value)} placeholder="qualsiasi" />
              </div>
            </div>

            {/* Sources */}
            {facets && facets.sources.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Sorgente</Label>
                <div className="flex flex-wrap gap-1">
                  {facets.sources.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSources(toggle(sources, s))}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                        sources.includes(s)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-accent"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Devices */}
            {facets && facets.devices.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Dispositivo</Label>
                <div className="flex flex-wrap gap-1">
                  {facets.devices.map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDevices(toggle(devices, d))}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                        devices.includes(d)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-accent"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Annulla</Button>
              <Button size="sm" onClick={apply}>Applica</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
