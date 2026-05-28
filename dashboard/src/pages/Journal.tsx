import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { CalendarDays, ChevronLeft, ChevronRight, MoreHorizontal, Search, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { JournalForm } from "@/components/JournalForm"
import { JournalHeatmap } from "@/components/JournalHeatmap"
import {
  useDeleteJournal,
  useJournalBulk,
  useJournalList,
  useJournalTags,
  useRenameJournalTag,
} from "@/lib/queries"
import type { JournalEntry, JournalFilters } from "@/lib/types"
import { formatDate, formatMonthYearLong } from "@/lib/utils"

const STORAGE_KEY = "journal_filters_v1"

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
}

function fmtDateIT(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  const weekday = new Date(y, m - 1, d).toLocaleDateString("it-IT", { weekday: "short" })
  return `${weekday} ${formatDate(iso)}`
}

function monthKey(iso: string): string { return iso.slice(0, 7) }
function fmtMonthIT(yyyymm: string): string {
  return formatMonthYearLong(yyyymm + "-01")
}

function truncatePlain(s: string, max = 220): string {
  if (s.length <= max) return s
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…"
}

function highlightMatches(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const terms = query
    .replace(/"/g, "")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)
  if (terms.length === 0) return text
  const pattern = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
  const re = new RegExp(`(${pattern})`, "gi")
  const parts = text.split(re)
  return parts.map((part, i) =>
    re.test(part) ? <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 rounded px-0.5">{part}</mark> : part
  )
}

const PRESETS = [
  { label: "7g", days: 7 },
  { label: "30g", days: 30 },
  { label: "90g", days: 90 },
  { label: "1a", days: 365 },
  { label: "Tutto", days: null as number | null },
]

interface SavedShape {
  filters?: JournalFilters
  heatmapYear?: number
}

export default function Journal() {
  const navigate = useNavigate()
  const saved = useMemo<SavedShape>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  }, [])

  const [filters, setFilters] = useState<JournalFilters>(saved.filters ?? {})
  const [searchInput, setSearchInput] = useState<string>(saved.filters?.text_contains ?? "")
  const [heatmapYear, setHeatmapYear] = useState<number>(saved.heatmapYear ?? new Date().getFullYear())

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters, heatmapYear })) } catch { /* ignore */ }
  }, [filters, heatmapYear])

  // Debounce ricerca testuale
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(f => ({ ...f, text_contains: searchInput.trim() || undefined }))
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const q = useJournalList({ ...filters, limit: 1000 })
  const tagsQ = useJournalTags()

  const applyPreset = (days: number | null) => {
    if (days === null) {
      setFilters(f => ({ ...f, start: undefined, end: undefined }))
    } else {
      const end = todayLocalISO()
      setFilters(f => ({ ...f, start: shiftDate(end, -days), end }))
    }
  }

  const grouped: Record<string, JournalEntry[]> = useMemo(() => {
    const out: Record<string, JournalEntry[]> = {}
    for (const e of q.data ?? []) {
      const k = monthKey(e.date)
      if (!out[k]) out[k] = []
      out[k].push(e)
    }
    return out
  }, [q.data])

  const monthsSorted = useMemo(() => Object.keys(grouped).sort((a, b) => b.localeCompare(a)), [grouped])

  // -- Bulk selection ---
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const allIds = useMemo(() => (q.data ?? []).map(e => e.id), [q.data])
  const toggleId = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAll = () => setSelected(new Set(allIds))
  const clearSelection = () => setSelected(new Set())

  const bulk = useJournalBulk()
  const removeOne = useDeleteJournal()
  const rename = useRenameJournalTag()

  // -- Modals state ---
  const [editEntry, setEditEntry] = useState<JournalEntry | null>(null)
  const [tagMenu, setTagMenu] = useState<string | null>(null) // tag con menu aperto
  const [renameDialog, setRenameDialog] = useState<{ from: string; to: string } | null>(null)
  const [bulkTagDialog, setBulkTagDialog] = useState<{ action: "add_tag" | "remove_tag"; tag: string } | null>(null)

  // --- Actions ---
  const handleDeleteOne = async (e: JournalEntry) => {
    if (!confirm(`Eliminare la voce del ${e.date}?`)) return
    await removeOne.mutateAsync(e.id)
    setSelected(prev => { const n = new Set(prev); n.delete(e.id); return n })
  }

  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    if (!confirm(`Eliminare ${selected.size} voci?`)) return
    await bulk.mutateAsync({ ids: [...selected], action: "delete" })
    clearSelection()
  }

  const handleBulkTag = async () => {
    if (!bulkTagDialog || !bulkTagDialog.tag.trim()) return
    await bulk.mutateAsync({
      ids: [...selected],
      action: bulkTagDialog.action,
      tag: bulkTagDialog.tag.trim().toLowerCase(),
    })
    setBulkTagDialog(null)
    clearSelection()
  }

  const handleRenameTag = async () => {
    if (!renameDialog) return
    const to = renameDialog.to.trim().toLowerCase() || null
    if (to === renameDialog.from.toLowerCase()) {
      setRenameDialog(null)
      return
    }
    await rename.mutateAsync({ old: renameDialog.from, new: to })
    if (filters.tag === renameDialog.from) {
      setFilters(f => ({ ...f, tag: to ?? undefined }))
    }
    setRenameDialog(null)
  }

  const handleDeleteTag = async (tag: string) => {
    if (!confirm(`Rimuovere il tag "${tag}" da TUTTE le voci che lo contengono? (non elimina le voci, solo il tag)`)) return
    await rename.mutateAsync({ old: tag, new: null })
    setTagMenu(null)
    if (filters.tag === tag) setFilters(f => ({ ...f, tag: undefined }))
  }

  return (
    <div className="flex gap-6 -m-6 p-0 min-h-[calc(100vh-0px)]">
      {/* Sidebar filtri */}
      <aside className="hidden lg:block w-[280px] shrink-0 border-r bg-card/30 sticky top-0 h-screen overflow-y-auto p-4 space-y-5 text-sm">
        <h2 className="text-base font-semibold">Filtri</h2>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Cerca</label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder='Es. "vitamina d" anno -test'
              className="pl-8 pr-8"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-2 top-2 rounded p-0.5 hover:bg-accent"
                aria-label="Pulisci ricerca"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Multi-parola con stemming italiano. Esempio: "vitamina dbase".
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Tag</label>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setFilters(f => ({ ...f, tag: undefined }))}
              className={`rounded-full border px-2 py-0.5 text-xs ${!filters.tag ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              Tutti
            </button>
            {(tagsQ.data ?? []).map(t => (
              <div key={t} className="relative inline-flex items-center">
                <button
                  type="button"
                  onClick={() => setFilters(f => ({ ...f, tag: t }))}
                  className={`rounded-l-full rounded-r-none border border-r-0 px-2 py-0.5 text-xs ${filters.tag === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                >
                  {t}
                </button>
                <button
                  type="button"
                  onClick={() => setTagMenu(tagMenu === t ? null : t)}
                  className={`rounded-r-full rounded-l-none border border-l px-1 py-0.5 text-xs ${filters.tag === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                  aria-label={`Azioni tag ${t}`}
                >
                  <MoreHorizontal className="h-3 w-3" />
                </button>
                {tagMenu === t && (
                  <div className="absolute left-0 top-7 z-10 w-44 bg-popover border rounded-md shadow-lg text-sm">
                    <button
                      type="button"
                      onClick={() => { setRenameDialog({ from: t, to: t }); setTagMenu(null) }}
                      className="block w-full text-left px-3 py-1.5 hover:bg-accent rounded-t-md"
                    >
                      Rinomina…
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTag(t)}
                      className="block w-full text-left px-3 py-1.5 hover:bg-accent text-destructive rounded-b-md"
                    >
                      Elimina ovunque
                    </button>
                  </div>
                )}
              </div>
            ))}
            {(tagsQ.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">Ancora nessun tag.</p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Periodo</label>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p.days)}
                className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={filters.start ?? ""}
              onChange={e => setFilters(f => ({ ...f, start: e.target.value || undefined }))}
              className="h-8 text-xs"
            />
            <Input
              type="date"
              value={filters.end ?? ""}
              onChange={e => setFilters(f => ({ ...f, end: e.target.value || undefined }))}
              className="h-8 text-xs"
            />
          </div>
        </div>
      </aside>

      <div className="flex-1 space-y-4 min-w-0 p-6">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Diario</h1>
          <Button onClick={() => navigate(`/day/${todayLocalISO()}`)}>
            Vai a oggi
          </Button>
        </div>

        {/* Heatmap annuale */}
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Mappa annuale</h3>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setHeatmapYear(y => y - 1)} aria-label="Anno precedente">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium w-12 text-center tabular-nums">{heatmapYear}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setHeatmapYear(y => y + 1)} aria-label="Anno successivo">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <JournalHeatmap year={heatmapYear} />
          </CardContent>
        </Card>

        {/* Bulk toolbar */}
        {selected.size > 0 && (
          <div className="sticky top-12 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
            <span className="text-sm font-medium pl-2">
              {selected.size} {selected.size === 1 ? "voce selezionata" : "voci selezionate"}
            </span>
            <Button variant="outline" size="sm" onClick={() => setBulkTagDialog({ action: "add_tag", tag: "" })}>
              Aggiungi tag
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkTagDialog({ action: "remove_tag", tag: "" })}>
              Rimuovi tag
            </Button>
            <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={bulk.isPending}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Elimina
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection}>Annulla</Button>
          </div>
        )}

        {q.isLoading && <div className="h-72 animate-pulse bg-muted rounded" />}

        {q.data && q.data.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Nessuna voce per i filtri attivi.
            </CardContent>
          </Card>
        )}

        {q.data && q.data.length > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>{q.data.length} {q.data.length === 1 ? "voce" : "voci"}</span>
            {selected.size === 0 ? (
              <button type="button" onClick={selectAll} className="hover:underline">Seleziona tutte</button>
            ) : (
              <button type="button" onClick={clearSelection} className="hover:underline">Deseleziona tutte</button>
            )}
          </div>
        )}

        <div className="space-y-6">
          {monthsSorted.map(mk => (
            <section key={mk} className="space-y-2">
              <h2 className="text-sm font-semibold capitalize text-muted-foreground">{fmtMonthIT(mk)}</h2>
              <div className="space-y-2">
                {grouped[mk].map(e => {
                  const isSel = selected.has(e.id)
                  return (
                    <div
                      key={e.id}
                      className={`group rounded-lg border p-3 transition-colors ${isSel ? "border-primary bg-primary/5" : "bg-card hover:bg-accent/30"}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleId(e.id)}
                          className="mt-1 h-4 w-4 cursor-pointer"
                          aria-label={`Seleziona voce ${e.date}`}
                        />
                        <button
                          type="button"
                          onClick={() => setEditEntry(e)}
                          className="flex-1 min-w-0 cursor-pointer text-left"
                          aria-label={`Modifica voce ${e.date}`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-medium capitalize">{fmtDateIT(e.date)}</span>
                            {e.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 justify-end">
                                {e.tags.map(t => (
                                  <span
                                    key={t}
                                    className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200"
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground line-clamp-3 break-words">
                            {highlightMatches(truncatePlain(e.content_text), filters.text_contains ?? "")}
                          </p>
                        </button>
                        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => navigate(`/day/${e.date}`)}
                            className="h-7 w-7 rounded inline-flex items-center justify-center hover:bg-accent"
                            title="Vai al calendario di questo giorno"
                            aria-label="Vai al calendario"
                          >
                            <CalendarDays className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteOne(e)}
                            className="h-7 w-7 rounded inline-flex items-center justify-center text-destructive hover:bg-destructive/10"
                            title="Elimina"
                            aria-label="Elimina"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* Modal: edit entry inline */}
      {editEntry && (
        <JournalForm
          date={editEntry.date}
          entry={editEntry}
          onClose={() => setEditEntry(null)}
        />
      )}

      {/* Modal: bulk add/remove tag */}
      {bulkTagDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setBulkTagDialog(null)}
        >
          <div className="bg-card rounded-lg p-5 shadow-2xl w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold">
              {bulkTagDialog.action === "add_tag" ? "Aggiungi tag" : "Rimuovi tag"}
              <span className="ml-2 text-sm font-normal text-muted-foreground">{selected.size} voci</span>
            </h3>
            <Input
              autoFocus
              value={bulkTagDialog.tag}
              onChange={e => setBulkTagDialog({ ...bulkTagDialog, tag: e.target.value })}
              placeholder="Nome tag"
              list="bulk-tag-suggestions"
            />
            <datalist id="bulk-tag-suggestions">
              {(tagsQ.data ?? []).map(t => <option key={t} value={t} />)}
            </datalist>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBulkTagDialog(null)}>Annulla</Button>
              <Button onClick={handleBulkTag} disabled={!bulkTagDialog.tag.trim() || bulk.isPending}>
                {bulkTagDialog.action === "add_tag" ? "Aggiungi" : "Rimuovi"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: rename tag */}
      {renameDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setRenameDialog(null)}
        >
          <div className="bg-card rounded-lg p-5 shadow-2xl w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Rinomina tag</h3>
            <p className="text-sm text-muted-foreground">
              Sostituisci <code className="rounded bg-muted px-1.5 py-0.5">{renameDialog.from}</code> con un nuovo nome in tutte le voci.
            </p>
            <Input
              autoFocus
              value={renameDialog.to}
              onChange={e => setRenameDialog({ ...renameDialog, to: e.target.value })}
              placeholder="Nuovo nome"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameDialog(null)}>Annulla</Button>
              <Button onClick={handleRenameTag} disabled={!renameDialog.to.trim() || rename.isPending}>
                Rinomina
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
