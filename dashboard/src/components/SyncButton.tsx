import { useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { useState } from "react"
import { Button } from "./ui/button"

export function SyncButton() {
  const qc = useQueryClient()
  const [isRefetching, setIsRefetching] = useState(false)

  async function handleSync() {
    setIsRefetching(true)
    try {
      // Refetch every query that depends on data synced from the iOS app.
      // Excludes: labs, regimens, rules, blacklist, diario/stretching proxies,
      // recentWrites/allowedWriteTypes (config/queue), which are independent.
      await Promise.all([
        qc.refetchQueries({ queryKey: ["samples"] }),
        qc.refetchQueries({ queryKey: ["latest"] }),
        qc.refetchQueries({ queryKey: ["latestWeight"] }),
        qc.refetchQueries({ queryKey: ["sampleFacets"] }),
        qc.refetchQueries({ queryKey: ["categories"] }),
        qc.refetchQueries({ queryKey: ["types"] }),
        qc.refetchQueries({ queryKey: ["dailyStats"] }),
        qc.refetchQueries({ queryKey: ["daySnapshot"] }),
        qc.refetchQueries({ queryKey: ["workouts"] }),
        qc.refetchQueries({ queryKey: ["workout"] }),
        qc.refetchQueries({ queryKey: ["workoutSplits"] }),
        qc.refetchQueries({ queryKey: ["workoutFacets"] }),
        qc.refetchQueries({ queryKey: ["workoutRecords"] }),
        qc.refetchQueries({ queryKey: ["workoutRecordsFacets"] }),
        qc.refetchQueries({ queryKey: ["syncStatus"] }),
        qc.refetchQueries({ queryKey: ["syncSessions"] }),
      ])
    } finally {
      setIsRefetching(false)
    }
  }

  return (
    <Button
      onClick={handleSync}
      disabled={isRefetching}
      size="sm"
      variant="outline"
      title="Sincronizza dati dalla app iOS"
    >
      <RefreshCw className={`h-4 w-4 ${isRefetching ? "animate-spin" : ""}`} />
      <span className="ml-2 hidden sm:inline">{isRefetching ? "Aggiornando..." : "Sincronizza"}</span>
    </Button>
  )
}
