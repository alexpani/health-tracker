import { ReadinessCard } from "@/components/ReadinessCard"
import { RecoveryCard } from "@/components/RecoveryCard"
import { RestingHRTrainingOverlay } from "@/components/RestingHRTrainingOverlay"
import { TypeBrowser } from "@/components/TypeBrowser"
import { CATEGORIES } from "@/lib/healthkit"

export default function Vitals() {
  return (
    <TypeBrowser
      title="Vitali"
      subtitle="Battito, pressione, saturazione e respirazione"
      types={CATEGORIES.vitals.types}
      defaultType="HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
      aboveByType={{
        HKQuantityTypeIdentifierHeartRateVariabilitySDNN: (
          <div className="space-y-6">
            <RecoveryCard />
            <ReadinessCard />
          </div>
        ),
      }}
      extrasByType={{
        HKQuantityTypeIdentifierRestingHeartRate: <RestingHRTrainingOverlay />,
      }}
    />
  )
}
