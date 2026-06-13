import { useEffect, useMemo, useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useDiarioActivePlan, useDiarioPlanHistory, useRegimens } from "@/lib/queries"
import type { DiarioPlan, DiarioPlanSegment, Regimen, RegimenKind } from "@/lib/types"
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

/** Stringa dose "<kcal> kcal/die · P..g · F..g · C..g" da un piano del diario. */
function planDose(p: Pick<DiarioPlan, "kcal_target" | "protein_g" | "fat_g" | "carbs_g">): string | null {
  const parts: string[] = []
  if (p.kcal_target != null) parts.push(`${Math.round(p.kcal_target)} kcal/die`)
  if (p.protein_g != null) parts.push(`P ${Math.round(p.protein_g)}g`)
  if (p.fat_g != null) parts.push(`F ${Math.round(p.fat_g)}g`)
  if (p.carbs_g != null) parts.push(`C ${Math.round(p.carbs_g)}g`)
  return parts.join(" · ") || null
}

/** Regimen sintetico read-only "dal diario". */
function diarioRegimen(o: { id: number; name: string; dose: string | null; start_date: string | null; end_date: string | null; updated_at: string }): Regimen {
  return {
    id: o.id,
    kind: "diet",
    name: o.name,
    start_date: o.start_date,
    end_date: o.end_date,
    dose: o.dose,
    notes: "Sincronizzato dal diario alimentare. Modifica nel diario.",
    source: "diario",
    metadata: null,
    created_at: o.updated_at,
    updated_at: o.updated_at,
  }
}

function segmentToRegimen(seg: DiarioPlanSegment, id: number): Regimen {
  return diarioRegimen({
    id,
    name: seg.name,
    dose: planDose(seg),
    start_date: seg.start_date,
    end_date: seg.end_date,
    updated_at: seg.updated_at ?? seg.start_date,
  })
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
  // Sorgente per la modalità "duplica" (create pre-compilata, date vuote).
  const [duplicatingFrom, setDuplicatingFrom] = useState<Regimen | null>(null)

  const handleEdit = (r: Regimen) => { setShowAdd(false); setDuplicatingFrom(null); setEditing(r) }
  const handleDuplicate = (r: Regimen) => { setShowAdd(false); setEditing(null); setDuplicatingFrom(r) }

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

  // Piani alimentari dal diario, iniettati come Regimen sintetici read-only nella
  // tab Alimentazione (editing avviene nel diario). Sorgente preferita: lo storico
  // segmentato (`plan-history`) — attivo "in corso" + passati tra i "Terminati" col
  // nome reale. Fallback al solo piano attivo se il diario non espone lo storico.
  const dietHistoryQ = useDiarioPlanHistory()
  const dietActiveQ = useDiarioActivePlan()
  const dietPlanRegimens = useMemo<Regimen[]>(() => {
    const history = dietHistoryQ.data
    if (history && history.length > 0) {
      // Recenti (terminati) in cima alla sezione "Terminati": ordina per
      // end_date desc, con l'attivo (end_date null) sempre primo.
      const sorted = [...history].sort((a, b) => {
        if (a.end_date == null) return -1
        if (b.end_date == null) return 1
        return b.end_date.localeCompare(a.end_date)
      })
      return sorted.map((seg, i) => segmentToRegimen(seg, -1 - i))
    }
    if (dietActiveQ.data) {
      // Fallback: il diario non espone lo storico → mostra solo l'attivo
      // (come prima), con `updated_at` come "attivo da".
      const p = dietActiveQ.data
      const startDate = p.updated_at ? p.updated_at.slice(0, 10) : null
      return [diarioRegimen({ id: -1, name: p.name, dose: planDose(p), start_date: startDate, end_date: null, updated_at: p.updated_at ?? "" })]
    }
    return []
  }, [dietHistoryQ.data, dietActiveQ.data])

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
  const foodGrouped = useMemo(
    () => groupByStatus([...dietPlanRegimens, ...foodRegimens]),
    [foodRegimens, dietPlanRegimens]
  )

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
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Regimi</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Farmaci, integratori, allenamento, alimentazione, equipaggiamento</p>
        </div>
        <Button className="shrink-0" onClick={() => { setEditing(null); setShowAdd(true) }}>
          <Plus className="h-4 w-4 mr-1" /> Nuovo
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={v => setActiveTab(v as TabId)}>
        <TabsList className="max-w-full overflow-x-auto justify-start">
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
                <div className="hidden sm:block flex-1" />
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
            onEdit={handleEdit}
            onDuplicate={handleDuplicate}
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
            onEdit={handleEdit}
            onDuplicate={handleDuplicate}
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
            onEdit={handleEdit}
            onDuplicate={handleDuplicate}
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
            onEdit={handleEdit}
            onDuplicate={handleDuplicate}
            onRegimensChange={() => q.refetch()}
          />
        </TabsContent>
      </Tabs>

      {(showAdd || editing) && (
        <RegimenForm
          regimen={editing}
          defaults={editing ? undefined : { kind: newDefaultKind }}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onDuplicate={handleDuplicate}
        />
      )}

      {duplicatingFrom && (
        <RegimenForm
          duplicateFrom={duplicatingFrom}
          onClose={() => { setDuplicatingFrom(null); q.refetch() }}
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
  emptyLabel, onEdit, onDuplicate, onRegimensChange,
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
  onDuplicate: (r: Regimen) => void
  onRegimensChange: () => void
}) {
  // Per Timeline passiamo solo `regimens` "veri" (la Timeline filtra i diet a
  // monte). Per Tabella usiamo `grouped`, che puo' includere i piani sintetici
  // dal diario (attivo + storico).
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
              onDuplicate={onDuplicate}
              showDuplicate
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
  onDuplicate,
  showDuplicate = false,
}: {
  title: string
  items: Regimen[]
  kindsOrder: RegimenKind[]
  onEdit: (r: Regimen) => void
  onDuplicate?: (r: Regimen) => void
  showDuplicate?: boolean
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
                  <th className="p-3"></th>
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
                        {(() => {
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
                          <div className="flex justify-end gap-1 whitespace-nowrap">
                            {showDuplicate && onDuplicate && (
                              <Button variant="ghost" size="sm" onClick={() => onDuplicate(r)}>
                                Duplica
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => onEdit(r)}>
                              Modifica
                            </Button>
                          </div>
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
