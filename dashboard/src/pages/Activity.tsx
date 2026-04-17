import { TypeBrowser } from "@/components/TypeBrowser"
import { CATEGORIES } from "@/lib/healthkit"

export default function Activity() {
  return <TypeBrowser title="Attivita" subtitle="Passi, distanze, calorie e tempi di movimento" types={CATEGORIES.activity.types} />
}
