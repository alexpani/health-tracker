import { useEffect, useMemo, useRef, useState } from "react"
import { Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DiarioSection } from "@/components/DiarioSection"
import { NutritionFiltersSidebar } from "@/components/NutritionFiltersSidebar"
import { TypeBrowser } from "@/components/TypeBrowser"
import { CATEGORIES } from "@/lib/healthkit"
import { useDiarioDailyTotals, useSampleFacets } from "@/lib/queries"
import type { NutritionFilters } from "@/lib/types"

const STORAGE_KEY = "nutrition_filters_v1"

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default function Nutrition() {
  const saved = useMemo<any>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  }, [])

  const [filters, setFilters] = useState<NutritionFilters>(saved.filters ?? {})
  const [showMobileFilters, setShowMobileFilters] = useState(false)

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters })) } catch {}
  }, [filters])

  // Year chips: derive from the union of (a) diario daily-totals and (b)
  // HealthKit dietary facets — so a year with ONLY Lifesum samples (e.g.
  // 2015, before the diario existed) still shows up as a filter chip.
  const { data: allDaily } = useDiarioDailyTotals("2010-01-01", todayLocalISO())
  const { data: facetKcal } = useSampleFacets("HKQuantityTypeIdentifierDietaryEnergyConsumed")
  const availableYears = useMemo(() => {
    const set = new Set<number>()
    ;(allDaily ?? []).forEach(d => set.add(Number(d.date.slice(0, 4))))
    ;(facetKcal?.years ?? []).forEach(y => set.add(y.year))
    return Array.from(set).sort((a, b) => b - a)
  }, [allDaily, facetKcal])

  const activeFiltersCount = [
    filters.start, filters.end,
    filters.kcal_min !== undefined ? 1 : undefined,
    filters.kcal_max !== undefined ? 1 : undefined,
    filters.adherence,
  ].filter(Boolean).length

  return (
    <div className="flex gap-6 -m-6 p-0 min-h-[calc(100vh-0px)]">
      <aside className="hidden lg:block w-[320px] shrink-0 border-r bg-card/30 sticky top-0 h-screen overflow-hidden">
        <NutritionFiltersSidebar value={filters} onChange={setFilters} availableYears={availableYears} />
      </aside>

      <div className="flex-1 space-y-10 min-w-0 p-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Nutrizione</h1>
            <p className="text-muted-foreground">Diario alimentare + HealthKit</p>
          </div>
          <Button variant="outline" className="lg:hidden" onClick={() => setShowMobileFilters(true)}>
            <Filter className="h-4 w-4 mr-2" />
            Filtri {activeFiltersCount > 0 && <span className="ml-1 bg-primary text-primary-foreground rounded-full px-2 text-xs">{activeFiltersCount}</span>}
          </Button>
        </div>

        <DiarioSection filters={filters} />

        <div className="border-t pt-8">
          <h2 className="text-xl font-semibold mb-1">Nutrizione da HealthKit</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Dati rilevati da Apple Salute (calorie, macro, acqua, caffeina). Il diario alimentare sopra registra quello che consumi secondo il tuo regime. I filtri della sidebar si applicano solo al diario.
          </p>
          <TypeBrowser title="" subtitle="" types={CATEGORIES.nutrition.types} />
        </div>
      </div>

      {showMobileFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileFilters(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[85%] max-w-[360px] bg-background shadow-xl">
            <NutritionFiltersSidebar
              value={filters}
              onChange={setFilters}
              availableYears={availableYears}
              onClose={() => setShowMobileFilters(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
