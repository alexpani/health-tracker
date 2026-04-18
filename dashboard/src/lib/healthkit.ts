export type Category = "activity" | "vitals" | "body" | "nutrition" | "fitness" | "other"

export interface TypeMeta {
  label: string
  category: Category
  displayUnit: string
  sourceUnit: string
  unitMultiplier: number
  color: string
  formatValue?: (v: number) => string
}

// HK identifier -> metadata for display
export const TYPE_META: Record<string, TypeMeta> = {
  // --- Activity ---
  HKQuantityTypeIdentifierStepCount: {
    label: "Passi", category: "activity", displayUnit: "passi", sourceUnit: "count", unitMultiplier: 1, color: "#22c55e",
  },
  HKQuantityTypeIdentifierDistanceWalkingRunning: {
    label: "Distanza camminata/corsa", category: "activity", displayUnit: "km", sourceUnit: "m", unitMultiplier: 0.001, color: "#16a34a",
    formatValue: v => `${(v).toFixed(2)}`,
  },
  HKQuantityTypeIdentifierDistanceCycling: {
    label: "Distanza in bici", category: "activity", displayUnit: "km", sourceUnit: "m", unitMultiplier: 0.001, color: "#0ea5e9",
    formatValue: v => `${(v).toFixed(2)}`,
  },
  HKQuantityTypeIdentifierDistanceSwimming: {
    label: "Distanza nuoto", category: "activity", displayUnit: "m", sourceUnit: "m", unitMultiplier: 1, color: "#06b6d4",
  },
  HKQuantityTypeIdentifierActiveEnergyBurned: {
    label: "Calorie attive", category: "activity", displayUnit: "kcal", sourceUnit: "kcal", unitMultiplier: 1, color: "#f97316",
  },
  HKQuantityTypeIdentifierBasalEnergyBurned: {
    label: "Calorie basali", category: "activity", displayUnit: "kcal", sourceUnit: "kcal", unitMultiplier: 1, color: "#fb923c",
  },
  HKQuantityTypeIdentifierFlightsClimbed: {
    label: "Piani saliti", category: "activity", displayUnit: "piani", sourceUnit: "count", unitMultiplier: 1, color: "#a855f7",
  },
  HKQuantityTypeIdentifierAppleExerciseTime: {
    label: "Tempo di movimento", category: "activity", displayUnit: "min", sourceUnit: "min", unitMultiplier: 1, color: "#84cc16",
  },
  HKQuantityTypeIdentifierAppleStandTime: {
    label: "Tempo in piedi", category: "activity", displayUnit: "min", sourceUnit: "min", unitMultiplier: 1, color: "#eab308",
  },
  HKQuantityTypeIdentifierAppleMoveTime: {
    label: "Tempo Move", category: "activity", displayUnit: "min", sourceUnit: "min", unitMultiplier: 1, color: "#f59e0b",
  },
  HKQuantityTypeIdentifierPushCount: {
    label: "Spinte (sedia a rotelle)", category: "activity", displayUnit: "conteggio", sourceUnit: "count", unitMultiplier: 1, color: "#10b981",
  },
  HKQuantityTypeIdentifierSwimmingStrokeCount: {
    label: "Bracciate nuoto", category: "activity", displayUnit: "conteggio", sourceUnit: "count", unitMultiplier: 1, color: "#14b8a6",
  },

  // --- Vitals ---
  HKQuantityTypeIdentifierHeartRate: {
    label: "Battito cardiaco", category: "vitals", displayUnit: "bpm", sourceUnit: "count/min", unitMultiplier: 1, color: "#ef4444",
  },
  HKQuantityTypeIdentifierRestingHeartRate: {
    label: "Battito a riposo", category: "vitals", displayUnit: "bpm", sourceUnit: "count/min", unitMultiplier: 1, color: "#dc2626",
  },
  HKQuantityTypeIdentifierWalkingHeartRateAverage: {
    label: "Battito in cammino", category: "vitals", displayUnit: "bpm", sourceUnit: "count/min", unitMultiplier: 1, color: "#f87171",
  },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: {
    label: "Variabilita' battito (HRV)", category: "vitals", displayUnit: "ms", sourceUnit: "ms", unitMultiplier: 1, color: "#ec4899",
  },
  HKQuantityTypeIdentifierOxygenSaturation: {
    label: "Saturazione O2", category: "vitals", displayUnit: "%", sourceUnit: "%", unitMultiplier: 100, color: "#3b82f6",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierRespiratoryRate: {
    label: "Frequenza respiratoria", category: "vitals", displayUnit: "atti/min", sourceUnit: "count/min", unitMultiplier: 1, color: "#6366f1",
  },
  HKQuantityTypeIdentifierBodyTemperature: {
    label: "Temperatura corporea", category: "vitals", displayUnit: "°C", sourceUnit: "degC", unitMultiplier: 1, color: "#f43f5e",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierBloodPressureSystolic: {
    label: "Pressione sistolica", category: "vitals", displayUnit: "mmHg", sourceUnit: "mmHg", unitMultiplier: 1, color: "#ef4444",
  },
  HKQuantityTypeIdentifierBloodPressureDiastolic: {
    label: "Pressione diastolica", category: "vitals", displayUnit: "mmHg", sourceUnit: "mmHg", unitMultiplier: 1, color: "#3b82f6",
  },
  HKQuantityTypeIdentifierBloodGlucose: {
    label: "Glicemia", category: "vitals", displayUnit: "mg/dL", sourceUnit: "mg/dL", unitMultiplier: 1, color: "#d946ef",
  },

  // --- Body ---
  HKQuantityTypeIdentifierBodyMass: {
    label: "Peso", category: "body", displayUnit: "kg", sourceUnit: "kg", unitMultiplier: 1, color: "#8b5cf6",
    formatValue: v => `${v.toFixed(2)}`,
  },
  HKQuantityTypeIdentifierHeight: {
    label: "Altezza", category: "body", displayUnit: "cm", sourceUnit: "m", unitMultiplier: 100, color: "#6366f1",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierBodyMassIndex: {
    label: "BMI", category: "body", displayUnit: "", sourceUnit: "count", unitMultiplier: 1, color: "#a78bfa",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierBodyFatPercentage: {
    label: "Grasso corporeo", category: "body", displayUnit: "%", sourceUnit: "%", unitMultiplier: 100, color: "#c084fc",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierLeanBodyMass: {
    label: "Massa magra", category: "body", displayUnit: "kg", sourceUnit: "kg", unitMultiplier: 1, color: "#9333ea",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierWaistCircumference: {
    label: "Circonferenza vita", category: "body", displayUnit: "cm", sourceUnit: "m", unitMultiplier: 100, color: "#7c3aed",
    formatValue: v => `${v.toFixed(1)}`,
  },

  // --- Nutrition ---
  HKQuantityTypeIdentifierDietaryEnergyConsumed: {
    label: "Calorie ingerite", category: "nutrition", displayUnit: "kcal", sourceUnit: "kcal", unitMultiplier: 1, color: "#f97316",
  },
  HKQuantityTypeIdentifierDietaryCarbohydrates: {
    label: "Carboidrati", category: "nutrition", displayUnit: "g", sourceUnit: "g", unitMultiplier: 1, color: "#eab308",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierDietaryFatTotal: {
    label: "Grassi", category: "nutrition", displayUnit: "g", sourceUnit: "g", unitMultiplier: 1, color: "#f59e0b",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierDietaryProtein: {
    label: "Proteine", category: "nutrition", displayUnit: "g", sourceUnit: "g", unitMultiplier: 1, color: "#dc2626",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierDietaryFiber: {
    label: "Fibre", category: "nutrition", displayUnit: "g", sourceUnit: "g", unitMultiplier: 1, color: "#16a34a",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierDietarySugar: {
    label: "Zuccheri", category: "nutrition", displayUnit: "g", sourceUnit: "g", unitMultiplier: 1, color: "#db2777",
    formatValue: v => `${v.toFixed(1)}`,
  },
  HKQuantityTypeIdentifierDietaryWater: {
    label: "Acqua", category: "nutrition", displayUnit: "L", sourceUnit: "L", unitMultiplier: 1, color: "#0ea5e9",
    formatValue: v => `${v.toFixed(2)}`,
  },
  HKQuantityTypeIdentifierDietaryCaffeine: {
    label: "Caffeina", category: "nutrition", displayUnit: "mg", sourceUnit: "g", unitMultiplier: 1000, color: "#713f12",
    formatValue: v => `${v.toFixed(1)}`,
  },

  // --- Fitness avanzato ---
  HKQuantityTypeIdentifierVO2Max: {
    label: "VO2 max", category: "fitness", displayUnit: "ml/kg·min", sourceUnit: "ml/(kg*min)", unitMultiplier: 1, color: "#10b981",
    formatValue: v => v.toFixed(1),
  },
  HKQuantityTypeIdentifierRunningPower: {
    label: "Potenza corsa", category: "fitness", displayUnit: "W", sourceUnit: "W", unitMultiplier: 1, color: "#f97316",
  },
  HKQuantityTypeIdentifierRunningSpeed: {
    label: "Velocita' corsa", category: "fitness", displayUnit: "km/h", sourceUnit: "m/s", unitMultiplier: 3.6, color: "#22c55e",
    formatValue: v => v.toFixed(2),
  },
  HKQuantityTypeIdentifierRunningStrideLength: {
    label: "Passo corsa", category: "fitness", displayUnit: "cm", sourceUnit: "m", unitMultiplier: 100, color: "#16a34a",
    formatValue: v => v.toFixed(1),
  },
  HKQuantityTypeIdentifierRunningGroundContactTime: {
    label: "Contatto terra corsa", category: "fitness", displayUnit: "ms", sourceUnit: "ms", unitMultiplier: 1, color: "#4ade80",
  },
  HKQuantityTypeIdentifierRunningVerticalOscillation: {
    label: "Oscillazione verticale", category: "fitness", displayUnit: "cm", sourceUnit: "cm", unitMultiplier: 1, color: "#86efac",
    formatValue: v => v.toFixed(1),
  },
  HKQuantityTypeIdentifierCyclingPower: {
    label: "Potenza bici", category: "fitness", displayUnit: "W", sourceUnit: "W", unitMultiplier: 1, color: "#0ea5e9",
  },
  HKQuantityTypeIdentifierCyclingCadence: {
    label: "Cadenza bici", category: "fitness", displayUnit: "rpm", sourceUnit: "count/min", unitMultiplier: 1, color: "#38bdf8",
  },
  HKQuantityTypeIdentifierCyclingSpeed: {
    label: "Velocita' bici", category: "fitness", displayUnit: "km/h", sourceUnit: "m/s", unitMultiplier: 3.6, color: "#06b6d4",
    formatValue: v => v.toFixed(2),
  },
  HKQuantityTypeIdentifierCyclingFunctionalThresholdPower: {
    label: "FTP bici", category: "fitness", displayUnit: "W", sourceUnit: "W", unitMultiplier: 1, color: "#0284c7",
  },
  HKQuantityTypeIdentifierStairAscentSpeed: {
    label: "Velocita' salita scale", category: "fitness", displayUnit: "m/s", sourceUnit: "m/s", unitMultiplier: 1, color: "#a855f7",
    formatValue: v => v.toFixed(2),
  },
  HKQuantityTypeIdentifierStairDescentSpeed: {
    label: "Velocita' discesa scale", category: "fitness", displayUnit: "m/s", sourceUnit: "m/s", unitMultiplier: 1, color: "#c084fc",
    formatValue: v => v.toFixed(2),
  },
  HKQuantityTypeIdentifierWalkingSpeed: {
    label: "Velocita' camminata", category: "fitness", displayUnit: "km/h", sourceUnit: "m/s", unitMultiplier: 3.6, color: "#84cc16",
    formatValue: v => v.toFixed(2),
  },
  HKQuantityTypeIdentifierWalkingStepLength: {
    label: "Passo camminata", category: "fitness", displayUnit: "cm", sourceUnit: "m", unitMultiplier: 100, color: "#65a30d",
    formatValue: v => v.toFixed(1),
  },
  HKQuantityTypeIdentifierWalkingAsymmetryPercentage: {
    label: "Asimmetria camminata", category: "fitness", displayUnit: "%", sourceUnit: "%", unitMultiplier: 100, color: "#eab308",
    formatValue: v => v.toFixed(1),
  },
  HKQuantityTypeIdentifierWalkingDoubleSupportPercentage: {
    label: "Doppio supporto camminata", category: "fitness", displayUnit: "%", sourceUnit: "%", unitMultiplier: 100, color: "#facc15",
    formatValue: v => v.toFixed(1),
  },
  HKQuantityTypeIdentifierSixMinuteWalkTestDistance: {
    label: "Test 6 min camminata", category: "fitness", displayUnit: "m", sourceUnit: "m", unitMultiplier: 1, color: "#fb923c",
  },

  // --- Other ---
  HKQuantityTypeIdentifierElectrodermalActivity: {
    label: "Attivita elettrodermica", category: "other", displayUnit: "S", sourceUnit: "S", unitMultiplier: 1, color: "#64748b",
    formatValue: v => `${v.toFixed(3)}`,
  },
  HKQuantityTypeIdentifierNumberOfTimesFallen: {
    label: "Cadute", category: "other", displayUnit: "eventi", sourceUnit: "count", unitMultiplier: 1, color: "#dc2626",
  },
  HKQuantityTypeIdentifierUvExposure: {
    label: "Esposizione UV", category: "other", displayUnit: "indice", sourceUnit: "count", unitMultiplier: 1, color: "#facc15",
  },
}

export function getMeta(type: string): TypeMeta {
  return (
    TYPE_META[type] ?? {
      label: type.replace("HKQuantityTypeIdentifier", "").replace("HKCategoryTypeIdentifier", ""),
      category: "other",
      displayUnit: "",
      sourceUnit: "",
      unitMultiplier: 1,
      color: "#6b7280",
    }
  )
}

export const CATEGORIES: Record<Category, { label: string; types: string[] }> = {
  activity: {
    label: "Attivita",
    types: [
      "HKQuantityTypeIdentifierStepCount",
      "HKQuantityTypeIdentifierDistanceWalkingRunning",
      "HKQuantityTypeIdentifierDistanceCycling",
      "HKQuantityTypeIdentifierDistanceSwimming",
      "HKQuantityTypeIdentifierActiveEnergyBurned",
      "HKQuantityTypeIdentifierBasalEnergyBurned",
      "HKQuantityTypeIdentifierFlightsClimbed",
      "HKQuantityTypeIdentifierAppleExerciseTime",
      "HKQuantityTypeIdentifierAppleStandTime",
    ],
  },
  vitals: {
    label: "Vitali",
    types: [
      "HKQuantityTypeIdentifierHeartRate",
      "HKQuantityTypeIdentifierRestingHeartRate",
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      "HKQuantityTypeIdentifierOxygenSaturation",
      "HKQuantityTypeIdentifierRespiratoryRate",
      "HKQuantityTypeIdentifierBodyTemperature",
      "HKQuantityTypeIdentifierBloodPressureSystolic",
      "HKQuantityTypeIdentifierBloodPressureDiastolic",
    ],
  },
  body: {
    label: "Corpo",
    types: [
      "HKQuantityTypeIdentifierBodyMass",
      "HKQuantityTypeIdentifierBodyMassIndex",
      "HKQuantityTypeIdentifierBodyFatPercentage",
      "HKQuantityTypeIdentifierLeanBodyMass",
      "HKQuantityTypeIdentifierHeight",
      "HKQuantityTypeIdentifierWaistCircumference",
    ],
  },
  nutrition: {
    label: "Nutrizione",
    types: [
      "HKQuantityTypeIdentifierDietaryEnergyConsumed",
      "HKQuantityTypeIdentifierDietaryCarbohydrates",
      "HKQuantityTypeIdentifierDietaryFatTotal",
      "HKQuantityTypeIdentifierDietaryProtein",
      "HKQuantityTypeIdentifierDietaryFiber",
      "HKQuantityTypeIdentifierDietarySugar",
      "HKQuantityTypeIdentifierDietaryWater",
      "HKQuantityTypeIdentifierDietaryCaffeine",
    ],
  },
  fitness: {
    label: "Fitness",
    types: [
      "HKQuantityTypeIdentifierVO2Max",
      "HKQuantityTypeIdentifierRunningSpeed",
      "HKQuantityTypeIdentifierRunningPower",
      "HKQuantityTypeIdentifierRunningStrideLength",
      "HKQuantityTypeIdentifierRunningGroundContactTime",
      "HKQuantityTypeIdentifierRunningVerticalOscillation",
      "HKQuantityTypeIdentifierCyclingSpeed",
      "HKQuantityTypeIdentifierCyclingPower",
      "HKQuantityTypeIdentifierCyclingCadence",
      "HKQuantityTypeIdentifierCyclingFunctionalThresholdPower",
      "HKQuantityTypeIdentifierWalkingSpeed",
      "HKQuantityTypeIdentifierWalkingStepLength",
      "HKQuantityTypeIdentifierWalkingAsymmetryPercentage",
      "HKQuantityTypeIdentifierWalkingDoubleSupportPercentage",
      "HKQuantityTypeIdentifierStairAscentSpeed",
      "HKQuantityTypeIdentifierStairDescentSpeed",
      "HKQuantityTypeIdentifierSixMinuteWalkTestDistance",
    ],
  },
  other: { label: "Altro", types: [] },
}

export const SLEEP_STAGES: Record<number, { label: string; color: string }> = {
  0: { label: "A letto", color: "#94a3b8" },
  1: { label: "Addormentato (non specificato)", color: "#64748b" },
  2: { label: "Sveglio", color: "#f87171" },
  3: { label: "Core", color: "#60a5fa" },
  4: { label: "Deep", color: "#1e40af" },
  5: { label: "REM", color: "#a78bfa" },
}

export const WORKOUT_NAMES: Record<number, string> = {
  1: "Football americano",
  2: "Tiro con l'arco",
  3: "Football australiano",
  4: "Badminton",
  5: "Baseball",
  6: "Basket",
  7: "Bowling",
  8: "Boxe",
  9: "Arrampicata",
  10: "Cricket",
  11: "Cross Training",
  12: "Curling",
  13: "Ciclismo",
  14: "Danza",
  16: "Ellittica",
  17: "Equitazione",
  18: "Scherma",
  19: "Pesca",
  20: "Functional Strength Training",
  21: "Golf",
  22: "Ginnastica",
  23: "Pallamano",
  24: "Hiking",
  25: "Hockey",
  26: "Caccia",
  27: "Lacrosse",
  28: "Arti marziali",
  29: "Mind & Body",
  31: "Paddle",
  32: "Gioco",
  33: "Preparazione e recupero",
  34: "Racquetball",
  35: "Rowing",
  36: "Rugby",
  37: "Corsa",
  38: "Vela",
  39: "Pattinaggio",
  40: "Sport invernali",
  41: "Calcio",
  42: "Softball",
  43: "Squash",
  44: "Stair Climbing",
  45: "Surf",
  46: "Nuoto",
  47: "Ping pong",
  48: "Tennis",
  49: "Atletica leggera",
  50: "Traditional Strength Training",
  51: "Pallavolo",
  52: "Camminata",
  53: "Water Fitness",
  54: "Pallanuoto",
  55: "Water Sports",
  56: "Lotta",
  57: "Yoga",
  58: "Barre",
  59: "Core Training",
  60: "Sci di fondo",
  61: "Sci alpino",
  62: "Flessibilita'",
  63: "HIIT",
  64: "Salto con la corda",
  65: "Kickboxing",
  66: "Pilates",
  67: "Snowboard",
  68: "Scale",
  69: "Step",
  70: "Carrozzina camminata",
  71: "Carrozzina corsa",
  72: "Tai Chi",
  73: "Cardio misto",
  74: "Handbike",
  75: "Disc sports",
  76: "Fitness gaming",
  77: "Cardio dance",
  78: "Danza sociale",
  79: "Pickleball",
  80: "Cooldown",
  82: "Allenamento funzionale",
  83: "Swim Bike Run",
  84: "Transizione",
  3000: "Altro",
}

/** Build a user-friendly workout name. Detects indoor cardio from metadata
 *  (treadmill: running/walking with HKIndoorWorkout=true). */
export function workoutName(type: number, metadata?: Record<string, unknown> | null): string {
  const indoor = metadata && (metadata as any).HKIndoorWorkout === "1"
  if (indoor) {
    if (type === 37) return "Tapis roulant (corsa)"
    if (type === 52) return "Tapis roulant (camminata)"
    if (type === 13) return "Cyclette"
  }
  return WORKOUT_NAMES[type] ?? `Workout (${type})`
}
