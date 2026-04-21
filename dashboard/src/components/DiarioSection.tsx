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
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDiarioActivePlan, useDiarioDailyTotals, useDiarioSyncToHK, useSamples } from "@/lib/queries"
import type { DiarioDailyTotal, NutritionFilters, Sample } from "@/lib/types"
import { RefreshCw } from "lucide-react"

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
}

function formatDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })
}

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function ProgressBar({ value, target, unit, label, color }: {
  value: number; target: number | null | undefined; unit: string; label: string; color: string
}) {
  const pct = target && target > 0 ? (value / target) * 100 : 0
  const capped = Math.min(pct, 120)
  const statusColor = pct > 110 ? "text-red-500" : pct > 100 ? "text-amber-500" : "text-emerald-600"
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-baseline text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`tabular-nums font-medium ${statusColor}`}>
          {target ? `${pct.toFixed(0)}%` : "—"}
        </span>
      </div>
      <div className="h-2 bg-muted rounded overflow-hidden">
        <div className="h-full transition-all"
          style={{
            width: `${capped}%`,
            background: pct > 110 ? "#ef4444" : pct > 100 ? "#f59e0b" : color,
          }} />
      </div>
      <p className="text-xs tabular-nums">
        <span className="font-medium">{value.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</span>
        <span className="text-muted-foreground"> / {target ? target.toLocaleString("it-IT") : "—"} {unit}</span>
      </p>
    </div>
  )
}

export function DiarioSection({ filters }: Props) {
  const { data: plan, isLoading: planLoading, isError: planError, error: planErr } = useDiarioActivePlan()

  // Fetch ALL daily totals once (all-time), then filter client-side. The table
  // is ~one row per day so 10 years ≈ 3650 entries — trivial.
  const { data: allDaily, isError: dailyError, error: dailyErr } =
    useDiarioDailyTotals("2010-01-01", todayLocalISO())

  const today = todayLocalISO()
  const todayEntry = (allDaily ?? []).find(d => d.date === today) ?? null

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

  const todayHkExternal = hkExternalByDay[today] ?? { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }
  const todayHasExternal = todayHkExternal.kcal > 0 || todayHkExternal.protein_g > 0 ||
    todayHkExternal.fat_g > 0 || todayHkExternal.carbs_g > 0
  // Consolidated today values = diario + external HK
  const todayConsolidated = todayEntry ? {
    kcal: todayEntry.kcal + todayHkExternal.kcal,
    protein_g: todayEntry.protein_g + todayHkExternal.protein_g,
    fat_g: todayEntry.fat_g + todayHkExternal.fat_g,
    carbs_g: todayEntry.carbs_g + todayHkExternal.carbs_g,
  } : todayHasExternal ? {
    kcal: todayHkExternal.kcal,
    protein_g: todayHkExternal.protein_g,
    fat_g: todayHkExternal.fat_g,
    carbs_g: todayHkExternal.carbs_g,
  } : null

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
      return true
    })
  }, [consolidatedDaily, filters.start, filters.end, filters.kcal_min, filters.kcal_max, filters.adherence])

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

  const planMissing = planError && (planErr as any)?.message?.includes("404")

  const syncToHK = useDiarioSyncToHK()

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Diario alimentare</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Regime alimentare quotidiano dal servizio <span className="font-mono">diario-alimentare</span>.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => syncToHK.mutate()}
            disabled={syncToHK.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${syncToHK.isPending ? "animate-spin" : ""}`} />
            Sincronizza con Apple Salute
          </Button>
          {syncToHK.data && (
            <p className="text-[11px] text-muted-foreground text-right">
              Accodate {syncToHK.data.queued_writes} write + {syncToHK.data.queued_deletions} delete.{" "}
              {syncToHK.data.queued_writes + syncToHK.data.queued_deletions === 0
                ? "Tutto gia' allineato."
                : "Saranno processate al prossimo Sync Now sull'iPhone."}
            </p>
          )}
          {syncToHK.isError && (
            <p className="text-[11px] text-destructive text-right">
              Errore: {(syncToHK.error as Error).message}
            </p>
          )}
        </div>
      </div>

      {/* Piano attivo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Piano alimentare attivo</span>
            {plan && <span className="text-xs font-normal text-muted-foreground">{plan.name}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {planLoading && <div className="h-16 animate-pulse bg-muted rounded" />}
          {planMissing && <p className="text-sm text-muted-foreground">Nessun piano attivo nel diario.</p>}
          {planError && !planMissing && (
            <p className="text-sm text-destructive">Diario alimentare non raggiungibile: {(planErr as Error)?.message}</p>
          )}
          {plan && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-md border">
                <p className="text-xs text-muted-foreground">Target kcal</p>
                <p className="text-xl font-semibold tabular-nums">{plan.kcal_target.toLocaleString("it-IT")}</p>
              </div>
              <div className="p-3 rounded-md border">
                <p className="text-xs text-muted-foreground">Proteine</p>
                <p className="text-xl font-semibold tabular-nums">{plan.protein_g} <span className="text-sm text-muted-foreground font-normal">g</span></p>
                <p className="text-[11px] text-muted-foreground">{plan.protein_pct}%</p>
              </div>
              <div className="p-3 rounded-md border">
                <p className="text-xs text-muted-foreground">Grassi</p>
                <p className="text-xl font-semibold tabular-nums">{plan.fat_g} <span className="text-sm text-muted-foreground font-normal">g</span></p>
                <p className="text-[11px] text-muted-foreground">{plan.fat_pct}%</p>
              </div>
              <div className="p-3 rounded-md border">
                <p className="text-xs text-muted-foreground">Carboidrati</p>
                <p className="text-xl font-semibold tabular-nums">{plan.carbs_g} <span className="text-sm text-muted-foreground font-normal">g</span></p>
                <p className="text-[11px] text-muted-foreground">{plan.carbs_pct}%</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Oggi — consolidato (diario + sorgenti HealthKit esterne) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Oggi</span>
            {todayHasExternal && (
              <span className="text-xs font-normal text-muted-foreground">
                Consolidato (diario + HealthKit)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!todayConsolidated && (
            <p className="text-sm text-muted-foreground">Nessun dato alimentare registrato oggi.</p>
          )}
          {todayConsolidated && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <ProgressBar value={todayConsolidated.kcal} target={plan?.kcal_target ?? todayEntry?.kcal_target}
                  unit="kcal" label="Calorie" color="#8b5cf6" />
                <ProgressBar value={todayConsolidated.protein_g} target={plan?.protein_g}
                  unit="g" label="Proteine" color="#10b981" />
                <ProgressBar value={todayConsolidated.fat_g} target={plan?.fat_g}
                  unit="g" label="Grassi" color="#f59e0b" />
                <ProgressBar value={todayConsolidated.carbs_g} target={plan?.carbs_g}
                  unit="g" label="Carboidrati" color="#ef4444" />
              </div>
              {todayHasExternal && (
                <p className="text-xs text-muted-foreground mt-3 tabular-nums">
                  Diario {todayEntry?.kcal ?? 0} + HealthKit esterne {Math.round(todayHkExternal.kcal)} = {Math.round(todayConsolidated.kcal)} kcal
                </p>
              )}
              {plan?.kcal_target && (
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {todayConsolidated.kcal > plan.kcal_target
                    ? <>+{Math.round(todayConsolidated.kcal - plan.kcal_target)} kcal sopra il target</>
                    : <>-{Math.round(plan.kcal_target - todayConsolidated.kcal)} kcal sotto il target</>}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

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
                <ComposedChart data={filtered}>
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
                  <Bar dataKey="kcal" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
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
