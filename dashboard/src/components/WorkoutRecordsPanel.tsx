import { useNavigate } from "react-router-dom"
import { ChevronRight, Flame, Gauge, Ruler, Timer, Trophy } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useWorkoutRecords } from "@/lib/queries"
import { effectiveTypeLabel } from "@/lib/healthkit"
import type { AtDistanceRecord, BestSingleKm, EffectiveTypeRecords, RecordEntry, WorkoutFilters } from "@/lib/types"

interface Props {
  filters: WorkoutFilters
}

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
  icon,
  label,
  primary,
  secondary,
  entry,
  onClick,
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

function ActivityRecordsCard({ record }: { record: EffectiveTypeRecords }) {
  const navigate = useNavigate()
  const go = (uuid: string) => () => navigate(`/workouts/${uuid}`)
  const label = effectiveTypeLabel(record.effective_type, record.activity_type)

  const { longest_distance, longest_duration, fastest_pace, most_calories } = record.overall

  const hasAtDistance = record.at_distance.length > 0
  const hasBestKm = record.best_single_km != null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between">
          <span>{label}</span>
          <span className="text-xs font-normal text-muted-foreground">{record.count} workout</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {/* Overall */}
        <div className="space-y-0.5">
          <RecordRow
            icon={<Ruler className="h-4 w-4" />}
            label="Distanza max"
            primary={longest_distance ? formatKm(longest_distance.total_distance) : "—"}
            secondary={longest_distance?.duration ? `in ${formatDuration(longest_distance.duration)}` : undefined}
            entry={longest_distance}
            onClick={longest_distance ? go(longest_distance.uuid) : undefined}
          />
          <RecordRow
            icon={<Timer className="h-4 w-4" />}
            label="Durata max"
            primary={longest_duration ? formatDuration(longest_duration.duration) : "—"}
            secondary={longest_duration?.total_distance ? formatKm(longest_duration.total_distance) : undefined}
            entry={longest_duration}
            onClick={longest_duration ? go(longest_duration.uuid) : undefined}
          />
          <RecordRow
            icon={<Gauge className="h-4 w-4" />}
            label="Pace medio migliore"
            primary={fastest_pace ? formatPace(fastest_pace.pace_s_per_km) : "—"}
            secondary={fastest_pace ? formatKm(fastest_pace.total_distance) : undefined}
            entry={fastest_pace}
            onClick={fastest_pace ? go(fastest_pace.uuid) : undefined}
          />
          <RecordRow
            icon={<Flame className="h-4 w-4" />}
            label="Calorie max"
            primary={most_calories?.total_energy_burned ? `${Math.round(most_calories.total_energy_burned)} kcal` : "—"}
            secondary={most_calories?.duration ? formatDuration(most_calories.duration) : undefined}
            entry={most_calories}
            onClick={most_calories ? go(most_calories.uuid) : undefined}
          />
        </div>

        {/* Record per distanza */}
        {hasAtDistance && (
          <div className="border-t pt-2 mt-2 space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground px-2 mb-1">Record per distanza</p>
            {record.at_distance.map(ad => {
              const targetLabel = ad.target_km === 21.097 ? "Mezza (21 km)"
                : ad.target_km === 42.195 ? "Maratona (42 km)"
                : `${ad.target_km} km`
              return (
                <RecordRow
                  key={ad.target_km}
                  icon={<Trophy className="h-4 w-4" />}
                  label={targetLabel}
                  primary={formatDuration(ad.duration)}
                  secondary={`@ ${formatPace(ad.pace_s_per_km)} · ${formatKm(ad.total_distance)}`}
                  entry={ad}
                  onClick={go(ad.uuid)}
                />
              )
            })}
          </div>
        )}

        {/* Best single km */}
        {hasBestKm && record.best_single_km && (
          <div className="border-t pt-2 mt-2">
            <p className="text-xs font-medium text-muted-foreground px-2 mb-1">Miglior km ever</p>
            <RecordRow
              icon={<Gauge className="h-4 w-4" />}
              label={`km #${record.best_single_km.n}`}
              primary={formatPace(record.best_single_km.pace_s_per_km)}
              secondary={record.best_single_km.avg_heart_rate != null ? `HR ${record.best_single_km.avg_heart_rate} bpm` : undefined}
              entry={record.best_single_km}
              onClick={go(record.best_single_km.uuid)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function WorkoutRecordsPanel({ filters }: Props) {
  const { data, isLoading, isError, error } = useWorkoutRecords(filters)

  if (isLoading) {
    return <div className="h-40 animate-pulse bg-muted rounded" />
  }
  if (isError) {
    return (
      <div className="text-sm text-destructive">
        Errore caricamento record: {(error as Error)?.message ?? "?"}
      </div>
    )
  }
  const types = data?.by_effective_type ?? []
  if (types.length === 0) {
    return <p className="text-muted-foreground py-6">Nessun record disponibile con i filtri correnti.</p>
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {types.map(t => <ActivityRecordsCard key={t.effective_type} record={t} />)}
    </div>
  )
}
