import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { TimeRangeSelector, timeRangeToDates } from "@/components/controls/TimeRangeSelector"
import { useCategories } from "@/lib/queries"
import { SLEEP_STAGES } from "@/lib/healthkit"
import { formatDate, formatDateShort } from "@/lib/utils"
import { Hypnogram } from "@/components/charts/Hypnogram"
import { SleepScoreCard } from "@/components/charts/SleepScoreCard"
import { computeSleepScore, sleepNarrative, type SleepScoreResult } from "@/lib/sleepScore"
import { Link } from "react-router-dom"
import type { TimeRange } from "@/lib/types"

function fmtDur(m: number): string {
  const h = Math.floor(m / 60)
  const mm = Math.round(m % 60)
  return h > 0 ? `${h}h ${mm.toString().padStart(2, "0")}m` : `${mm} min`
}

/** Riassunto fasi della notte selezionata: stesse righe del tooltip, ma
 *  permanenti nella card dell'ipnogramma. */
function SelectedNightBreakdown({
  ymd,
  chartData,
}: {
  ymd: string
  chartData: Record<string, any>[]
}) {
  const row = chartData.find(d => {
    const dt = new Date(String(d.day))
    const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
    return k === ymd
  })
  if (!row) {
    return (
      <p className="text-xs text-muted-foreground">Nessun totale per questa notte.</p>
    )
  }
  // Riusiamo la stessa logica del tooltip: fasi 2-5, totale = somma visibile.
  const stages = [SLEEP_STAGES[2], SLEEP_STAGES[3], SLEEP_STAGES[4], SLEEP_STAGES[5]]
  const present = stages
    .map(s => ({ label: s.label, color: s.color, v: Number(row[s.label]) || 0 }))
    .filter(x => x.v > 0)
  const inBed = present.reduce((a, b) => a + b.v, 0)
  const asleepLabels = [SLEEP_STAGES[3].label, SLEEP_STAGES[4].label, SLEEP_STAGES[5].label]
  const asleep = present.filter(p => asleepLabels.includes(p.label)).reduce((a, b) => a + b.v, 0)
  const pct = (v: number) => (inBed > 0 ? Math.round((v / inBed) * 100) : 0)

  return (
    <div className="text-sm space-y-1">
      {present.map(p => (
        <div key={p.label} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label}
          </span>
          <span className="tabular-nums">
            {fmtDur(p.v)} <span className="text-muted-foreground">({pct(p.v)}%)</span>
          </span>
        </div>
      ))}
      <div className="mt-2 pt-2 border-t space-y-1">
        <div className="flex items-center justify-between font-medium">
          <span>Dormito</span>
          <span className="tabular-nums">{fmtDur(asleep)}</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          <span>A letto</span>
          <span className="tabular-nums">{fmtDur(inBed)}</span>
        </div>
      </div>
    </div>
  )
}

/** Commento discorsivo sulla notte selezionata: come e' andata, punti di
 *  forza e criticita'. Riusa la stessa finestra/dati di SleepScoreCard. */
function SleepComment({ date }: { date: string }) {
  const window = useMemo(() => {
    const [y, m, d] = date.split("-").map(Number)
    const start = new Date(y, m - 1, d - 1, 16, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 1)
    return { startIso: start.toISOString(), endIso: end.toISOString() }
  }, [date])

  const q = useCategories(
    "HKCategoryTypeIdentifierSleepAnalysis",
    window.startIso,
    window.endIso,
  )
  const result = useMemo(() => computeSleepScore(q.data ?? []), [q.data])

  if (q.isLoading || !result) return null

  return (
    <div className="rounded-md border-l-4 border-l-primary bg-muted/40 px-3 py-2 text-sm">
      <p className="font-medium text-muted-foreground mb-0.5">Com'e' andata</p>
      <p className="leading-relaxed">{sleepNarrative(result)}</p>
    </div>
  )
}

