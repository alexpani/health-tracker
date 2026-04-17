import { TypeBrowser } from "@/components/TypeBrowser"
import { CATEGORIES } from "@/lib/healthkit"

export default function Body() {
  return <TypeBrowser title="Corpo" subtitle="Peso, BMI, massa grassa e magra" types={CATEGORIES.body.types} />
}
