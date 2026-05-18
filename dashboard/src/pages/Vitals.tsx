import { RestingHRTrainingOverlay } from "@/components/RestingHRTrainingOverlay"
import { TypeBrowser } from "@/components/TypeBrowser"
import { CATEGORIES } from "@/lib/healthkit"

export default function Vitals() {
  return (
    <div className="space-y-6">
      <RestingHRTrainingOverlay />
      <TypeBrowser title="Vitali" subtitle="Battito, pressione, saturazione e respirazione" types={CATEGORIES.vitals.types} />
    </div>
  )
}
