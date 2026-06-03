import { useMemo } from "react"
import { Link } from "react-router-dom"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Info } from "lucide-react"
import { useLabCorrelations, useLabTimeseries } from "@/lib/queries"
import type {
  LabCorrelationCandidate,
  LabPlausibility,
} from "@/lib/types"
import { formatDate, cn } from "@/lib/utils"

export const CORR_DISCLAIMER =
  "Ipotesi generate automaticamente per coincidenza temporale, da verificare con un medico — non sono diagnosi né consigli medici."

// --- helper condivisi (riusati da home widget + card review) ---------------

export function plausibilityMeta(p: LabPlausibility | null | undefined): {
  label: string
  dot: string
  text: string
  badge: string
} {
  switch (p) {
    case "high":
      return { label: "alta", dot: "bg-red-500", text: "text-red-700 dark:text-red-300", badge: "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-200" }
    case "medium":
      return { label: "media", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", badge: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" }
    case "low":
      return { label: "bassa", dot: "bg-slate-400", text: "text-slate-600 dark:text-slate-300", badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" }
    default:
      return { label: "nessuna", dot: "bg-slate-300", text: "text-muted-foreground", badge: "bg-muted text-muted-foreground" }
  }
}

const CHANGE_LABELS: Record<string, string> = {
  started: "iniziato",
  stopped: "sospeso",
  dose_increase: "dose ↑",
  dose_decrease: "dose ↓",
  dose_changed: "dose cambiata",
  note_started: "comparsa",
  note_resolved: "risolta",
}

const KIND_LABELS: Record<string, string> = {
  medication: "Farmaco",
  supplement: "Integratore",
  diet: "Dieta",
  training: "Allenamento",
  gear: "Equipaggiamento",
  pain: "Dolore",
  illness: "Malattia",
  discomfort: "Fastidio",
  symptom: "Sintomo",
  other: "Nota",
}

export function factorSummary(c: LabCorrelationCandidate): string {
  const f = c.factor
  const change = CHANGE_LABELS[f.change_type] ?? f.change_type
  let dose = ""
  if (f.old_dose || f.new_dose) dose = ` (${f.old_dose ?? "?"} → ${f.new_dose ?? "?"})`
  return `${f.name} · ${change}${dose}`
}

function deltaLabel(c: LabCorrelationCandidate): string {
  const arrow = c.direction === "up" ? "↑" : c.direction === "down" ? "↓" : "→"
  const pct = c.rel_delta != null ? ` (${c.rel_delta >= 0 ? "+" : ""}${Math.round(c.rel_delta * 100)}%)` : ""
  const unit = c.unit ? ` ${c.unit}` : ""
  return `${c.prev_value} → ${c.cur_value}${unit} ${arrow}${pct}`
}

// --- mini grafico dell'andamento con banda intervallo + marker evento -------

function CorrelationChart({ c }: { c: LabCorrelationCandidate }) {
  const ts = useLabTimeseries(c.analyte_slug)
  const data = useMemo(() => {
    const pts = (ts.data?.points ?? [])
      .filter(p => p.value_numeric != null)
      .map(p => ({ x: new Date(p.test_date).getTime(), y: p.value_numeric as number }))
      .sort((a, b) => a.x - b.x)
    return pts
  }, [ts.data])

  if (data.length < 2) return null
  const prevX = new Date(c.prev_date).getTime()
  const curX = new Date(c.cur_date).getTime()
  const eventX = new Date(c.factor.event_date).getTime()

  return (
    <div className="h-40 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="x"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => formatDate(new Date(v).toISOString())}
            tick={{ fontSize: 10 }}
            minTickGap={40}
          />
          <YAxis tick={{ fontSize: 10 }} width={36} domain={["auto", "auto"]} />
          {c.ref_low != null && c.ref_high != null && (
            <ReferenceArea
              y1={c.ref_low}
              y2={c.ref_high}
              fill="#10b981"
              fillOpacity={0.07}
              ifOverflow="extendDomain"
            />
          )}
          <ReferenceArea
            x1={prevX}
            x2={curX}
            fill="#f59e0b"
            fillOpacity={0.14}
            stroke="#d97706"
            strokeOpacity={0.3}
            strokeDasharray="2 2"
            ifOverflow="visible"
          />
          <ReferenceLine
            x={eventX}
            stroke="#6366f1"
            strokeDasharray="4 2"
            ifOverflow="visible"
            label={{ value: factorChangeShort(c), position: "top", fontSize: 9, fill: "#6366f1" }}
          />
          <Tooltip
            labelFormatter={(v) => formatDate(new Date(v as number).toISOString())}
            formatter={(v: any) => [`${v} ${c.unit ?? ""}`, c.analyte_name]}
          />
          <Line type="monotone" dataKey="y" stroke="#3b82f6" dot={{ r: 2 }} strokeWidth={2} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function factorChangeShort(c: LabCorrelationCandidate): string {
  return CHANGE_LABELS[c.factor.change_type] ?? c.factor.change_type
}

// --- card completa (tab Correlazioni) --------------------------------------

export function CorrelationCard({ c, showChart = true }: { c: LabCorrelationCandidate; showChart?: boolean }) {
  const ann = c.annotation
  const meta = plausibilityMeta(ann.status === "done" ? ann.plausibility : undefined)
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/lab/panels/${c.cur_panel_id}/review`}
              className="font-medium hover:underline"
            >
              {c.analyte_name}
            </Link>
            <span className="text-xs text-muted-foreground">{c.analyte_category}</span>
            {ann.is_known_association && (
              <span className="text-[10px] rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200 px-2 py-0.5">
                associazione nota
              </span>
            )}
          </div>
          <div className="text-sm font-mono mt-0.5">{deltaLabel(c)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatDate(c.prev_date)} → {formatDate(c.cur_date)}
          </div>
          <div className="text-sm mt-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">
              {KIND_LABELS[c.factor.kind] ?? c.factor.kind}
            </span>
            {factorSummary(c)}
            <span className="text-xs text-muted-foreground"> · {formatDate(c.factor.event_date)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {ann.status === "pending" ? (
            <span className="text-xs text-muted-foreground italic">analisi in corso…</span>
          ) : ann.status === "failed" ? (
            <span className="text-xs text-muted-foreground italic">IA n/d</span>
          ) : (
            <span className={cn("text-xs rounded-full px-2 py-0.5 inline-flex items-center gap-1", meta.badge)}>
              <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
              plausibilità {meta.label}
            </span>
          )}
        </div>
      </div>

      {ann.status === "done" && ann.mechanism_text && (
        <p className={cn("text-xs mt-2 leading-relaxed", meta.text)}>{ann.mechanism_text}</p>
      )}

      {showChart && <CorrelationChart c={c} />}
    </div>
  )
}

// --- tab Correlazioni -------------------------------------------------------

export default function LabCorrelations() {
  const { data, isLoading } = useLabCorrelations()
  const candidates = data?.candidates ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 text-blue-900 px-3 py-2 text-xs dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-200">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{CORR_DISCLAIMER}</span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nessuna associazione rilevata: servono almeno due referti confermati con
          una variazione marcata di un analita in concomitanza con un evento di
          regime o nota di salute.
        </p>
      ) : (
        <div className="space-y-3">
          {candidates.map(c => (
            <CorrelationCard key={c.signature} c={c} />
          ))}
        </div>
      )}
    </div>
  )
}
