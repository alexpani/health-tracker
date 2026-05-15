import { useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useDiarioActivePlan, useRegimens } from "@/lib/queries"
import type { Regimen, RegimenKind } from "@/lib/types"
import { KIND_LABELS, RegimenForm } from "@/components/RegimenForm"
import { RegimenTimeline } from "@/components/RegimenTimeline"
import { formatPeriodDuration } from "@/lib/duration"

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
  // Filtri kind multi-select indipendenti. Set vuoto = "Tutti" (nessun
  // filtro, mostra tutto). Set con uno o piu' kind = mostra solo quelli.
  // Filtro applicato client-side (i regimi sono pochi — decine — quindi
  // fetcho tutto e filtro qui invece di duplicare le call al backend).
  const [selectedKinds, setSelectedKinds] = useState<Set<RegimenKind>>(new Set())
  const [includeEnded, setIncludeEnded] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Regimen | null>(null)

  const q = useRegimens({
    include_ended: includeEnded,
  })

  const toggleKind = (k: RegimenKind) => {
    setSelectedKinds(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  // Quando si passa a Timeline e "diet" e' nel set (non e' rappresentato
  // nella Timeline), lo rimuoviamo per evitare confusione.
  useEffect(() => {
    if (viewMode === 'timeline' && selectedKinds.has('diet')) {
      setSelectedKinds(prev => {
        const next = new Set(prev)
        next.delete('diet')
        return next
      })
    }
  }, [viewMode, selectedKinds])

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
      metadata: null,
      created_at: p.updated_at ?? "",
      updated_at: p.updated_at ?? "",
    }
  }, [dietQ.data])

  // Applica il filtro multi-kind. Set vuoto = nessun filtro.
  const filteredRegimens = useMemo(() => {
    const all = q.data ?? []
    if (selectedKinds.size === 0) return all
    return all.filter(r => selectedKinds.has(r.kind as RegimenKind))
  }, [q.data, selectedKinds])

  const grouped = useMemo(() => {
    const out: Record<"ongoing" | "ended", Regimen[]> = { ongoing: [], ended: [] }
    for (const r of filteredRegimens) {
      ;(isOngoing(r) ? out.ongoing : out.ended).push(r)
    }
    // Inietto il piano del diario in cima alla sezione "ongoing" (e' attivo
    // per definizione: il diario espone solo il piano corrente). Solo se
    // il filtro consente "diet" (set vuoto = tutti, o set che contiene "diet").
    if (dietPlanRegimen && (selectedKinds.size === 0 || selectedKinds.has("diet"))) {
      out.ongoing.unshift(dietPlanRegimen)
    }
    return out
  }, [filteredRegimens, dietPlanRegimen, selectedKinds])

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

      {/* Filtri kind multi-select indipendenti, condivisi fra Timeline e
          Tabella. "Tutti" = set vuoto; click su un chip kind lo aggiunge
          o lo rimuove dal set. */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={selectedKinds.size === 0 ? "default" : "outline"}
          size="sm"
          onClick={() => setSelectedKinds(new Set())}
        >
          Tutti
        </Button>
        {KIND_ORDER.map(k => {
          // "Piano alimentare" non e' visualizzato nella Timeline
          if (viewMode === 'timeline' && k === 'diet') return null
          const isOn = selectedKinds.has(k)
          return (
            <Button
              key={k}
              variant={isOn ? "default" : "outline"}
              size="sm"
              onClick={() => toggleKind(k)}
            >
              {KIND_LABELS[k]}
            </Button>
          )
        })}
        {viewMode === 'table' && (
          <>
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeEnded} onChange={e => setIncludeEnded(e.target.checked)} />
              Mostra terminati
            </label>
          </>
        )}
      </div>

      {/* Timeline view */}
      {viewMode === 'timeline' && (
        <>
          <RegimenTimeline
            regimens={filteredRegimens}
            isLoading={q.isLoading}
            onRegimensChange={() => q.refetch()}
          />
          {q.isLoading && <div className="h-32 animate-pulse bg-muted rounded" />}
          {q.data && filteredRegimens.length === 0 && (
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
                  {kind !== "training" && <th className="text-left p-3 hidden md:table-cell">Dose</th>}
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
                        {r.source === "training_autodetect" && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-400" title="Generato automaticamente dai workout sincronizzati">
                            da workout
                          </span>
                        )}
                      </td>
                      {kind !== "training" && <td className="p-3 hidden md:table-cell">{r.dose ?? "—"}</td>}
                      <td className="p-3 tabular-nums whitespace-nowrap">
                        {fromDiario
                          ? <em className="text-emerald-600">in corso</em>
                          : (() => {
                              const duration = formatPeriodDuration(r.start_date, r.end_date)
                              return (
                                <>
                                  <div>
                                    {fmtDate(r.start_date)} → {r.end_date ? fmtDate(r.end_date) : <em className="text-emerald-600">in corso</em>}
                                  </div>
                                  {duration && (
                                    <div className="text-xs text-muted-foreground whitespace-normal max-w-[24rem]" title={duration}>
                                      {r.end_date ? duration : <>da {duration}</>}
                                    </div>
                                  )}
                                </>
                              )
                            })()}
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