/** Leggenda collassabile che spiega le fasi del sonno. */
function SleepLegend() {
  const items: { label: string; color: string; desc: string }[] = [
    {
      label: SLEEP_STAGES[2].label,
      color: SLEEP_STAGES[2].color,
      desc: "Brevi risvegli durante la notte. Sono normali; contano nel tempo \"a letto\" ma non nel \"dormito\".",
    },
    {
      label: SLEEP_STAGES[3].label,
      color: SLEEP_STAGES[3].color,
      desc: "Sonno leggero (Core). La fase piu' lunga della notte, di transizione e consolidamento.",
    },
    {
      label: SLEEP_STAGES[4].label,
      color: SLEEP_STAGES[4].color,
      desc: "Sonno profondo. Recupero fisico, rilascio dell'ormone della crescita; concentrato nelle prime ore.",
    },
    {
      label: SLEEP_STAGES[5].label,
      color: SLEEP_STAGES[5].color,
      desc: "Sonno REM. Sogni vividi, consolidamento della memoria; piu' frequente verso il mattino.",
    },
  ]
  return (
    <details className="text-sm rounded-md border bg-muted/30 px-3 py-2">
      <summary className="cursor-pointer font-medium text-muted-foreground select-none">
        Cosa significano le fasi?
      </summary>
      <div className="mt-2 space-y-2">
        {items.map(it => (
          <div key={it.label} className="flex gap-2">
            <span
              className="mt-1 inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ background: it.color }}
            />
            <span>
              <span className="font-medium">{it.label}</span>
              <span className="text-muted-foreground"> — {it.desc}</span>
            </span>
          </div>
        ))}
        <div className="pt-2 border-t text-muted-foreground space-y-1">
          <div>
            <span className="font-medium text-foreground">Dormito</span> — somma di
            Principale, Profondo e REM (esclude la Veglia).
          </div>
          <div>
            <span className="font-medium text-foreground">A letto</span> — tempo totale
            registrato, incluse le fasi di veglia.
          </div>
        </div>
      </div>
    </details>
  )
}

/** Tooltip custom: mostra le singole fasi + totale "Dormito" (Core+Deep+REM,
 *  esclude Sveglio) e "A letto" (somma di tutte le fasi visibili). */
function SleepTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null
  const asleepLabels = [SLEEP_STAGES[3].label, SLEEP_STAGES[4].label, SLEEP_STAGES[5].label]
  let asleep = 0
  let inBed = 0
  for (const p of payload) {
    const v = Number(p.value) || 0
    inBed += v
    if (asleepLabels.includes(p.name)) asleep += v
  }
  const score: SleepScoreResult | null = payload[0]?.payload?.__score ?? null
  // Percentuali sul totale visibile della barra (somma fasi 2-5 = inBed).
  const pct = (v: number) => (inBed > 0 ? Math.round((v / inBed) * 100) : 0)
  return (
    <div
      className="rounded-md border bg-card text-card-foreground shadow-md p-3 text-sm"
      style={{ minWidth: 220 }}
    >
      <div className="font-medium mb-2">{label ? formatDate(String(label)) : ""}</div>
      <div className="space-y-1">
        {payload.map((p: any) => {
          const v = Number(p.value) || 0
          return (
            <div key={p.name} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
                {p.name}
              </span>
              <span className="tabular-nums">
                {fmtDur(v)} <span className="text-muted-foreground">({pct(v)}%)</span>
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 pt-2 border-t space-y-1">
        <div className="flex items-center justify-between font-medium">
          <span>Dormito</span>
          <span className="tabular-nums">{fmtDur(asleep)}</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          <span>A letto</span>
          <span className="tabular-nums">{fmtDur(inBed)}</span>
        </div>
      </div>
      {score && (
        <div className="mt-2 pt-2 border-t flex items-center justify-between">
          <span className="font-medium">Valutazione</span>
          <span className="tabular-nums">
            <span className={`font-semibold ${score.color}`}>{score.score}</span>
            <span className="text-muted-foreground">/100 · {score.label}</span>
          </span>
        </div>
      )}
    </div>
  )
}

export default function Sleep() {
  const [range, setRange] = useState<TimeRange>("30d")
  const [selectedYmd, setSelectedYmd] = useState<string | null>(null)
  const dates = useMemo(() => timeRangeToDates(range), [range])
  const { data, isLoading } = useCategories("HKCategoryTypeIdentifierSleepAnalysis", dates.start, dates.end)

  // Aggregate per night. Convenzione "wake-up date": la notte appartiene
  // al giorno in cui ti sei svegliato, cioe' la data di end_date.
  const byNight: Record<string, Record<number, number>> = {}
  const samplesByNight: Record<string, typeof data> = {}
  ;(data ?? []).forEach(s => {
    const start = new Date(s.start_date)
    const end = new Date(s.end_date)
    const durationMinutes = (end.getTime() - start.getTime()) / 60_000
    const nightDate = new Date(end.getFullYear(), end.getMonth(), end.getDate())
    const nightKey = nightDate.toISOString()
    if (!byNight[nightKey]) byNight[nightKey] = {}
    byNight[nightKey][s.value] = (byNight[nightKey][s.value] || 0) + durationMinutes
    if (!samplesByNight[nightKey]) samplesByNight[nightKey] = []
    samplesByNight[nightKey]!.push(s)
  })

  const chartData = Object.entries(byNight)
    .map(([day, stages]) => {
      const row: any = { day }
      Object.entries(SLEEP_STAGES).forEach(([k, v]) => {
        row[v.label] = stages[Number(k)] || 0
      })
      row.__score = computeSleepScore(samplesByNight[day] ?? [])
      return row
    })
    .sort((a, b) => (a.day < b.day ? -1 : 1))

  // Stage 0 ("A letto") e 1 ("Addormentato non specificato") sono
  // wrapper che coprono l'intera notte: Apple Salute li sovrascrive coi
  // sample dettagliati Core/Deep/REM/Sveglio. Sommarli nel chart e' un
  // double-count, quindi vengono sempre nascosti. Le fasi 2-5 sono
  // mostrate solo se hanno almeno un valore > 0 nel periodo.
  const visibleStages = Object.entries(SLEEP_STAGES)
    .filter(([k, v]) => {
      const stageId = Number(k)
      if (stageId === 0 || stageId === 1) return false
      return chartData.some(d => (d[v.label] || 0) > 0)
    })
    .map(([, v]) => v)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Sonno</h1>
        <p className="text-muted-foreground">Fasi del sonno notturno</p>
      </div>

      <div className="flex gap-2">
        <TimeRangeSelector value={range} onChange={setRange} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fasi del sonno per notte (minuti)</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="h-80 animate-pulse bg-muted rounded" />}
          {!isLoading && chartData.length === 0 && (
            <p className="text-muted-foreground">Nessun dato di sonno nel periodo selezionato</p>
          )}
          {!isLoading && chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={380}>
              <BarChart
                data={chartData}
                onClick={(e: any) => {
                  const iso: string | undefined = e?.activePayload?.[0]?.payload?.day ?? e?.activeLabel
                  if (!iso) return
                  // iso e' un toISOString() costruito da una Date locale a
                  // mezzanotte → ricostruisco YYYY-MM-DD in fuso locale.
                  const d = new Date(iso)
                  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                  setSelectedYmd(prev => (prev === ymd ? null : ymd))
                }}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="day"
                  tickFormatter={v => formatDateShort(v)}
                  tick={{ fontSize: 11 }}
                  minTickGap={20}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  content={<SleepTooltip />}
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                />
                <Legend />
                {visibleStages.map(stage => (
                  <Bar key={stage.label} dataKey={stage.label} stackId="sleep" fill={stage.color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {selectedYmd && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base">
              Andamento notte · {formatDate(selectedYmd)}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Link
                to={`/day/${selectedYmd}`}
                className="text-xs text-muted-foreground hover:underline"
              >
                vedi giorno
              </Link>
              <Button variant="ghost" size="sm" onClick={() => setSelectedYmd(null)}>
                Chiudi
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Hypnogram date={selectedYmd} height={80} showEmpty />
            <SleepComment date={selectedYmd} />
            <SelectedNightBreakdown ymd={selectedYmd} chartData={chartData} />
            <SleepLegend />
            <SleepScoreCard date={selectedYmd} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
