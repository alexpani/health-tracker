import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { HealthNoteForm } from "@/components/HealthNoteForm"
import { useHealthNotes, useHealthNoteZones } from "@/lib/queries"
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
} from "@/lib/healthNotes"
import type { HealthNote, HealthNoteCategory, HealthNoteFilters } from "@/lib/types"

const STORAGE_KEY = "health_notes_filters_v1"

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
  return new Date(y, m - 1, d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)  // YYYY-MM
}

function fmtMonthIT(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" })
}

const PRESETS = [
  { label: "7g", days: 7 },
  { label: "30g", days: 30 },
  { label: "90g", days: 90 },
  { label: "1a", days: 365 },
  { label: "Tutto", days: null as number | null },
]

export default function HealthNotes() {
  const saved = useMemo<any>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  }, [])

  const [filters, setFilters] = useState<HealthNoteFilters>(saved.filters ?? {})
  const [searchInput, setSearchInput] = useState<string>(saved.filters?.text_contains ?? "")
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters })) } catch {}
  }, [filters])

  // Debounce ricerca testuale
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(f => ({ ...f, text_contains: searchInput.trim() || undefined }))
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const q = useHealthNotes(filters)
  const zonesQ = useHealthNoteZones()

  const editing: HealthNote | null = useMemo(() => {
    if (editingId == null) return null
    return q.data?.find(n => n.id === editingId) ?? null
  }, [editingId, q.data])

  // Raggruppamento cronologico per mese
  const groupedByMonth = useMemo(() => {
    const map = new Map<string, HealthNote[]>()
    for (const n of q.data ?? []) {
      const k = monthKey(n.start_date)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(n)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [q.data])

  const setPreset = (days: number | null) => {
    if (days == null) {
      setFilters(f => ({ ...f, start: undefined, end: undefined }))
    } else {
      const end = todayLocalISO()
      const start = shiftDate(end, -days)
      setFilters(f => ({ ...f, start, end }))
    }
  }

  return (
    <div className="flex gap-6 -m-6 p-0 min-h-[calc(100vh-0px)]">
      {/* Sidebar filtri */}
      <aside className="hidden lg:block w-[300px] shrink-0 border-r bg-card/30 sticky top-0 h-screen overflow-y-auto p-4 space-y-5">
        <div>
          <h3 className="text-sm font-semibold mb-2">Cerca testo</h3>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Es. ginocchio, mal di testa..."
              className="pl-8"
            />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Categoria</h3>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant={!filters.category ? "default" : "outline"}
              size="sm"
              onClick={() => setFilters(f => ({ ...f, category: undefined }))}
            >
              Tutte
            </Button>
            {CATEGORY_ORDER.map(c => (
              <Button
                key={c}
                variant={filters.category === c ? "default" : "outline"}
                size="sm"
                onClick={() => setFilters(f => ({ ...f, category: c as HealthNoteCategory }))}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${CATEGORY_COLORS[c].dot}`} />
                {CATEGORY_LABELS[c]}
              </Button>
            ))}
          </div>
        </div>

        {zonesQ.data && zonesQ.data.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Zona corporea</h3>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant={!filters.body_zone ? "default" : "outline"}
                size="sm"
                onClick={() => setFilters(f => ({ ...f, body_zone: undefined }))}
              >
                Tutte
              </Button>
              {zonesQ.data.map(z => (
                <Button
                  key={z}
                  variant={filters.body_zone === z ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilters(f => ({ ...f, body_zone: z }))}
                >
                  {z}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-2">Periodo</h3>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESETS.map(p => (
              <Button
                key={p.label}
                variant="outline"
                size="sm"
                onClick={() => setPreset(p.days)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              value={filters.start ?? ""}
              onChange={e => setFilters(f => ({ ...f, start: e.target.value || undefined }))}
            />
            <Input
              type="date"
              value={filters.end ?? ""}
              onChange={e => setFilters(f => ({ ...f, end: e.target.value || undefined }))}
            />
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={() => { setFilters({}); setSearchInput("") }}>
          <X className="h-3.5 w-3.5 mr-1" /> Resetta filtri
        </Button>
      </aside>

      {/* Body */}
      <div className="flex-1 space-y-6 min-w-0 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Note di salute</h1>
            <p className="text-muted-foreground">Dolori, malattie, fastidi e sintomi quotidiani</p>
          </div>
          <Button onClick={() => { setEditingId(null); setShowAdd(true) }}>
            <Plus className="h-4 w-4 mr-1" /> Nuova nota
          </Button>
        </div>

        {q.isLoading && <div className="h-32 animate-pulse bg-muted rounded" />}

        {q.data && q.data.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              Nessuna nota corrisponde ai filtri.
            </CardContent>
          </Card>
        )}

        {groupedByMonth.map(([month, items]) => (
          <div key={month}>
            <h2 className="text-lg font-semibold capitalize mb-2">{fmtMonthIT(month)} <span className="text-sm text-muted-foreground font-normal">({items.length})</span></h2>
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {items.map(n => {
                    const isPeriod = n.start_date !== n.end_date
                    const colors = CATEGORY_COLORS[n.category]
                    return (
                      <li
                        key={n.id}
                        onClick={() => { setEditingId(n.id); setShowAdd(false) }}
                        className="p-3 hover:bg-accent/40 cursor-pointer"
                      >
                        <div className="flex items-start gap-3">
                          <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} flex-shrink-0`}>
                            {CATEGORY_LABELS[n.category]}
                          </span>
                          <div className="flex-1 min-w-0">
                            {n.body_zone && <span className="font-medium text-sm">{n.body_zone}</span>}
                            {n.body_zone && <span className="text-muted-foreground"> · </span>}
                            <span className="text-sm">{n.text}</span>
                          </div>
                          <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap flex-shrink-0">
                            {isPeriod
                              ? `${fmtDateIT(n.start_date)} → ${fmtDateIT(n.end_date)}`
                              : fmtDateIT(n.start_date)}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          </div>
        ))}

        {showAdd && (
          <HealthNoteForm
            defaults={{ start_date: todayLocalISO(), end_date: todayLocalISO() }}
            onClose={() => setShowAdd(false)}
          />
        )}
        {editing && (
          <HealthNoteForm
            note={editing}
            onClose={() => setEditingId(null)}
          />
        )}
      </div>
    </div>
  )
}
