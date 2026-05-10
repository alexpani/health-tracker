import { useMemo } from "react"
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDiarioDailyTotals, useSamples } from "@/lib/queries"
import type { DiarioDailyTotal, NutritionFilters, Sample } from "@/lib/types"

// HealthKit dietary types we consolidate with the diario
const HK_DIETARY_MAP = [
  { key: "kcal",      type: "HKQuantityTypeIdentifierDietaryEnergyConsumed" },
  { key: "protein_g", type: "HKQuantityTypeIdentifierDietaryProtein" },
  { key: "fat_g",     type: "HKQuantityTypeIdentifierDietaryFatTotal" },
  { key: "carbs_g",   type: "HKQuantityTypeIdentifierDietaryCarbohydrates" },
] as const

// Our own write source — excluded from consolidation to avoid double counting
// (the diario total is already represented by our write into HealthKit).
const OUR_WRITE_SOURCE = "Health Tracker"

interface Props {
  filters: NutritionFilters
  /// Notifica al parent quando l'utente clicca una barra dell'istogramma
  /// storico, cosi' il calendario può portarsi su quel giorno.
  onBarClick?: (dateIso: string) => void
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })
}

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function DiarioSection({ filters, onBarClick }: Props) {
  // Fetch ALL daily totals once (all-time), then filter client-side. The table
  // is ~one row per day so 10 years ≈ 3650 entries — trivial.
  const { data: allDaily, isError: dailyError, error: dailyErr } =
    useDiarioDailyTotals("2010-01-01", todayLocalISO())

  // Fetch ALL-TIME dietary samples from HealthKit, once per type.
  // Cached 1 min via useSamples default. We aggregate + consolidate client-side.
  const hkKcal    = useSamples({ type: HK_DIETARY_MAP[0].type, aggregation: "none", limit: 10000 })
  const hkProtein = useSamples({ type: HK_DIETARY_MAP[1].type, aggregation: "none", limit: 10000 })
  const hkFat     = useSamples({ type: HK_DIETARY_MAP[2].type, aggregation: "none", limit: 10000 })
  const hkCarbs   = useSamples({ type: HK_DIETARY_MAP[3].type, aggregation: "none", limit: 10000 })

  // Build per-day, per-type sum of external-source (i.e. NOT our own write)
  // dietary samples, keyed by local-date string.
  const hkExternalByDay = useMemo(() => {
    const map: Record<string, { kcal: number; protein_g: number; fat_g: number; carbs_g: number }> = {}
    const accumulate = (samples: Sample[] | undefined, key: "kcal" | "protein_g" | "fat_g" | "carbs_g") => {
      if (!samples) return
      for (const s of samples) {
        if ((s.source_name ?? "") === OUR_WRITE_SOURCE) continue
        const d = new Date(s.start_date)
        const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        if (!map[localDate]) map[localDate] = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }
        map[localDate][key] += s.value
      }
    }
    accumulate(hkKcal.data?.data as Sample[] | undefined, "kcal")
    accumulate(hkProtein.data?.data as Sample[] | undefined, "protein_g")
    accumulate(hkFat.data?.data as Sample[] | undefined, "fat_g")
    accumulate(hkCarbs.data?.data as Sample[] | undefined, "carbs_g")
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hkKcal.data, hkProtein.data, hkFat.data, hkCarbs.data])

  // Consolidate diario + external HK into a single day-indexed list.
  // Days with only diario, only HK-external, or both are all included.
  const consolidatedDaily = useMemo<DiarioDailyTotal[]>(() => {
    const byDate = new Map<string, DiarioDailyTotal>()
    for (const d of (allDaily ?? [])) {
      byDate.set(d.date, { ...d })
    }
    for (const [date, hk] of Object.entries(hkExternalByDay)) {
      const existing = byDate.get(date)
      if (existing) {
        existing.kcal += hk.kcal
        existing.protein_g += hk.protein_g
        existing.fat_g += hk.fat_g
        existing.carbs_g += hk.carbs_g
      } else {
        byDate.set(date, {
          date,
          kcal: hk.kcal,
          protein_g: hk.protein_g,
          fat_g: hk.fat_g,
          carbs_g: hk.carbs_g,
          kcal_target: null,
        })
      }
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [allDaily, hkExternalByDay])

  // Apply filters to the history card (not to plan or today).
  const filtered = useMemo<DiarioDailyTotal[]>(() => {
    const startMs = filters.start ? new Date(filters.start).getTime() : null
    const endMs = filters.end ? new Date(filters.end).getTime() : null
    return consolidatedDaily.filter(d => {
      const t = new Date(d.date + "T12:00:00").getTime()
      if (startMs !== null && t < startMs) return false
      if (endMs !== null && t > endMs) return false
      if (filters.kcal_min !== undefined && d.kcal < filters.kcal_min) return false
      if (filters.kcal_max !== undefined && d.kcal > filters.kcal_max) return false
      if (filters.adherence && d.kcal_target) {
        const ratio = d.kcal / d.kcal_target
        if (filters.adherence === "under" && ratio >= 0.9) return false
        if (filters.adherence === "over" && ratio <= 1.1) return false
        if (filters.adherence === "on_target" && (ratio < 0.9 || ratio > 1.1)) return false
      } else if (filters.adherence && !d.kcal_target) {
        return false
      }
      // Filtro "Regime alimentare" (kcal_target). null = "Senza target",
      // numero = "match esatto su quel target" (round per evitare drift
      // tipo 1499.999 vs 1500).
      if (filters.kcal_target !== undefined) {
        if (filters.kcal_target === null) {
          if (d.kcal_target != null) return false
        } else {
          if (d.kcal_target == null || Math.round(d.kcal_target) !== filters.kcal_target) return false
        }
      }
      return true
    })
  }, [consolidatedDaily, filters.start, filters.end, filters.kcal_min, filters.kcal_max, filters.adherence, filters.kcal_target])

  const stats = useMemo(() => {
    if (filtered.length === 0) return null
    const n = filtered.length
    const sum = filtered.reduce((acc, d) => ({
      kcal: acc.kcal + d.kcal,
      protein: acc.protein + d.protein_g,
      fat: acc.fat + d.fat_g,
      carbs: acc.carbs + d.carbs_g,
    }), { kcal: 0, protein: 0, fat: 0, carbs: 0 })
    return {
      count: n,
      avgKcal: sum.kcal / n,
      avgProtein: sum.protein / n,
      avgFat: sum.fat / n,
      avgCarbs: sum.carbs / n,
    }
  }, [filtered])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Diario alimentare</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Regime alimentare quotidiano dal servizio <span className="font-mono">diario-alimentare</span>.
          Sync con Apple Salute automatico al prossimo Sync Now sull'iPhone.
        </p>
      </div>

      {/* Storico filtrato */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Storico</span>
            {stats && (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {stats.count} giorni · media {Math.round(stats.avgKcal)} kcal
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyError && (
            <p className="text-sm text-destructive">Errore caricamento storico: {(dailyErr as Error)?.message}</p>
          )}
          {!dailyError && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-8">Nessun giorno corrisponde ai filtri correnti.</p>
          )}
          {filtered.length > 0 && (
            <>
              {stats && (
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="p-2 rounded-md border text-center">
                    <p className="text-[11px] text-muted-foreground">Media kcal</p>
                    <p className="text-lg font-semibold tabular-nums">{Math.round(stats.avgKcal)}</p>
                  </div>
                  <div className="p-2 rounded-md border text-center">
                    <p className="text-[11px] text-muted-foreground">Media proteine</p>
                    <p className="text-lg font-semibold tabular-nums">{stats.avgProtein.toFixed(1)}<span className="text-xs text-muted-foreground font-normal ml-0.5">g</span></p>
                  </div>
                  <div className="p-2 rounded-md border text-center">
                    <p className="text-[11px] text-muted-foreground">Media grassi</p>
                    <p className="text-lg font-semibold tabular-nums">{stats.avgFat.toFixed(1)}<span className="text-xs text-muted-foreground font-normal ml-0.5">g</span></p>
                  </div>
                  <div className="p-2 rounded-md border text-center">
                    <p className="text-[11px] text-muted-foreground">Media carbs</p>
                    <p className="text-lg font-semibold tabular-nums">{stats.avgCarbs.toFixed(1)}<span className="text-xs text-muted-foreground font-normal ml-0.5">g</span></p>
                  </div>
                </div>
              )}

              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart
                  data={filtered}
                  onClick={(state: any) => {
                    const date = state?.activePayload?.[0]?.payload?.date
                    if (date && onBarClick) onBarClick(date)
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }}
                    tickFormatter={s => new Date(s + "T00:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "short" })}
                    minTickGap={30} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    labelFormatter={(label) => formatDateShort(label as string)}
                    formatter={(v: any, name: any) => [
                      typeof v === "number" ? v.toLocaleString("it-IT") : v,
                      name === "kcal" ? "Consumato" : "Target",
                    ]} />
                  <Legend formatter={(v) => v === "kcal" ? "Consumato (kcal)" : "Target (kcal)"} />
                  <Bar
                    dataKey="kcal"
                    fill="#8b5cf6"
                    radius={[3, 3, 0, 0]}
                    cursor={onBarClick ? "pointer" : undefined}
                  />
                  <Line type="monotone" dataKey="kcal_target" stroke="#f59e0b" strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>

              <div className="mt-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">kcal</TableHead>
                      <TableHead className="text-right">Proteine</TableHead>
                      <TableHead className="text-right">Grassi</TableHead>
                      <TableHead className="text-right">Carbs</TableHead>
                      <TableHead className="text-right">Δ vs target</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...filtered].reverse().slice(0, 15).map(d => {
                      const delta = d.kcal_target != null ? d.kcal - d.kcal_target : null
                      const deltaColor = delta == null ? "text-muted-foreground"
                        : Math.abs(delta) < 50 ? "text-muted-foreground"
                        : delta > 0 ? "text-red-500"
                        : "text-emerald-600"
                      return (
                        <TableRow key={d.date}>
                          <TableCell className="tabular-nums">{formatDateShort(d.date)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{d.kcal.toLocaleString("it-IT")}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.protein_g.toFixed(1)}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.fat_g.toFixed(1)}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.carbs_g.toFixed(1)}</TableCell>
                          <TableCell className={`text-right tabular-nums ${deltaColor}`}>
                            {delta == null ? "—" : (delta > 0 ? `+${delta}` : `${delta}`)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
                {filtered.length > 15 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Mostrati ultimi 15 giorni filtrati (totali {filtered.length})
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
