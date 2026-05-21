import { useEffect, useMemo, useRef, useState } from "react"
import { Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DiarioSection } from "@/components/DiarioSection"
import { NutritionCalendar } from "@/components/NutritionCalendar"
import { NutritionFiltersSidebar } from "@/components/NutritionFiltersSidebar"
import { TypeBrowser } from "@/components/TypeBrowser"
import { CATEGORIES } from "@/lib/healthkit"
import { useConsolidatedDailyTotals } from "@/lib/queries"
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
  // Giorno verso cui far focalizzare il calendario. Si aggiorna quando cambia
  // `filters.start` (filtro periodo preciso → primo giorno del periodo) e
  // quando l'utente clicca una barra dell'istogramma storico.
  const [calendarFocusDay, setCalendarFocusDay] = useState<string | null>(filters.start ?? null)

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ filters })) } catch {}
  }, [filters])

  useEffect(() => {
    if (filters.start) setCalendarFocusDay(filters.start)
  }, [filters.start])

  // Year chips: derivati dai totali giornalieri consolidati (diario + HK
  // dietary di sorgenti esterne). Cosi' un anno con SOLO Lifesum (es. 2015)
  // appare come chip, e il conteggio = giorni con registrazione (stessa
  // unita' del calendario, non sample HK grezzi che gonfierebbero il numero).
  const { data: consolidated } = useConsolidatedDailyTotals()
  const availableYears = useMemo(() => {
    const counts = new Map<number, number>()
    for (const d of consolidated ?? []) {
      const y = Number(d.date.slice(0, 4))
      counts.set(y, (counts.get(y) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([year, days]) => ({ year, days }))
      .sort((a, b) => b.year - a.year)
  }, [consolidated])

  const availableDailyTotals = consolidated  // alias per il filtro target

  // Lista dei `kcal_target` distinti dai daily totals storici. Il diario
  // espone solo lo snapshot per giorno, quindi target diversi = piani
  // diversi. Filtro: tolgo null e arrotondo a int per evitare duplicati
  // tipo 1499.999 vs 1500.
  const availableTargets = useMemo(() => {
    const set = new Set<number>()
    for (const d of availableDailyTotals ?? []) {
      if (d.kcal_target != null) set.add(Math.round(d.kcal_target))
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [availableDailyTotals])

  const activeFiltersCount = [
    filters.start, filters.end,
    filters.kcal_min !== undefined ? 1 : undefined,
    filters.kcal_max !== undefined ? 1 : undefined,
    filters.adherence,
    filters.kcal_target !== undefined ? 1 : undefined,
  ].filter(Boolean).length

  return (
    <div className="flex gap-6 -m-6 p-0 min-h-[calc(100vh-0px)]">
      <aside className="hidden lg:block w-[320px] shrink-0 border-r bg-card/30 sticky top-0 h-screen overflow-hidden">
        <NutritionFiltersSidebar
          value={filters}
          onChange={setFilters}
          availableYears={availableYears}
          availableTargets={availableTargets}
        />
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

        <NutritionCalendar filters={filters} focusDay={calendarFocusDay} />

        <DiarioSection filters={filters} onBarClick={setCalendarFocusDay} />

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
              availableTargets={availableTargets}
              onClose={() => setShowMobileFilters(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
