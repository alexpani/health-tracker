import { DiarioSection } from "@/components/DiarioSection"
import { TypeBrowser } from "@/components/TypeBrowser"
import { CATEGORIES } from "@/lib/healthkit"

export default function Nutrition() {
  return (
    <div className="space-y-10">
      <DiarioSection />
      <div className="border-t pt-8">
        <h2 className="text-xl font-semibold mb-1">Nutrizione da HealthKit</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Dati rilevati da Apple Salute (calorie, macro, acqua, caffeina). Il diario alimentare sopra
          registra quello che consumi secondo il tuo regime.
        </p>
        <TypeBrowser title="" subtitle="" types={CATEGORIES.nutrition.types} />
      </div>
    </div>
  )
}
