import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useSamples } from "@/lib/queries"
import { computeRecoveryStatus, type RecoveryFlag } from "@/lib/recoveryScore"
import type { Sample } from "@/lib/types"

const HRV = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
const RHR = "HKQuantityTypeIdentifierRestingHeartRate"

function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

const STATUS_DOT: Record<RecoveryFlag["status"], string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
}
const STATUS_TEXT: Record<RecoveryFlag["status"], string> = {
  green: "text-emerald-600",
  amber: "text-amber-600",
  red: "text-rose-600",
}

const FLAG_HELP: Record<RecoveryFlag["key"], string> = {
  hrv_rolling:
    "L'HRV notturna varia anche ±20% giorno per giorno a parità di stato fisiologico, " +
    "quindi il singolo valore di una notte e' rumoroso. La media mobile su 7 giorni " +
    "(rolling 7g) e' un segnale piu' stabile, e va confrontata col tuo baseline " +
    "personale di 60 giorni — finestra raccomandata da Plews 2013 per atleti. " +
    "Soglia clinica: se la rolling 7g scende oltre 1 deviazione standard sotto il " +
    "baseline e' un marker di stress autonomico cronico.",
  rhr_delta:
    "La FC a riposo e' molto stabile nel tempo per la stessa persona (~58-65 bpm di " +
    "range tipico). Un aumento di oltre +5 bpm rispetto al baseline 60g e' un marker " +
    "validato di stress, malattia incipiente, sovrallenamento o disidratazione " +
    "(Achten & Jeukendrup 2003). E' uno dei pochi indicatori che i medici sportivi " +
    "consigliano di monitorare ogni mattina, dato il suo basso costo e alta " +
    "informativita'.",
  hrv_streak:
    "Anche se l'HRV di oggi rientra nei limiti normali, una sequenza di 3+ giorni " +
    "consecutivi sotto la media e' un trend che vale la pena fermare prima che " +
    "diventi un problema. Plews 2013 e Stanley 2013 mostrano che lo streak e' un " +
    "predittore indipendente di overtraining/malattia, anche quando i valori " +
    "assoluti non sembrano allarmanti.",
}

export function RecoveryCard() {
  // Servono ~75 giorni per coprire baseline 60g + qualche buffer.
  const { todayISO, startISO, endISO } = useMemo(() => {
    const t = new Date()
    const today = new Date(t.getFullYear(), t.getMonth(), t.getDate())
    const start = new Date(today); start.setDate(start.getDate() - 75)
    const end = new Date(today); end.setDate(end.getDate() + 1)
    return {
      todayISO: localISODate(today),
      startISO: start.toISOString(),
      endISO: end.toISOString(),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [new Date().toDateString()])

  const hrvQ = useSamples({ type: HRV, start: startISO, end: endISO, aggregation: "none", limit: 10000 })
  const rhrQ = useSamples({ type: RHR, start: startISO, end: endISO, aggregation: "none", limit: 2000 })

  const result = useMemo(() => {
    if (!hrvQ.data || !rhrQ.data) return null
    return computeRecoveryStatus(
      todayISO,
      hrvQ.data.data as Sample[],
      rhrQ.data.data as Sample[],
    )
  }, [hrvQ.data, rhrQ.data, todayISO])

  const loading = hrvQ.isLoading || rhrQ.isLoading

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stato di recupero</CardTitle>
        <CardDescription>
          Tre flag indipendenti su soglie validate dalla letteratura sportiva, non un punteggio aggregato
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-24 animate-pulse bg-muted rounded" />
        ) : !result ? (
          <p className="text-sm text-muted-foreground">
            Dati insufficienti: servono almeno ~2 settimane di HRV e FC a riposo per costruire il baseline.
          </p>
        ) : (
          <div className="space-y-4">
            <details className="text-xs text-muted-foreground bg-muted/30 rounded p-3">
              <summary className="cursor-pointer font-medium text-foreground">Come funziona questo score</summary>
              <div className="mt-2 space-y-2 leading-relaxed">
                <p>
                  Invece di una media pesata "ad cazzum" di vari biomarker (come fanno Bevel,
                  Whoop, Oura), questa card mostra <strong>tre indicatori indipendenti</strong>,
                  ognuno con la sua soglia validata da studi clinici.
                </p>
                <p>
                  Ogni flag e' verde/ambra/rosso. Il <strong>verdetto finale</strong> in alto e' il
                  peggiore dei tre — se anche un solo segnale e' rosso, prevale.
                </p>
                <p>
                  Il <strong>baseline 60g</strong> e' il riferimento personale: ogni metrica viene
                  confrontata col tuo storico recente, non con valori "da popolazione".
                </p>
              </div>
            </details>

            <div className="flex items-baseline justify-between">
              <div className={`text-4xl font-bold ${result.color}`}>{result.verdict}</div>
              {result.partial && (
                <span className="text-xs text-amber-600">parziale ({result.flags.length}/3 flag)</span>
              )}
            </div>

            <div className="space-y-3 pt-2 border-t">
              {result.flags.map(f => (
                <FlagRow key={f.key} f={f} />
              ))}
            </div>

            <p className="text-[10px] text-muted-foreground">
              HRV rolling 7g vs baseline 60g (Plews 2013); RHR vs baseline 60g, soglia +5 bpm (Achten 2003);
              streak HRV consecutiva sotto baseline (Plews 2013, Stanley 2013). Verdetto = peggior flag.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FlagRow({ f }: { f: RecoveryFlag }) {
  return (
    <div className="text-sm">
      <div className="flex items-start gap-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${STATUS_DOT[f.status]}`} />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline gap-2 flex-wrap">
            <span className="font-medium">{f.label}</span>
            <span className="tabular-nums text-foreground font-semibold">{f.value}</span>
          </div>
          <div className={`text-xs ${STATUS_TEXT[f.status]} mt-0.5`}>{f.detail}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Baseline: {f.baseline}
          </div>
          {f.spark && f.spark.length >= 3 && <Sparkline values={f.spark} status={f.status} />}
          <details className="mt-2 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground transition-colors">
              Cosa significa
            </summary>
            <p className="mt-1.5 leading-relaxed pl-1">{FLAG_HELP[f.key]}</p>
          </details>
        </div>
      </div>
    </div>
  )
}

function Sparkline({ values, status }: { values: number[]; status: RecoveryFlag["status"] }) {
  const w = 120, h = 24
  const min = Math.min(...values), max = Math.max(...values)
  const range = max - min || 1
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(" ")
  const stroke = status === "green" ? "#10b981" : status === "amber" ? "#f59e0b" : "#f43f5e"
  return (
    <svg width={w} height={h} className="mt-1.5 block">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
