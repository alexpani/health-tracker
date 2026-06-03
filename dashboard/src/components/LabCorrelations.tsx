import { useEffect, useMemo, useState } from "react"
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
import { Check, Info, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useDismissCorrelation, useLabCorrelations, useLabTimeseries } from "@/lib/queries"
import type {
  LabCorrelationCandidate,
  LabPlausibility,
} from "@/lib/types"
import { formatDate, cn } from "@/lib/utils"

export const CORR_DISCLAIMER =
  "Ipotesi generate automaticamente per coincidenza temporale, da verificare con un medico — non sono diagnosi né consigli medici."

/** Indicatore di attività IA in corso nella sezione Laboratorio: si accende
 * quando ci sono annotazioni di correlazione ancora in elaborazione
 * (`status: "pending"`). Riusa il polling già attivo di useLabCorrelations. */
export function LabAiActivityBadge() {
  const { data } = useLabCorrelations()
  const pending = (data?.candidates ?? []).filter(
    c => c.annotation?.status === "pending"
  ).length
  if (pending === 0) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200 px-2.5 py-1 text-xs"
      title={`L'IA sta analizzando ${pending} possibili correlazioni`}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      IA: analisi di {pending} correlazion{pending === 1 ? "e" : "i"} in corso…
    </span>
  )
}

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
  const dismiss = useDismissCorrelation()
  return (
    <div className={cn("rounded-lg border p-3", c.dismissed && "opacity-60")}>
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
        <div className="shrink-0 text-right flex flex-col items-end gap-1.5">
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
          <button
            type="button"
            onClick={() => dismiss.mutate({ signature: c.signature, dismissed: !c.dismissed })}
            disabled={dismiss.isPending}
            className={cn(
              "inline-flex items-center gap-1 text-xs rounded-md border px-1.5 py-0.5 transition-colors",
              c.dismissed
                ? "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-input text-muted-foreground hover:bg-muted"
            )}
            title={c.dismissed
              ? "Vista: nascosta dal widget in home. Click per ripristinarla."
              : "Segna come vista: la toglie dal widget in home"}
          >
            <Check className="h-3.5 w-3.5" />
            {c.dismissed ? "vista" : "segna come vista"}
          </button>
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

interface CorrFilters {
  year: string // "all" | "2024" | ...
  analyte: string // "all" | slug
  plausibility: "all" | "high" | "medium"
}

const EMPTY_CORR_FILTERS: CorrFilters = { year: "all", analyte: "all", plausibility: "all" }
const CORR_FILTERS_KEY = "lab_correlations_filters_v1"

export default function LabCorrelations() {
  const { data, isLoading } = useLabCorrelations()
  const candidates = data?.candidates ?? []

  const [filters, setFilters] = useState<CorrFilters>(() => {
    try {
      const raw = sessionStorage.getItem(CORR_FILTERS_KEY)
      if (raw) return { ...EMPTY_CORR_FILTERS, ...JSON.parse(raw) }
    } catch {
      // ignore
    }
    return EMPTY_CORR_FILTERS
  })
  useEffect(() => {
    sessionStorage.setItem(CORR_FILTERS_KEY, JSON.stringify(filters))
  }, [filters])

  // Opzioni derivate dalle candidate disponibili.
  const years = useMemo(() => {
    const s = new Set<string>()
    candidates.forEach(c => s.add(c.cur_date.slice(0, 4)))
    return Array.from(s).sort((a, b) => b.localeCompare(a))
  }, [candidates])

  const analytes = useMemo(() => {
    const m = new Map<string, string>()
    candidates.forEach(c => m.set(c.analyte_slug, c.analyte_name))
    return Array.from(m.entries())
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "it"))
  }, [candidates])

  const filtered = useMemo(() => {
    return candidates
      .filter(c => {
        if (filters.year !== "all" && c.cur_date.slice(0, 4) !== filters.year) return false
        if (filters.analyte !== "all" && c.analyte_slug !== filters.analyte) return false
        if (filters.plausibility !== "all") {
          if (c.annotation.status !== "done") return false
          if (c.annotation.plausibility !== filters.plausibility) return false
        }
        return true
      })
      // Ordine cronologico discendente (più recenti in cima); a parità di data
      // il punteggio di rilevanza fa da spareggio.
      .sort((a, b) => b.cur_date.localeCompare(a.cur_date) || b.score - a.score)
  }, [candidates, filters])

  const anyFilter =
    filters.year !== "all" || filters.analyte !== "all" || filters.plausibility !== "all"

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 text-blue-900 px-3 py-2 text-xs dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-200">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <span>{CORR_DISCLAIMER}</span>
      </div>

      {candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Anno */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-1">Anno:</span>
            <FilterChip active={filters.year === "all"} onClick={() => setFilters(f => ({ ...f, year: "all" }))}>
              Tutti
            </FilterChip>
            {years.map(y => (
              <FilterChip key={y} active={filters.year === y} onClick={() => setFilters(f => ({ ...f, year: y }))}>
                {y}
              </FilterChip>
            ))}
          </div>

          {/* Plausibilità */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-1">Plausibilità:</span>
            {([["all", "Tutte"], ["high", "Alta"], ["medium", "Media"]] as const).map(([v, label]) => (
              <FilterChip
                key={v}
                active={filters.plausibility === v}
                onClick={() => setFilters(f => ({ ...f, plausibility: v }))}
              >
                {label}
              </FilterChip>
            ))}
          </div>

          {/* Analita */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-1">Analita:</span>
            <Select
              value={filters.analyte}
              onValueChange={v => setFilters(f => ({ ...f, analyte: v }))}
            >
              <SelectTrigger className="h-8 w-56 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                {analytes.map(a => (
                  <SelectItem key={a.slug} value={a.slug}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {anyFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setFilters(EMPTY_CORR_FILTERS)}
            >
              Azzera filtri
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} di {candidates.length}
          </span>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nessuna associazione rilevata: servono almeno due referti confermati con
          una variazione marcata di un analita in concomitanza con un evento di
          regime o nota di salute.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nessuna correlazione coi filtri attivi.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map(c => (
            <CorrelationCard key={c.signature} c={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-input hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}
