import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useStretchingSessions } from "@/lib/queries"
import type { StretchingSession } from "@/lib/types"
import { formatDateTime as utilFormatDateTime, formatDateShort, formatDateLong } from "@/lib/utils"

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function daysAgoISO(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// YYYY-MM-DD in local time for a given ISO datetime string
function localDayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDateTime(iso: string): string {
  return utilFormatDateTime(iso)
}

interface Stats {
  count: number
  totalSec: number
  currentStreak: number
  maxStreak: number
}

function computeStats(sessions: StretchingSession[]): Stats {
  const count = sessions.length
  const totalSec = sessions.reduce((s, x) => s + (x.duration_sec || 0), 0)

  // Unique local days sorted ascending
  const days = Array.from(new Set(sessions.map(x => localDayKey(x.started_at)))).sort()
  if (days.length === 0) return { count, totalSec, currentStreak: 0, maxStreak: 0 }

  // Longest consecutive run
  let maxStreak = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1] + "T00:00:00")
    const curr = new Date(days[i] + "T00:00:00")
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000)
    if (diffDays === 1) {
      run += 1
      if (run > maxStreak) maxStreak = run
    } else {
      run = 1
    }
  }

  // Current streak: ends today or yesterday, counted backwards
  const today = todayLocalISO()
  const yesterday = daysAgoISO(1)
  let currentStreak = 0
  const lastDay = days[days.length - 1]
  if (lastDay === today || lastDay === yesterday) {
    currentStreak = 1
    for (let i = days.length - 2; i >= 0; i--) {
      const a = new Date(days[i] + "T00:00:00")
      const b = new Date(days[i + 1] + "T00:00:00")
      if (Math.round((b.getTime() - a.getTime()) / 86_400_000) === 1) currentStreak += 1
      else break
    }
  }

  return { count, totalSec, currentStreak, maxStreak }
}

interface DailyPoint {
  date: string       // YYYY-MM-DD local
  minutes: number    // rounded to 1 decimal
  sessions: number
}

// Build a day-by-day series across [from, to] inclusive, filling gaps with 0.
function buildDailySeries(sessions: StretchingSession[], from: string, to: string): DailyPoint[] {
  const byDay = new Map<string, { sec: number; count: number }>()
  for (const s of sessions) {
    const key = localDayKey(s.started_at)
    const cur = byDay.get(key) ?? { sec: 0, count: 0 }
    cur.sec += s.duration_sec || 0
    cur.count += 1
    byDay.set(key, cur)
  }
  const out: DailyPoint[] = []
  const start = new Date(from + "T00:00:00")
  const end = new Date(to + "T00:00:00")
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return out
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const v = byDay.get(key)
    out.push({
      date: key,
      minutes: v ? Math.round((v.sec / 60) * 10) / 10 : 0,
      sessions: v ? v.count : 0,
    })
  }
  return out
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-3xl font-bold mt-1">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  )
}

export default function Stretching() {
  const [from, setFrom] = useState<string>(daysAgoISO(30))
  const [to, setTo] = useState<string>(todayLocalISO())

  const { data, isLoading, error } = useStretchingSessions(from, to)
  const sessions = useMemo(() => data ?? [], [data])

  const stats = useMemo(() => computeStats(sessions), [sessions])
  const dailySeries = useMemo(() => buildDailySeries(sessions, from, to), [sessions, from, to])

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [sessions]
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Stretching</h1>
        <p className="text-muted-foreground">
          Sessioni di stretching registrate dall'app PWA.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Periodo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label htmlFor="from">Da</Label>
            <Input id="from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">A</Label>
            <Input id="to" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Sessioni" value={String(stats.count)} />
        <StatCard label="Tempo totale" value={formatDuration(stats.totalSec)} />
        <StatCard label="Streak corrente" value={`${stats.currentStreak} gg`} hint="giorni consecutivi fino a oggi" />
        <StatCard label="Streak max" value={`${stats.maxStreak} gg`} hint="nel periodo selezionato" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Minuti per giorno</CardTitle>
        </CardHeader>
        <CardContent>
          {dailySeries.length === 0 ? (
            <p className="text-muted-foreground">Range non valido.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dailySeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={s => formatDateShort(s)}
                  minTickGap={30}
                />
                <YAxis tick={{ fontSize: 11 }} label={{ value: "min", angle: -90, position: "insideLeft", fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(label) => formatDateLong(label as string)}
                  formatter={(v: any, name: any, entry: any) => {
                    if (name === "minutes") {
                      const sessCount = entry?.payload?.sessions ?? 0
                      return [`${v} min (${sessCount} ses.)`, "Stretching"]
                    }
                    return [v, name]
                  }}
                />
                <Bar dataKey="minutes" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessioni ({sorted.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-muted-foreground">Caricamento…</p>}
          {error && <p className="text-destructive">Errore: {String(error)}</p>}
          {!isLoading && !error && sorted.length === 0 && (
            <p className="text-muted-foreground">Nessuna sessione nel periodo selezionato.</p>
          )}
          {sorted.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Ora</TableHead>
                  <TableHead>Routine</TableHead>
                  <TableHead>Durata</TableHead>
                  <TableHead>Completati</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(s => {
                  const done = s.items_total - s.items_skipped
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="whitespace-nowrap">{formatDateTime(s.started_at)}</TableCell>
                      <TableCell>{s.routine_name}</TableCell>
                      <TableCell>{formatDuration(s.duration_sec)}</TableCell>
                      <TableCell>
                        {done}/{s.items_total}
                        {s.items_skipped > 0 && (
                          <span className="text-muted-foreground"> ({s.items_skipped} saltati)</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {s.notes ?? ""}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        I dati mostrati sono a scopo informativo e non costituiscono consigli medici.
      </p>
    </div>
  )
}
