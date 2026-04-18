import { TypeBrowser } from "@/components/TypeBrowser"
import { CATEGORIES } from "@/lib/healthkit"

export default function Fitness() {
  return <TypeBrowser title="Fitness" subtitle="VO2 max, corsa, ciclismo, camminata, scale" types={CATEGORIES.fitness.types} />
}
