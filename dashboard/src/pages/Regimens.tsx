import { useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useDiarioActivePlan, useRegimens } from "@/lib/queries"
import type { Regimen, RegimenKind } from "@/lib/types"
import { KIND_LABELS, RegimenForm } from "@/components/RegimenForm"
import { RegimenTimeline } from "@/components/RegimenTimeline"

const KIND_ORDER: RegimenKind[] = ["medication", "supplement", "diet", "training", "gear"]

function isOngoing(r: Regimen): boolean {
  if (r.end_date == null) return true
  // R is "active today" if end_date >= today
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  return r.end_date >= todayIso
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })
}

export default function Regimens() {
  const [viewMode, setViewMode] = useState<'timeline' | 'table'>('timeline')
  const [kindFilter, setKindFilter] = useState<RegimenKind | null>(null)
  const [includeEnded, setIncludeEnded] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Regimen | null>(null)

  const q = useRegimens({
    kind: kindFilter ?? undefined,
    include_ended: includeEnded,
  })

  // Piano alimentare attivo dal diario alimentare. Lo iniettamo come Regimen
  // sintetico (id=-1, source='diario') in modo che la pagina /regimens
  // mostri sotto "Piano alimentare" lo stesso piano che la /day/:date
  // riconosce. Read-only — l'editing avviene nel diario.
  const dietQ = useDiarioActivePlan()
  const dietPlanRegimen = useMemo<Regimen | null>(() => {
    if (!dietQ.data) return null
    const p = dietQ.data
    const dose: string[] = []
    if (p.kcal_target != null) dose.push(`${Math.round(p.kcal_target)} kcal/die`)
    if (p.protein_g != null) dose.push(`P ${Math.round(p.protein_g)}g`)
    if (p.fat_g != null) dose.push(`F ${Math.round(p.fat_g)}g`)
    if (p.carbs_g != null) dose.push(`C ${Math.round(p.carbs_g)}g`)
    return {
      id: -1,
      kind: "diet",
      name: p.name,
      start_date: null,
      end_date: null,
      dose: dose.join(" · ") || null,
      notes: "Sincronizzato dal diario alimentare. Modifica nel diario.",
      source: "diario",
      created_at: p.updated_at ?? "",
      updated_at: p.updated_at ?? "",
    }
  }, [dietQ.data])

  const grouped = useMemo(() => {
    const out: Record<"ongoing" | "ended", Regimen[]> = { ongoing: [], ended: [] }
    for (const r of q.data ?? []) {
      ;(isOngoing(r) ? out.ongoing : out.ended).push(r)
    }
    // Inietto il piano del diario in cima alla sezione "ongoing" (e' attivo
    // per definizione: il diario espone solo il piano corrente). Solo se
    // il filtro kindFilter consente "diet" (null = tutti, o "diet").
    if (dietPlanRegimen && (kindFilter === null || kindFilter === "diet")) {
      out.ongoing.unshift(dietPlanRegimen)
    }
    return out
  }, [q.data, dietPlanRegimen, kindFilter])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Regimi</h1>
          <p className="text-muted-foreground">Farmaci, integratori, piani alimentari, piani di allenamento</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowAdd(true) }}>
          <Plus className="h-4 w-4 mr-1" /> Nuovo
        </Button>
      </div>

      {/* Timeline/Table view toggle */}
      <div className="flex gap-2">
        <Button
          variant={viewMode === 'timeline' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setViewMode('timeline')}
        >
          Timeline
        </Button>
        <Button
          variant={viewMode === 'table' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setViewMode('table')}
        >
          Tabella
        </Button>
      </div>

      {/* Timeline view */}
      {viewMode === 'timeline' && (
        <>
          <RegimenTimeline
            regimens={q.data ?? []}
            isLoading={q.isLoading}
            onRegimensChange={() => q.refetch()}
          />
          {q.isLoading && <div className="h-32 animate-pulse bg-muted rounded" />}
          {q.data && q.data.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nessun regime registrato. Premi <strong>Nuovo</strong> per aggiungerne uno.
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Table view */}
      {viewMode === 'table' && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant={kindFilter === null ? "default" : "outline"} size="sm" onClick={() => setKindFilter(null)}>
              Tutti
            </Button>
            {KIND_ORDER.map(k => (
              <Button
                key={k}
                variant={kindFilter === k ? "default" : "outline"}
                size="sm"
                onClick={() => setKindFilter(k)}
              >
                {KIND_LABELS[k]}
              </Button>
            ))}
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeEnded} onChange={e => setIncludeEnded(e.target.checked)} />
              Mostra terminati
            </label>
          </div>

          <Section title="In corso" items={grouped.ongoing} onEdit={r => { setShowAdd(false); setEditing(r) }} />
          {includeEnded && grouped.ended.length > 0 && (
            <Section title="Terminati" items={grouped.ended} onEdit={r => { setShowAdd(false); setEditing(r) }} />
          )}

          {q.isLoading && <div className="h-32 animate-pulse bg-muted rounded" />}
          {q.data && q.data.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nessun regime registrato. Premi <strong>Nuovo</strong> per aggiungerne uno.
              </CardContent>
            </Card>
          )}
        </>
      )}

      {(showAdd || editing) && (
        <RegimenForm
          regimen={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function Section({ title, items, onEdit }: { title: string; items: Regimen[]; onEdit: (r: Regimen) => void }) {
  if (items.length === 0) return null
  // group by kind within section
  const byKind: Record<RegimenKind, Regimen[]> = { medication: [], supplement: [], diet: [], training: [], gear: [] }
  for (const r of items) byKind[r.kind].push(r)

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title} ({items.length})</h2>
      {KIND_ORDER.map(kind => byKind[kind].length > 0 && (
        <Card key={kind}>
          <CardHeader>
            <CardTitle className="text-base">{KIND_LABELS[kind]}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Nome</th>
                  <th className="text-left p-3 hidden md:table-cell">Dose</th>
                  <th className="text-left p-3">Periodo</th>
                  <th className="text-left p-3 hidden lg:table-cell">Note</th>
                  <th className="p-3 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {byKind[kind].map(r => {
                  const fromDiario = r.source === "diario"
                  return (
                    <tr key={r.id} className="border-t hover:bg-accent/40">
                      <td className="p-3 font-medium">
                        {r.name}
                        {r.source === "lab_backfill" && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            da lab
                          </span>
                        )}
                        {fromDiario && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                            dal diario
                          </span>
                        )}
                      </td>
                      <td className="p-3 hidden md:table-cell">{r.dose ?? "—"}</td>
                      <td className="p-3 tabular-nums whitespace-nowrap">
                        {fromDiario
                          ? <em className="text-emerald-600">in corso</em>
                          : <>{fmtDate(r.start_date)} → {r.end_date ? fmtDate(r.end_date) : <em className="text-emerald-600">in corso</em>}</>}
                      </td>
                      <td className="p-3 hidden lg:table-cell text-muted-foreground line-clamp-2 max-w-xs">
                        {r.notes ?? ""}
                      </td>
                      <td className="p-3 text-right">
                        {fromDiario ? (
                          <span className="text-xs text-muted-foreground">solo lettura</span>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => onEdit(r)}>
                            Modifica
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
