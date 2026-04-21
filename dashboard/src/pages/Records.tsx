import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronRight, Filter, Flame, Gauge, Ruler, Timer, Trophy, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { useWorkoutRecords, useWorkoutRecordsFacets } from "@/lib/queries"
import { effectiveTypeLabel } from "@/lib/healthkit"
import type { AtDistanceRecord, BestSingleKm, EffectiveTypeRecords, RecordEntry, RecordsFilters } from "@/lib/types"

const STORAGE_KEY = "records_filters_v1"

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "-"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`
  return `${m}:${String(s).padStart(2, "0")}`
}

function formatPace(secPerKm: number | null | undefined): string {
  if (!secPerKm || secPerKm <= 0) return "-"
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, "0")}/km`
}

function formatKm(meters: number | null | undefined): string {
  if (meters == null) return "-"
  return `${(meters / 1000).toFixed(2)} km`
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })
}

function RecordRow({
  icon, label, primary, secondary, entry, onClick,
}: {
  icon: React.ReactNode
  label: string
  primary: string
  secondary?: string
  entry: RecordEntry | AtDistanceRecord | BestSingleKm | null
  onClick?: () => void
}) {
  const clickable = entry != null && onClick != null
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={onClick}
      className={`w-full flex items-center gap-3 py-2 px-2 -mx-2 rounded-md text-left ${
        clickable ? "hover:bg-accent transition-colors cursor-pointer" : "opacity-70 cursor-default"
      }`}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium tabular-nums truncate">
          {primary}
          {secondary && <span className="text-muted-foreground text-xs font-normal ml-2">{secondary}</span>}
        </p>
      </div>
      {entry && (
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {formatShortDate(entry.start_date)}
        </span>
      )}
      {clickable && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
    </button>
  )
}

