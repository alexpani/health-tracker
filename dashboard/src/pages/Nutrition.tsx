import { TypeBrowser } from "@/components/TypeBrowser"
import { CATEGORIES } from "@/lib/healthkit"

export default function Nutrition() {
  return <TypeBrowser title="Nutrizione" subtitle="Calorie, macronutrienti, acqua e caffeina" types={CATEGORIES.nutrition.types} />
}
