import { useState } from "react"
import { ChevronLeft } from "lucide-react"
import { useMedicalDocs } from "@/lib/queries"
import { Button } from "@/components/ui/button"
import type { MedicalDocFilters, MedicalDocSection as Section } from "@/lib/types"
import MedicalDocsFilters from "@/components/MedicalDocsFilters"
import MedicalDocsList from "@/components/MedicalDocsList"
import MedicalDocPreview from "@/components/MedicalDocPreview"

interface Props {
  section: Section
  title: string
  description: string
}

/** Pagina generica master-detail per Visite / Referti / Documentazione.
 * Filtri a sinistra, elenco al centro, anteprima del documento a destra. */
export default function MedicalDocsSection({ section, title, description }: Props) {
  const storageKey = `medicaldocs_${section}_filters_v1`
  const [filters, setFilters] = useState<MedicalDocFilters>(() => {
    try {
      const s = sessionStorage.getItem(storageKey)
      if (s) return JSON.parse(s) as MedicalDocFilters
    } catch {
      /* ignore */
    }
    return {}
  })
  const [selectedId, setSelectedId] = useState<number | null>(null)

  function update(f: MedicalDocFilters) {
    setFilters(f)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(f))
    } catch {
      /* ignore */
    }
  }

  const { data, isLoading, error } = useMedicalDocs(section, filters)
  const items = data?.items ?? []
  const selected = items.find(d => d.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[210px_minmax(0,1fr)_minmax(0,1.1fr)]">
        <MedicalDocsFilters section={section} filters={filters} onChange={update} />
        <MedicalDocsList
          section={section}
          items={items}
          isLoading={isLoading}
          error={error}
          total={data?.total ?? 0}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {/* Anteprima come terza colonna solo su desktop. */}
        <div className="hidden lg:block">
          <MedicalDocPreview section={section} doc={selected} />
        </div>
      </div>

      {/* Su mobile l'anteprima è un overlay a tutto schermo: la griglia
          impilata la spingerebbe in fondo, sotto la lista scrollabile, e
          toccando un documento non si vedrebbe nessun cambiamento. */}
      {selected && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-background lg:hidden">
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-3 py-2">
            <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Indietro
            </Button>
            <span className="truncate text-sm font-medium">
              {selected.title ?? "Documento"}
            </span>
          </div>
          <div className="p-3">
            <MedicalDocPreview section={section} doc={selected} />
          </div>
        </div>
      )}
    </div>
  )
}
