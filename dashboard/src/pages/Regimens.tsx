import { useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useDiarioActivePlan, useRegimens } from "@/lib/queries"
import type { Regimen, RegimenKind } from "@/lib/types"
import { KIND_LABELS, RegimenForm } from "@/components/RegimenForm"
import { RegimenTimeline } from "@/components/RegimenTimeline"
import { formatPeriodDuration } from "@/lib/duration"
import { formatDate } from "@/lib/utils"

type TabId = "salute" | "sport" | "alimentazione" | "gear"

const SALUTE_KINDS: RegimenKind[] = ["medication", "supplement"]
const SPORT_KINDS:  RegimenKind[] = ["training"]
const FOOD_KINDS:   RegimenKind[] = ["diet"]
const GEAR_KINDS:   RegimenKind[] = ["gear"]
const TAB_STORAGE_KEY = "regimens_active_tab_v2"
const VALID_TABS: readonly TabId[] = ["salute", "sport", "alimentazione", "gear"]

function isOngoing(r: Regimen): boolean {
  if (r.end_date == null) return true
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  return r.end_date >= todayIso
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return formatDate(iso)
}

export default function Regimens() {
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window === "undefined") return "salute"
    const v = sessionStorage.getItem(TAB_STORAGE_KEY)
    return VALID_TABS.includes(v as TabId) ? (v as TabId) : "salute"
  })
  useEffect(() => {
    sessionStorage.setItem(TAB_STORAGE_KEY, activeTab)
  }, [activeTab])

  const [viewMode, setViewMode] = useState<'timeline' | 'table'>('timeline')
  // Filtri kind multi-select usati solo nella tab Salute. Set vuoto = "Tutti".
  const [selectedKinds, setSelectedKinds] = useState<Set<RegimenKind>>(new Set())
  const [includeEnded, setIncludeEnded] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<Regimen | null>(null)

  // Alimentazione: la Timeline strippa i `kind='diet'` a monte
  // (RegimenTimeline.tsx) — sarebbe sempre vuota. Forziamo Tabella e
  // nascondiamo il toggle solo in questa tab.
  const effectiveViewMode: 'timeline' | 'table' = activeTab === 'alimentazione' ? 'table' : viewMode

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

  // Piano alimentare attivo dal diario, iniettato come Regimen sintetico nella
  // tab Alimentazione (read-only — editing avviene nel diario).
  const dietQ = useDiarioActivePlan()
  const dietPlanRegimen = useMemo<Regimen | null>(() => {
    if (!dietQ.data) return null
    const p = dietQ.data
    const dose: string[] = []
    if (p.kcal_target != null) dose.push(`${Math.round(p.kcal_target)} kcal/die`)
    if (p.protein_g != null) dose.push(`P ${Math.round(p.protein_g)}g`)
    if (p.fat_g != null) dose.push(`F ${Math.round(p.fat_g)}g`)
    if (p.carbs_g != null) dose.push(`C ${Math.round(p.carbs_g)}g`)
    // Il diario non espone una data di inizio piano; `updated_at` e' la data
    // in cui il piano e' stato impostato/modificato — la usiamo come "attivo da".
    const startDate = p.updated_at ? p.updated_at.slice(0, 10) : null
    return {
      id: -1,
      kind: "diet",
      name: p.name,
      start_date: startDate,
      end_date: null,
      dose: dose.join(" · ") || null,
      notes: "Sincronizzato dal diario alimentare. Modifica nel diario.",
      source: "diario",
      metadata: null,
      created_at: p.updated_at ?? "",
      updated_at: p.updated_at ?? "",
    }
  }, [dietQ.data])

  // Subset Salute (medication + supplement) filtrato per chip kind.
  const saluteRegimens = useMemo(() => {
    const all = (q.data ?? []).filter(r => SALUTE_KINDS.includes(r.kind as RegimenKind))
    if (selectedKinds.size === 0) return all
    return all.filter(r => selectedKinds.has(r.kind as RegimenKind))
  }, [q.data, selectedKinds])
  const saluteGrouped = useMemo(() => groupByStatus(saluteRegimens), [saluteRegimens])

  // Subset Sport (training).
  const sportRegimens = useMemo(
    () => (q.data ?? []).filter(r => r.kind === "training"),
    [q.data]
  )
  const sportGrouped = useMemo(() => groupByStatus(sportRegimens), [sportRegimens])

  // Subset Alimentazione (diet manuali + piano dal diario iniettato in cima).
  const foodRegimens = useMemo(
    () => (q.data ?? []).filter(r => r.kind === "diet"),
    [q.data]
  )
  const foodGrouped = useMemo(() => {
    const grouped = groupByStatus(foodRegimens)
    if (dietPlanRegimen) grouped.ongoing.unshift(dietPlanRegimen)
    return grouped
  }, [foodRegimens, dietPlanRegimen])

  // Subset Equipaggiamento (gear).
  const gearRegimens = useMemo(
    () => (q.data ?? []).filter(r => r.kind === "gear"),
    [q.data]
  )
  const gearGrouped = useMemo(() => groupByStatus(gearRegimens), [gearRegimens])

  const newDefaultKind: RegimenKind = (() => {
    switch (activeTab) {
      case "sport": return "training"
      case "alimentazione": return "diet"
      case "gear": return "gear"
      case "salute":
      default: return "medication"
    }
  })()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Regimi</h1>
          <p className="text-muted-foreground">Farmaci, integratori, allenamento, alimentazione, equipaggiamento</p>
        </div>
        <Button onClick={() => { setEditing(null); setShowAdd(true) }}>
          <Plus className="h-4 w-4 mr-1" /> Nuovo
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as TabId)}>
        <TabsList>
          <TabsTrigger value="salute">Salute</TabsTrigger>
          <TabsTrigger value="sport">Sport</TabsTrigger>
          <TabsTrigger value="alimentazione">Alimentazione</TabsTrigger>
          <TabsTrigger value="gear">Equipaggiamento</TabsTrigger>
        </TabsList>

        {/* Timeline/Table view toggle — nascosto in Alimentazione
            (la Timeline ignora i diet, sarebbe sempre vuota). */}
        {activeTab !== 'alimentazione' && (
          <div className="mt-4 flex gap-2">
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
        )}

        <TabsContent value="salute" className="space-y-6">
          {/* Chip kind: utili in Salute perche' ci sono 2 kind. */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant={selectedKinds.size === 0 ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedKinds(new Set())}
            >
              Tutti
            </Button>
            {SALUTE_KINDS.map(k => {
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
            {effectiveViewMode === 'table' && (
              <>
                <div className="flex-1" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={includeEnded} onChange={e => setIncludeEnded(e.target.checked)} />
                  Mostra terminati
                </label>
              </>
            )}
          </div>

          <TabBody
            viewMode={effectiveViewMode}
            isLoading={q.isLoading}
            dataReady={!!q.data}
            regimens={saluteRegimens}
            grouped={saluteGrouped}
            kindsOrder={SALUTE_KINDS}
            includeEnded={includeEnded}
            emptyLabel="Nessun farmaco o integratore registrato."
            onEdit={r => { setShowAdd(false); setEditing(r) }}
            onRegimensChange={() => q.refetch()}
          />
        </TabsContent>

        <TabsContent value="sport" className="space-y-6">
          {effectiveViewMode === 'table' && (
            <div className="flex items-center justify-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeEnded} onChange={e => setIncludeEnded(e.target.checked)} />
                Mostra terminati
              </label>
            </div>
          )}

          <TabBody
            viewMode={effectiveViewMode}
            isLoading={q.isLoading}
            dataReady={!!q.data}
            regimens={sportRegimens}
            grouped={sportGrouped}
            kindsOrder={SPORT_KINDS}
            includeEnded={includeEnded}
            emptyLabel="Nessun piano di allenamento registrato. I piani di allenamento si autodetettano dai workout sincronizzati."
            onEdit={r => { setShowAdd(false); setEditing(r) }}
            onRegimensChange={() => q.refetch()}
          />
        </TabsContent>

        <TabsContent value="alimentazione" className="space-y-6">
          {effectiveViewMode === 'table' && (
            <div className="flex items-center justify-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeEnded} onChange={e => setIncludeEnded(e.target.checked)} />
                Mostra terminati
              </label>
            </div>
          )}

          <TabBody
            viewMode={effectiveViewMode}
            isLoading={q.isLoading}
            dataReady={!!q.data}
            regimens={foodRegimens}
            grouped={foodGrouped}
            kindsOrder={FOOD_KINDS}
            includeEnded={includeEnded}
            emptyLabel="Nessun piano alimentare registrato. Il piano corrente arriva dal diario alimentare."
            onEdit={r => { setShowAdd(false); setEditing(r) }}
            onRegimensChange={() => q.refetch()}
          />
        </TabsContent>

        <TabsContent value="gear" className="space-y-6">
          {effectiveViewMode === 'table' && (
            <div className="flex items-center justify-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeEnded} onChange={e => setIncludeEnded(e.target.checked)} />
                Mostra terminati
              </label>
            </div>
          )}

          <TabBody
            viewMode={effectiveViewMode}
            isLoading={q.isLoading}
            dataReady={!!q.data}
            regimens={gearRegimens}
            grouped={gearGrouped}
            kindsOrder={GEAR_KINDS}
            includeEnded={includeEnded}
            emptyLabel="Nessun equipaggiamento registrato. Premi Nuovo per aggiungere un paio di scarpe."
            onEdit={r => { setShowAdd(false); setEditing(r) }}
            onRegimensChange={() => q.refetch()}
          />
        </TabsContent>
      </Tabs>

      {(showAdd || editing) && (
        <RegimenForm
          regimen={editing}
          defaults={editing ? undefined : { kind: newDefaultKind }}
          onClose={() => { setShowAdd(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

function groupByStatus(items: Regimen[]): { ongoing: Regimen[]; ended: Regimen[] } {
  const out: { ongoing: Regimen[]; ended: Regimen[] } = { ongoing: [], ended: [] }
  for (const r of items) {
    ;(isOngoing(r) ? out.ongoing : out.ended).push(r)
  }
  return out
}

function TabBody({
  viewMode, isLoading, dataReady, regimens, grouped, kindsOrder, includeEnded,
  emptyLabel, onEdit, onRegimensChange,
}: {
  viewMode: 'timeline' | 'table'
  isLoading: boolean
  dataReady: boolean
  regimens: Regimen[]
  grouped: { ongoing: Regimen[]; ended: Regimen[] }
  kindsOrder: RegimenKind[]
  includeEnded: boolean
  emptyLabel: string
  onEdit: (r: Regimen) => void
  onRegimensChange: () => void
}) {
  // Per Timeline: includiamo dietPlanRegimen synth? No — Timeline lo filtra
  // gia' a monte e qui passiamo solo `regimens` "veri". Per Tabella usiamo
  // `grouped` che puo' includere il synth diet in cima.
  const isEmpty = dataReady && regimens.length === 0 && grouped.ongoing.length === 0
  return (
    <>
      {viewMode === 'timeline' && (
        <>
          <RegimenTimeline
            regimens={regimens}
            isLoading={isLoading}
            onRegimensChange={onRegimensChange}
          />
          {isLoading && <div className="h-32 animate-pulse bg-muted rounded" />}
          {isEmpty && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {emptyLabel}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {viewMode === 'table' && (
        <>
          <Section
            title="In corso"
            items={grouped.ongoing}
            kindsOrder={kindsOrder}
            onEdit={onEdit}
          />
          {includeEnded && grouped.ended.length > 0 && (
            <Section
              title="Terminati"
              items={grouped.ended}
              kindsOrder={kindsOrder}
              onEdit={onEdit}
            />
          )}
          {isLoading && <div className="h-32 animate-pulse bg-muted rounded" />}
          {isEmpty && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {emptyLabel}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  )
}

function Section({
  title,
  items,
  kindsOrder,
  onEdit,
}: {
  title: string
  items: Regimen[]
  kindsOrder: RegimenKind[]
  onEdit: (r: Regimen) => void
}) {
  if (items.length === 0) return null
  const byKind: Record<RegimenKind, Regimen[]> = { medication: [], supplement: [], diet: [], training: [], gear: [] }
  for (const r of items) byKind[r.kind].push(r)

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{title} ({items.length})</h2>
      {kindsOrder.map(kind => byKind[kind].length > 0 && (
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
                          ? (
                              <>
                                <div>
                                  {fmtDate(r.start_date)} → <em className="text-emerald-600">in corso</em>
                                </div>
                                {(() => {
                                  const duration = formatPeriodDuration(r.start_date, r.end_date)
                                  return duration ? (
                                    <div className="text-xs text-muted-foreground whitespace-normal max-w-[24rem]" title={duration}>
                                      da {duration}
                                    </div>
                                  ) : null
                                })()}
                              </>
                            )
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
