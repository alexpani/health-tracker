import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useClinicalFacets, useClinicalRecord, useClinicalRecords } from "@/lib/queries"
import type { ClinicalFilters, ClinicalRecord } from "@/lib/types"

const STORAGE_KEY = "clinical_filters_v1"

// HKClinicalTypeIdentifier → label umana in italiano.
const CATEGORY_LABELS: Record<string, string> = {
  HKClinicalTypeIdentifierAllergyRecord: "Allergie",
  HKClinicalTypeIdentifierConditionRecord: "Condizioni",
  HKClinicalTypeIdentifierImmunizationRecord: "Vaccinazioni",
  HKClinicalTypeIdentifierLabResultRecord: "Lab clinici",
  HKClinicalTypeIdentifierMedicationRecord: "Farmaci",
  HKClinicalTypeIdentifierProcedureRecord: "Procedure",
  HKClinicalTypeIdentifierVitalSignRecord: "Parametri vitali",
  HKClinicalTypeIdentifierCoverageRecord: "Assicurazioni",
}

const CATEGORY_COLORS: Record<string, string> = {
  HKClinicalTypeIdentifierAllergyRecord: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200",
  HKClinicalTypeIdentifierConditionRecord: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200",
  HKClinicalTypeIdentifierImmunizationRecord: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200",
  HKClinicalTypeIdentifierLabResultRecord: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200",
  HKClinicalTypeIdentifierMedicationRecord: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-200",
  HKClinicalTypeIdentifierProcedureRecord: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
  HKClinicalTypeIdentifierVitalSignRecord: "bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-200",
  HKClinicalTypeIdentifierCoverageRecord: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
}

function shortCategory(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat.replace("HKClinicalTypeIdentifier", "").replace("Record", "")
}

function fmtDateIT(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })
}

function loadFilters(): ClinicalFilters {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {/* noop */}
  return {}
}

function saveFilters(f: ClinicalFilters) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(f)) } catch {/* noop */}
}

export default function Clinical() {
  const [filters, setFilters] = useState<ClinicalFilters>(loadFilters)
  const [openId, setOpenId] = useState<number | null>(null)

  useEffect(() => { saveFilters(filters) }, [filters])

  const facets = useClinicalFacets()
  const records = useClinicalRecords({ ...filters, limit: 500 })

  const grouped = useMemo(() => {
    const m = new Map<string, ClinicalRecord[]>()
    for (const r of records.data ?? []) {
      const k = r.start_date.slice(0, 7) // YYYY-MM
      const arr = m.get(k) ?? []
      arr.push(r)
      m.set(k, arr)
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [records.data])

  const setCategory = (cat: string | undefined) => setFilters(f => ({ ...f, category: cat }))
  const setSource = (src: string | undefined) => setFilters(f => ({ ...f, source_name: src }))
  const reset = () => setFilters({})

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Sidebar filtri */}
      <aside className="lg:w-64 lg:flex-shrink-0 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Filtri</h3>
              {(filters.category || filters.source_name || filters.start || filters.end) && (
                <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground">
                  Reset
                </button>
              )}
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-2">Categoria</div>
              <div className="flex flex-wrap gap-1">
                {(facets.data?.categories ?? []).map(c => (
                  <button
                    key={c.value}
                    onClick={() => setCategory(filters.category === c.value ? undefined : c.value)}
                    className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                      filters.category === c.value
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {shortCategory(c.value)} <span className="opacity-60">({c.count})</span>
                  </button>
                ))}
                {!facets.data?.categories?.length && (
                  <span className="text-xs text-muted-foreground">Nessun record</span>
                )}
              </div>
            </div>

            {(facets.data?.sources?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-2">Sorgente</div>
                <div className="flex flex-wrap gap-1">
                  {facets.data!.sources.map(s => (
                    <button
                      key={s.value}
                      onClick={() => setSource(filters.source_name === s.value ? undefined : s.value)}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                        filters.source_name === s.value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:bg-muted"
                      }`}
                    >
                      {s.value} <span className="opacity-60">({s.count})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </aside>

      {/* Lista */}
      <div className="flex-1 space-y-4">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Cartelle cliniche</h1>
          <span className="text-sm text-muted-foreground">
            {records.data?.length ?? 0} record
          </span>
        </div>

        {records.isLoading && (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Caricamento…</CardContent></Card>
        )}

        {records.data && records.data.length === 0 && (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground space-y-2">
              <p>Nessun clinical record sincronizzato.</p>
              <p>
                In Italia i provider FHIR su Apple Salute sono rari. Puoi
                comunque inserire manualmente da Salute → Sfoglia → Cartelle
                cliniche (allergie, vaccinazioni, farmaci, condizioni).
              </p>
              <p>
                Verifica anche di aver concesso il permesso di lettura su
                Salute → Condivisione → App → Health Tracker → Cartelle cliniche.
              </p>
            </CardContent>
          </Card>
        )}

        {grouped.map(([yyyymm, rows]) => (
          <div key={yyyymm} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground sticky top-0 bg-background py-1">
              {new Date(yyyymm + "-01").toLocaleDateString("it-IT", { month: "long", year: "numeric" })}
            </h2>
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map(r => (
                      <tr
                        key={r.id}
                        onClick={() => setOpenId(r.id)}
                        className="border-b last:border-b-0 hover:bg-muted cursor-pointer"
                      >
                        <td className="px-4 py-2 w-24 tabular-nums text-muted-foreground whitespace-nowrap">
                          {fmtDateIT(r.start_date)}
                        </td>
                        <td className="px-4 py-2 w-32 whitespace-nowrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${CATEGORY_COLORS[r.category] ?? "bg-muted text-muted-foreground"}`}>
                            {shortCategory(r.category)}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          {r.display_name || <span className="text-muted-foreground italic">(senza titolo)</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {r.source_name ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>

      {openId !== null && (
        <ClinicalDetailModal id={openId} onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}

function ClinicalDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useClinicalRecord(id)
  const rec = q.data
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <Card
        className="max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-4">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">
              {rec ? shortCategory(rec.category) : ""}
              {rec?.resource_type && <> · FHIR {rec.resource_type}</>}
            </div>
            <h2 className="text-lg font-semibold truncate">
              {rec?.display_name || rec?.resource_type || "Clinical record"}
            </h2>
            <div className="text-xs text-muted-foreground mt-1">
              {rec && fmtDateIT(rec.start_date)}
              {rec?.source_name && <> · {rec.source_name}</>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="p-4 overflow-auto flex-1">
          {q.isLoading && <p className="text-sm text-muted-foreground">Caricamento…</p>}
          {rec && (
            <pre className="text-xs whitespace-pre-wrap break-all bg-muted/30 p-3 rounded">
              {JSON.stringify(rec.fhir_json, null, 2)}
            </pre>
          )}
        </div>
      </Card>
    </div>
  )
}
