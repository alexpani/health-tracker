import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useJournalList, useJournalTags } from "@/lib/queries"
import type { JournalEntry, JournalFilters } from "@/lib/types"

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
  return new Date(y, m - 1, d).toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
}

function monthKey(iso: string): string { return iso.slice(0, 7) }

function fmtMonthIT(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" })
}

function truncatePlain(s: string, max = 220): string {
  if (s.length <= max) return s
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…"
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

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters })) } catch { /* ignore */ }
  }, [filters])

  // Debounce ricerca testuale
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(f => ({ ...f, text_contains: searchInput.trim() || undefined }))
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const q = useJournalList(filters)
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
              placeholder="Testo nelle voci..."
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
              <button
                key={t}
                type="button"
                onClick={() => setFilters(f => ({ ...f, tag: t }))}
                className={`rounded-full border px-2 py-0.5 text-xs ${filters.tag === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
              >
                {t}
              </button>
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

        {q.isLoading && <div className="h-72 animate-pulse bg-muted rounded" />}

        {q.data && q.data.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Nessuna voce per i filtri attivi. Apri il calendario di un giorno per scrivere la prima voce.
            </CardContent>
          </Card>
        )}

        <div className="space-y-6">
          {monthsSorted.map(mk => (
            <section key={mk} className="space-y-2">
              <h2 className="text-sm font-semibold capitalize text-muted-foreground">{fmtMonthIT(mk)}</h2>
              <div className="space-y-2">
                {grouped[mk].map(e => (
                  <Link
                    key={e.id}
                    to={`/day/${e.date}`}
                    className="block rounded-lg border bg-card p-3 hover:bg-accent/30 transition-colors"
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
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
                      {truncatePlain(e.content_text)}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
