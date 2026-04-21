import { useMemo, useState } from "react"
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
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDiarioActivePlan, useDiarioDailyTotals } from "@/lib/queries"
import type { DiarioDailyTotal } from "@/lib/types"

function formatDateShort(iso: string): string {
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })
}

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function daysAgoLocalISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
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
        <div
          className="h-full transition-all"
          style={{
            width: `${capped}%`,
            background: pct > 110 ? "#ef4444" : pct > 100 ? "#f59e0b" : color,
          }}
        />
      </div>
      <p className="text-xs tabular-nums">
        <span className="font-medium">{value.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</span>
        <span className="text-muted-foreground"> / {target ? target.toLocaleString("it-IT") : "—"} {unit}</span>
      </p>
    </div>
  )
}

export function DiarioSection() {
  const [rangeDays, setRangeDays] = useState(30)

  const { data: plan, isLoading: planLoading, isError: planError, error: planErr } = useDiarioActivePlan()

  const from = daysAgoLocalISO(rangeDays - 1)
  const to = todayLocalISO()
  const { data: daily, isError: dailyError, error: dailyErr } = useDiarioDailyTotals(from, to)

  const dailyByDate = useMemo(() => {
    const m = new Map<string, DiarioDailyTotal>()
    ;(daily ?? []).forEach(d => m.set(d.date, d))
    return m
  }, [daily])

  const today = todayLocalISO()
  const todayEntry = dailyByDate.get(today) ?? null

  // Error states
  const planMissing = planError && (planErr as any)?.message?.includes("404")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Diario alimentare</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Regime alimentare quotidiano dal servizio <span className="font-mono">diario-alimentare</span>.
        </p>
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

      {/* Oggi */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Oggi</CardTitle>
        </CardHeader>
        <CardContent>
          {!todayEntry && (
            <p className="text-sm text-muted-foreground">Nessun pasto registrato oggi sul diario.</p>
          )}
          {todayEntry && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <ProgressBar value={todayEntry.kcal} target={plan?.kcal_target ?? todayEntry.kcal_target}
                  unit="kcal" label="Calorie" color="#8b5cf6" />
                <ProgressBar value={todayEntry.protein_g} target={plan?.protein_g}
                  unit="g" label="Proteine" color="#10b981" />
                <ProgressBar value={todayEntry.fat_g} target={plan?.fat_g}
                  unit="g" label="Grassi" color="#f59e0b" />
                <ProgressBar value={todayEntry.carbs_g} target={plan?.carbs_g}
                  unit="g" label="Carboidrati" color="#ef4444" />
              </div>
              {plan?.kcal_target && (
                <p className="text-xs text-muted-foreground mt-4 tabular-nums">
                  {todayEntry.kcal > plan.kcal_target
                    ? <>+{todayEntry.kcal - plan.kcal_target} kcal sopra il target</>
                    : <>-{plan.kcal_target - todayEntry.kcal} kcal sotto il target</>}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Trend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Storico</span>
            <div className="flex gap-1">
              {[7, 30, 90].map(d => (
                <Button key={d} size="sm"
                  variant={rangeDays === d ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setRangeDays(d)}>
                  {d}g
                </Button>
              ))}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyError && (
            <p className="text-sm text-destructive">Errore caricamento storico: {(dailyErr as Error)?.message}</p>
          )}
          {daily && daily.length === 0 && (
            <p className="text-sm text-muted-foreground py-8">Nessuna voce nel periodo.</p>
          )}
          {daily && daily.length > 0 && (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={daily}>
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
                    ]}
                  />
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
                    {[...daily].reverse().slice(0, 10).map(d => {
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
                {daily.length > 10 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Mostrati ultimi 10 giorni (totali {daily.length})
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