function ActivityCard({ record }: { record: EffectiveTypeRecords }) {
  const navigate = useNavigate()
  const go = (uuid: string) => () => navigate(`/workouts/${uuid}`)
  const label = effectiveTypeLabel(record.effective_type, record.activity_type)
  const { longest_distance, longest_duration, fastest_pace, most_calories } = record.overall

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span>{label}</span>
          <span className="text-xs font-normal text-muted-foreground">{record.count} workout</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="space-y-0.5">
          <RecordRow icon={<Ruler className="h-4 w-4" />} label="Distanza max"
            primary={longest_distance ? formatKm(longest_distance.total_distance) : "—"}
            secondary={longest_distance?.duration ? `in ${formatDuration(longest_distance.duration)}` : undefined}
            entry={longest_distance} onClick={longest_distance ? go(longest_distance.uuid) : undefined} />
          <RecordRow icon={<Timer className="h-4 w-4" />} label="Durata max"
            primary={longest_duration ? formatDuration(longest_duration.duration) : "—"}
            secondary={longest_duration?.total_distance ? formatKm(longest_duration.total_distance) : undefined}
            entry={longest_duration} onClick={longest_duration ? go(longest_duration.uuid) : undefined} />
          <RecordRow icon={<Gauge className="h-4 w-4" />} label="Pace medio migliore"
            primary={fastest_pace ? formatPace(fastest_pace.pace_s_per_km) : "—"}
            secondary={fastest_pace ? formatKm(fastest_pace.total_distance) : undefined}
            entry={fastest_pace} onClick={fastest_pace ? go(fastest_pace.uuid) : undefined} />
          <RecordRow icon={<Flame className="h-4 w-4" />} label="Calorie max"
            primary={most_calories?.total_energy_burned ? `${Math.round(most_calories.total_energy_burned)} kcal` : "—"}
            secondary={most_calories?.duration ? formatDuration(most_calories.duration) : undefined}
            entry={most_calories} onClick={most_calories ? go(most_calories.uuid) : undefined} />
        </div>

        {record.at_distance.length > 0 && (
          <div className="border-t pt-2 mt-2 space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground px-2 mb-1">Record per distanza</p>
            {record.at_distance.map(ad => {
              const targetLabel = ad.target_km === 21.097 ? "Mezza (21 km)"
                : ad.target_km === 42.195 ? "Maratona (42 km)"
                : `${ad.target_km} km`
              return (
                <RecordRow key={ad.target_km} icon={<Trophy className="h-4 w-4" />} label={targetLabel}
                  primary={formatDuration(ad.duration)}
                  secondary={`@ ${formatPace(ad.pace_s_per_km)} · ${formatKm(ad.total_distance)}`}
                  entry={ad} onClick={go(ad.uuid)} />
              )
            })}
          </div>
        )}

        {record.best_single_km && (
          <div className="border-t pt-2 mt-2">
            <p className="text-xs font-medium text-muted-foreground px-2 mb-1">Miglior km ever</p>
            <RecordRow icon={<Gauge className="h-4 w-4" />} label={`km #${record.best_single_km.n}`}
              primary={formatPace(record.best_single_km.pace_s_per_km)}
              secondary={record.best_single_km.avg_heart_rate != null ? `HR ${record.best_single_km.avg_heart_rate} bpm` : undefined}
              entry={record.best_single_km} onClick={go(record.best_single_km.uuid)} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RecordsSidebar({
  filters, onChange, onClose,
}: {
  filters: RecordsFilters
  onChange: (f: RecordsFilters) => void
  onClose?: () => void
}) {
  const { data: facets } = useWorkoutRecordsFacets()

  const toggleList = <T extends string | number>(arr: T[] | undefined, item: T): T[] => {
    const a = arr ?? []
    return a.includes(item) ? a.filter(x => x !== item) : [...a, item]
  }

  const activeCount = [
    filters.years?.length, filters.sources?.length,
    filters.indoor !== undefined ? 1 : undefined,
  ].filter(Boolean).length

  return (
    <div className="space-y-5 p-4 pb-24 h-full overflow-y-auto">
      <div className="flex items-center justify-between pb-3 border-b">
        <h3 className="font-semibold">
          Filtri {activeCount > 0 && <span className="text-xs text-muted-foreground">({activeCount})</span>}
        </h3>
        <div className="flex gap-1">
          {activeCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onChange({})}>Pulisci</Button>
          )}
          {onClose && (
            <Button size="icon" variant="ghost" className="h-7 w-7 md:hidden" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {facets?.years && facets.years.length > 0 && (
        <section className="space-y-2">
          <Label className="text-xs font-medium">Anno</Label>
          <div className="flex flex-wrap gap-1">
            {facets.years.slice().reverse().map(y => {
              const sel = filters.years?.includes(y.year) ?? false
              return (
                <button key={y.year} type="button"
                  onClick={() => onChange({ ...filters, years: toggleList(filters.years, y.year) })}
                  className={`text-xs px-2 py-1 rounded-md border ${
                    sel ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                  }`}>
                  {y.year} <span className="opacity-60">({y.count})</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {facets?.sources && facets.sources.length > 0 && (
        <section className="space-y-2">
          <Label className="text-xs font-medium">Sorgente</Label>
          <div className="flex flex-wrap gap-1">
            {facets.sources.map(s => {
              const sel = filters.sources?.includes(s.name) ?? false
              return (
                <button key={s.name} type="button"
                  onClick={() => onChange({ ...filters, sources: toggleList(filters.sources, s.name) })}
                  className={`text-xs px-2 py-1 rounded-md border ${
                    sel ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                  }`}>
                  {s.name} <span className="opacity-60">({s.count})</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {facets && (facets.indoor_count > 0 || facets.outdoor_count > 0) && (
        <section className="space-y-2">
          <Label className="text-xs font-medium">Ambiente</Label>
          <div className="flex flex-wrap gap-1">
            {[
              { key: undefined, label: "Tutti", count: facets.indoor_count + facets.outdoor_count },
              { key: false, label: "Outdoor", count: facets.outdoor_count },
              { key: true, label: "Indoor (tapis)", count: facets.indoor_count },
            ].map(opt => {
              const sel = filters.indoor === opt.key
              return (
                <button key={String(opt.key)} type="button"
                  onClick={() => onChange({ ...filters, indoor: opt.key })}
                  className={`text-xs px-2 py-1 rounded-md border ${
                    sel ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-accent"
                  }`}>
                  {opt.label} <span className="opacity-60">({opt.count})</span>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

export default function Records() {
  const saved = useMemo<any>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  }, [])

  const [filters, setFilters] = useState<RecordsFilters>(saved.filters ?? {})
  const [showMobileFilters, setShowMobileFilters] = useState(false)

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters })) } catch {}
  }, [filters])

  const { data, isLoading, isFetching, isError, error } = useWorkoutRecords(filters)

  const activeFiltersCount = [
    filters.years?.length, filters.sources?.length,
    filters.indoor !== undefined ? 1 : undefined,
  ].filter(Boolean).length

  return (
    <div className="flex gap-6 -m-6 p-0 min-h-[calc(100vh-0px)]">
      <aside className="hidden lg:block w-[320px] shrink-0 border-r bg-card/30 sticky top-0 h-screen overflow-hidden">
        <RecordsSidebar filters={filters} onChange={setFilters} />
      </aside>

      <div className="flex-1 space-y-6 min-w-0 p-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Record</h1>
            <p className="text-muted-foreground">
              Personal record della corsa
              {isFetching && !isLoading && <span className="ml-2 text-xs">(ricarica…)</span>}
            </p>
          </div>
          <Button variant="outline" className="lg:hidden" onClick={() => setShowMobileFilters(true)}>
            <Filter className="h-4 w-4 mr-2" />
            Filtri {activeFiltersCount > 0 && <span className="ml-1 bg-primary text-primary-foreground rounded-full px-2 text-xs">{activeFiltersCount}</span>}
          </Button>
        </div>

        {isLoading && (
          <>
            <div className="h-48 animate-pulse bg-muted rounded" />
            <p className="text-xs text-muted-foreground">Ricostruisco i record dai sample GPS, può richiedere qualche secondo...</p>
          </>
        )}

        {isError && (
          <div className="text-sm text-destructive">
            Errore: {(error as Error)?.message ?? "?"}
          </div>
        )}

        {!isLoading && !isError && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {(data?.by_effective_type ?? []).map(t => <ActivityCard key={t.effective_type} record={t} />)}
            {(data?.by_effective_type ?? []).length === 0 && (
              <p className="text-muted-foreground">Nessun record per i filtri correnti.</p>
            )}
          </div>
        )}
      </div>

      {showMobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileFilters(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[85%] max-w-[360px] bg-background shadow-xl">
            <RecordsSidebar filters={filters} onChange={setFilters} onClose={() => setShowMobileFilters(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
