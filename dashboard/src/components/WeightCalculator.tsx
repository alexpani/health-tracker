import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDailyStats, useLatest } from "@/lib/queries"

const KCAL_PER_KG = 7700
const STORAGE_KEY = "body_calculator_v1"

const ACTIVITY_LEVELS: Record<string, { label: string; factor: number }> = {
  sedentary: { label: "Sedentario", factor: 1.2 },
  light: { label: "Leggero (1-3 sport/sett)", factor: 1.375 },
  moderate: { label: "Moderato (3-5 sport/sett)", factor: 1.55 },
  active: { label: "Attivo (6-7 sport/sett)", factor: 1.725 },
  very_active: { label: "Molto attivo (lavoro fisico)", factor: 1.9 },
}

interface PersistedState {
  targetWeight?: number
  kcalSlider?: number
  tdeeMode?: "hk" | "manual"
  manualAge?: number
  manualSex?: "M" | "F"
  manualHeight?: number
  manualActivity?: keyof typeof ACTIVITY_LEVELS
}

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function savePersisted(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* localStorage piena o disabilitata: ignora */
  }
}

function bmiCategory(bmi: number): { label: string; color: string } {
  if (bmi < 18.5) return { label: "sottopeso", color: "text-blue-600 dark:text-blue-400" }
  if (bmi < 25) return { label: "normopeso", color: "text-emerald-600 dark:text-emerald-400" }
  if (bmi < 30) return { label: "sovrappeso", color: "text-amber-600 dark:text-amber-400" }
  return { label: "obeso", color: "text-red-600 dark:text-red-400" }
}

function mifflinStJeor(kg: number, cm: number, age: number, sex: "M" | "F"): number {
  const base = 10 * kg + 6.25 * cm - 5 * age
  return sex === "M" ? base + 5 : base - 161
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function fmtDateIT(d: Date): string {
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })
}

