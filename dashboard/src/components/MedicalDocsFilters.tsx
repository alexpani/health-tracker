import { useEffect, useRef, useState } from "react"
import { Search, Tags } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useMedicalDocCategories } from "@/lib/queries"
import type { MedicalDocFilters, MedicalDocSection } from "@/lib/types"
import MedicalDocsCategoryManager from "@/components/MedicalDocsCategoryManager"

interface Props {
  section: MedicalDocSection
  filters: MedicalDocFilters
  onChange: (f: MedicalDocFilters) => void
}

const DATE_PRESETS: Array<{ label: string; days: number | null }> = [
  { label: "7g", days: 7 },
  { label: "30g", days: 30 },
  { label: "90g", days: 90 },
  { label: "1a", days: 365 },
  { label: "Tutto", days: null },
]

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

export default function MedicalDocsFilters({ section, filters, onChange }: Props) {
  const { data: categories } = useMedicalDocCategories(section)
  const [search, setSearch] = useState(filters.q ?? "")
  const [catModal, setCatModal] = useState(false)
  const firstRender = useRef(true)

  // Debounce della ricerca testuale (350ms).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const t = setTimeout(() => {
      onChange({ ...filters, q: search || null })
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const set = (patch: Partial<MedicalDocFilters>) => onChange({ ...filters, ...patch })

  return (
    <aside className="space-y-4 lg:sticky lg:top-4 self-start">
      <div>
        <label className="text-xs font-medium text-muted-foreground">Ricerca</label>
        <div className="relative mt-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca nel testo…"
            className="pl-8 h-8"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Categoria</label>
          <button
            onClick={() => setCatModal(true)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Tags className="h-3 w-3" /> Gestisci
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          <Chip active={filters.category_id == null} onClick={() => set({ category_id: null })}>
            Tutte
          </Chip>
          {(categories ?? []).map(c => (
            <Chip
              key={c.id}
              active={filters.category_id === c.id}
              onClick={() => set({ category_id: c.id })}
            >
              {c.name} <span className="opacity-60">{c.doc_count}</span>
            </Chip>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Stato</label>
        <div className="mt-1 flex flex-wrap gap-1">
          <Chip active={filters.status == null} onClick={() => set({ status: null })}>Tutti</Chip>
          <Chip active={filters.status === "draft"} onClick={() => set({ status: "draft" })}>Bozza</Chip>
          <Chip active={filters.status === "confirmed"} onClick={() => set({ status: "confirmed" })}>
            Confermato
          </Chip>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Periodo</label>
        <div className="mt-1 flex flex-wrap gap-1">
          {DATE_PRESETS.map(p => (
            <Chip
              key={p.label}
              active={false}
              onClick={() =>
                set({ start: p.days == null ? null : isoDaysAgo(p.days), end: null })
              }
            >
              {p.label}
            </Chip>
          ))}
        </div>
        <div className="mt-2 space-y-1">
          <Input
            type="date"
            value={filters.start ?? ""}
            onChange={e => set({ start: e.target.value || null })}
            className="h-8"
          />
          <Input
            type="date"
            value={filters.end ?? ""}
            onChange={e => set({ end: e.target.value || null })}
            className="h-8"
          />
        </div>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="w-full"
        onClick={() => { setSearch(""); onChange({}) }}
      >
        Azzera filtri
      </Button>

      {catModal && (
        <MedicalDocsCategoryManager section={section} onClose={() => setCatModal(false)} />
      )}
    </aside>
  )
}

function Chip({
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
      onClick={onClick}
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-accent"
      )}
    >
      {children}
    </button>
  )
}