export function WeightCalculator() {
  const persisted = useMemo(() => loadPersisted(), [])

  // ---------- Dati HK ----------
  const weightQ = useLatest("HKQuantityTypeIdentifierBodyMass")
  const heightQ = useLatest("HKQuantityTypeIdentifierHeight")

  const today = useMemo(() => new Date(), [])
  const range30d = useMemo(() => {
    const end = today.toISOString().slice(0, 10)
    const start = new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10)
    return { start, end }
  }, [today])

  const activeQ = useDailyStats("HKQuantityTypeIdentifierActiveEnergyBurned", range30d.start, range30d.end)
  const basalQ = useDailyStats("HKQuantityTypeIdentifierBasalEnergyBurned", range30d.start, range30d.end)

  const currentWeight = weightQ.data?.data?.value ?? null // kg
  // Height da HK arriva in metri (.value in unit "m"). Fallback per casi storici in cm.
  const hkHeight = heightQ.data?.data?.value ?? null
  const heightM = hkHeight != null ? (hkHeight > 3 ? hkHeight / 100 : hkHeight) : null

  const tdeeFromHK = useMemo(() => {
    if (!activeQ.data?.length || !basalQ.data?.length) return null
    const avgActive = average(activeQ.data.map(p => p.value))
    const avgBasal = average(basalQ.data.map(p => p.value))
    const tdee = avgActive + avgBasal
    return tdee > 0 ? Math.round(tdee) : null
  }, [activeQ.data, basalQ.data])

  // ---------- Stato persistito ----------
  const [targetWeight, setTargetWeight] = useState<number>(persisted.targetWeight ?? 0)
  const [tdeeMode, setTdeeMode] = useState<"hk" | "manual">(persisted.tdeeMode ?? "hk")
  const [manualAge, setManualAge] = useState<number>(persisted.manualAge ?? 35)
  const [manualSex, setManualSex] = useState<"M" | "F">(persisted.manualSex ?? "M")
  const [manualHeight, setManualHeight] = useState<number>(persisted.manualHeight ?? 175) // cm
  const [manualActivity, setManualActivity] = useState<keyof typeof ACTIVITY_LEVELS>(
    persisted.manualActivity ?? "moderate"
  )
  const [kcalSlider, setKcalSlider] = useState<number>(persisted.kcalSlider ?? 0)

  // Quando arriva il peso da HK, se non abbiamo ancora un target, lo inizializziamo
  useEffect(() => {
    if (currentWeight != null && targetWeight === 0) {
      setTargetWeight(Number(currentWeight.toFixed(1)))
    }
  }, [currentWeight, targetWeight])

  // Quando arriva l'altezza HK, popola anche il default manuale (la prima volta)
  useEffect(() => {
    if (heightM != null && persisted.manualHeight == null) {
      setManualHeight(Math.round(heightM * 100))
    }
  }, [heightM, persisted.manualHeight])

  // Auto-fallback a manuale se non ci sono dati HK Active+Basal
  const dataLoaded = !activeQ.isLoading && !basalQ.isLoading
  useEffect(() => {
    if (dataLoaded && tdeeMode === "hk" && tdeeFromHK == null && persisted.tdeeMode == null) {
      setTdeeMode("manual")
    }
  }, [dataLoaded, tdeeFromHK, tdeeMode, persisted.tdeeMode])

  // ---------- TDEE corrente ----------
  const tdeeManual = useMemo(() => {
    if (currentWeight == null) return null
    const bmr = mifflinStJeor(currentWeight, manualHeight, manualAge, manualSex)
    return Math.round(bmr * ACTIVITY_LEVELS[manualActivity].factor)
  }, [currentWeight, manualHeight, manualAge, manualSex, manualActivity])

  const effectiveTDEE = tdeeMode === "hk" ? tdeeFromHK : tdeeManual

  // Init slider quando arriva TDEE per la prima volta
  useEffect(() => {
    if (effectiveTDEE != null && kcalSlider === 0) {
      setKcalSlider(Math.max(1200, effectiveTDEE - 500))
    }
  }, [effectiveTDEE, kcalSlider])

  // ---------- Persistenza ----------
  useEffect(() => {
    savePersisted({
      targetWeight,
      kcalSlider,
      tdeeMode,
      manualAge,
      manualSex,
      manualHeight,
      manualActivity,
    })
  }, [targetWeight, kcalSlider, tdeeMode, manualAge, manualSex, manualHeight, manualActivity])

  // ---------- Stati di caricamento / vuoti ----------
  if (weightQ.isLoading || heightQ.isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Calcolatore peso e dieta</CardTitle></CardHeader>
        <CardContent><div className="h-32 animate-pulse bg-muted rounded" /></CardContent>
      </Card>
    )
  }

  if (currentWeight == null || heightM == null) {
    return (
      <Card>
        <CardHeader><CardTitle>Calcolatore peso e dieta</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Registra peso e altezza in Apple Salute per usare il calcolatore.
          </p>
        </CardContent>
      </Card>
    )
  }

  // ---------- Derivati ----------
  const currentBMI = currentWeight / (heightM * heightM)
  const currentBMICat = bmiCategory(currentBMI)
  const targetBMI = targetWeight > 0 ? targetWeight / (heightM * heightM) : currentBMI
  const targetBMICat = bmiCategory(targetBMI)

  const weightDiff = targetWeight - currentWeight // negativo = perdere, positivo = ingrassare
  const isLoss = weightDiff < 0
  const isGain = weightDiff > 0
  const isAtTarget = Math.abs(weightDiff) < 0.1

  const sliderMin = 1200
  const sliderMax = effectiveTDEE != null ? effectiveTDEE + 500 : 4000
  const calorieDelta = effectiveTDEE != null ? kcalSlider - effectiveTDEE : 0 // negativo = deficit
  const deficit = -calorieDelta // positivo se sta perdendo

  // Settimane stimate: perdita o guadagno coerente col delta calorico
  // Se l'utente vuole perdere (isLoss) ma kcal > TDEE → impossibile (settimane = ∞)
  // Se l'utente vuole ingrassare (isGain) ma kcal < TDEE → impossibile
  let weeksToGoal: number | null = null
  if (effectiveTDEE != null && !isAtTarget) {
    const kgPerWeekFromKcal = (calorieDelta * 7) / KCAL_PER_KG // negativo se deficit
    if (isLoss && kgPerWeekFromKcal < 0) {
      weeksToGoal = Math.abs(weightDiff) / Math.abs(kgPerWeekFromKcal)
    } else if (isGain && kgPerWeekFromKcal > 0) {
      weeksToGoal = weightDiff / kgPerWeekFromKcal
    }
  }

  const kgPerWeek = effectiveTDEE != null ? (calorieDelta * 7) / KCAL_PER_KG : 0
  const estimatedDate = weeksToGoal != null
    ? fmtDateIT(new Date(today.getTime() + weeksToGoal * 7 * 86400_000))
    : null

  const warnings: string[] = []
  if (deficit > 1000) warnings.push("Deficit > 1000 kcal/giorno: perdita superiore a 1 kg/settimana, generalmente sconsigliata")
  if (kcalSlider < 1500 && kcalSlider > 0) warnings.push("Soglia minima generale di 1500 kcal/giorno: scendere sotto richiede supervisione medica")

  // ---------- Render ----------
  return (
    <Card>
      <CardHeader>
        <CardTitle>Calcolatore peso e dieta</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Stato + Target */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Stato attuale</p>
            <p className="text-2xl font-semibold tabular-nums">
              {currentWeight.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">kg</span>
            </p>
            <p className="text-sm">
              BMI <span className="tabular-nums">{currentBMI.toFixed(1)}</span>{" "}
              <span className={currentBMICat.color}>({currentBMICat.label})</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Target</p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.1"
                value={targetWeight || ""}
                onChange={e => setTargetWeight(parseFloat(e.target.value) || 0)}
                className="w-24 text-2xl font-semibold tabular-nums h-10"
              />
              <span className="text-sm text-muted-foreground">kg</span>
            </div>
            <p className="text-sm">
              BMI <span className="tabular-nums">{targetBMI.toFixed(1)}</span>{" "}
              <span className={targetBMICat.color}>({targetBMICat.label})</span>
            </p>
          </div>
        </div>

        {/* Differenza */}
        <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
          {isAtTarget ? (
            <span>Sei già al target.</span>
          ) : (
            <span>
              {isLoss ? "Da perdere" : "Da guadagnare"}:{" "}
              <strong className="tabular-nums">{Math.abs(weightDiff).toFixed(1)} kg</strong>
            </span>
          )}
        </div>

        {/* Fabbisogno (TDEE) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <Label className="text-sm font-medium">Fabbisogno giornaliero (TDEE)</Label>
            <div className="flex gap-1">
              <Button
                variant={tdeeMode === "hk" ? "default" : "outline"}
                size="sm"
                onClick={() => setTdeeMode("hk")}
                disabled={tdeeFromHK == null}
                title={tdeeFromHK == null ? "Servono Active+Basal Energy in HealthKit" : undefined}
              >
                HK reale
              </Button>
              <Button
                variant={tdeeMode === "manual" ? "default" : "outline"}
                size="sm"
                onClick={() => setTdeeMode("manual")}
              >
                Manuale
              </Button>
            </div>
          </div>
          <p className="text-2xl font-semibold tabular-nums">
            {effectiveTDEE != null ? effectiveTDEE : "—"}{" "}
            <span className="text-sm font-normal text-muted-foreground">kcal/die</span>
          </p>
          {tdeeMode === "hk" && tdeeFromHK != null && (
            <p className="text-xs text-muted-foreground">Media giornaliera ultimi 30 giorni (Active + Basal Energy).</p>
          )}
          {tdeeMode === "manual" && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">Età</Label>
                <Input
                  type="number"
                  value={manualAge || ""}
                  onChange={e => setManualAge(parseInt(e.target.value) || 0)}
                  min={10}
                  max={120}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Sesso</Label>
                <div className="flex gap-1">
                  <Button
                    variant={manualSex === "M" ? "default" : "outline"}
                    size="sm"
                    className="flex-1 h-9"
                    onClick={() => setManualSex("M")}
                  >M</Button>
                  <Button
                    variant={manualSex === "F" ? "default" : "outline"}
                    size="sm"
                    className="flex-1 h-9"
                    onClick={() => setManualSex("F")}
                  >F</Button>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Altezza (cm)</Label>
                <Input
                  type="number"
                  value={manualHeight || ""}
                  onChange={e => setManualHeight(parseInt(e.target.value) || 0)}
                  min={100}
                  max={230}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Attività</Label>
                <Select value={manualActivity} onValueChange={v => setManualActivity(v as keyof typeof ACTIVITY_LEVELS)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ACTIVITY_LEVELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* Slider calorie */}
        {effectiveTDEE != null && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Calorie / giorno</Label>
              <span className="text-2xl font-semibold tabular-nums">
                {kcalSlider}{" "}
                <span className="text-sm font-normal text-muted-foreground">kcal</span>
              </span>
            </div>
            <Slider
              value={[kcalSlider]}
              onValueChange={v => setKcalSlider(v[0])}
              min={sliderMin}
              max={sliderMax}
              step={50}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
              <span>{sliderMin} kcal</span>
              <span>{sliderMax} kcal</span>
            </div>
            <p className="text-sm">
              {calorieDelta < 0 ? "Deficit " : calorieDelta > 0 ? "Surplus " : "Mantenimento "}
              <strong className="tabular-nums">
                {calorieDelta === 0 ? "0" : (calorieDelta > 0 ? "+" : "") + calorieDelta} kcal/die
              </strong>
              {" · "}
              <span className="tabular-nums">{kgPerWeek >= 0 ? "+" : ""}{kgPerWeek.toFixed(2)} kg/settimana</span>
            </p>
          </div>
        )}

        {/* Tempo stimato */}
        {!isAtTarget && (
          <div className="rounded-md border bg-card px-3 py-3">
            <p className="text-xs text-muted-foreground mb-1">Tempo stimato</p>
            {weeksToGoal != null ? (
              <p className="text-lg">
                <strong className="tabular-nums">
                  {weeksToGoal < 1
                    ? "meno di 1 settimana"
                    : weeksToGoal < 8
                      ? `${Math.round(weeksToGoal)} settimane`
                      : `${(weeksToGoal / 4.345).toFixed(1)} mesi`}
                </strong>
                {estimatedDate && <span className="text-muted-foreground"> · arrivo previsto {estimatedDate}</span>}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isLoss
                  ? "Con queste calorie non c'è deficit: aumenta il deficit per perdere peso."
                  : "Con queste calorie non c'è surplus: aumenta le calorie per guadagnare peso."}
              </p>
            )}
          </div>
        )}

        {/* Warning */}
        {warnings.length > 0 && (
          <div className="space-y-1">
            {warnings.map(w => (
              <p key={w} className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
                {w}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
