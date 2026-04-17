import { useMemo, useState } from "react"
import { CheckCircle2, CircleAlert, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useAllowedWriteTypes, useCreateWrite, useRecentWrites } from "@/lib/queries"
import { getMeta } from "@/lib/healthkit"
import { formatDateTime } from "@/lib/utils"
import type { PendingWrite } from "@/lib/types"

const BODY_TYPES = [
  "HKQuantityTypeIdentifierBodyMass",
  "HKQuantityTypeIdentifierHeight",
  "HKQuantityTypeIdentifierBodyMassIndex",
  "HKQuantityTypeIdentifierBodyFatPercentage",
  "HKQuantityTypeIdentifierLeanBodyMass",
  "HKQuantityTypeIdentifierWaistCircumference",
]

const NUTRITION_TYPES = [
  "HKQuantityTypeIdentifierDietaryEnergyConsumed",
  "HKQuantityTypeIdentifierDietaryCarbohydrates",
  "HKQuantityTypeIdentifierDietaryFatTotal",
  "HKQuantityTypeIdentifierDietaryProtein",
  "HKQuantityTypeIdentifierDietaryFiber",
  "HKQuantityTypeIdentifierDietarySugar",
  "HKQuantityTypeIdentifierDietaryWater",
  "HKQuantityTypeIdentifierDietaryCaffeine",
]

function localDatetimeInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function InsertForm({ types }: { types: string[] }) {
  const allowed = useAllowedWriteTypes()
  const mutation = useCreateWrite()
  const [type, setType] = useState(types[0])
  const [value, setValue] = useState("")
  const [unit, setUnit] = useState<string>("")
  const [when, setWhen] = useState(localDatetimeInput())
  const [notes, setNotes] = useState("")
  const [submittedBanner, setSubmittedBanner] = useState<string | null>(null)

  const availableUnits = useMemo(() => {
    return allowed.data?.[type] ?? []
  }, [allowed.data, type])

  // default first unit when type changes
  if (availableUnits.length > 0 && !availableUnits.includes(unit)) {
    setUnit(availableUnits[0])
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value || !unit) return
    const numValue = parseFloat(value)
    if (Number.isNaN(numValue)) return

    const iso = new Date(when).toISOString()
    try {
      await mutation.mutateAsync({
        type,
        value: numValue,
        unit,
        start_date: iso,
        end_date: iso,
        notes: notes || undefined,
        source_name: "Web Dashboard",
      })
      setSubmittedBanner(`Inviato: ${getMeta(type).label} ${numValue} ${unit}`)
      setValue("")
      setNotes("")
      setTimeout(() => setSubmittedBanner(null), 4000)
    } catch (err) {
      setSubmittedBanner(`Errore: ${(err as Error).message}`)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map(t => (
                <SelectItem key={t} value={t}>{getMeta(t).label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Data e ora</Label>
          <Input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} required />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2 md:col-span-2">
          <Label>Valore</Label>
          <Input
            type="number"
            step="any"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="es. 75.5"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Unita'</Label>
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableUnits.map(u => (
                <SelectItem key={u} value={u}>{u || "count"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Note (opzionale)</Label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="note opzionali..." />
      </div>

      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Invio..." : "Invia"}
      </Button>

      {submittedBanner && (
        <div className="text-sm text-muted-foreground">{submittedBanner}</div>
      )}
    </form>
  )
}

function StatusBadge({ w }: { w: PendingWrite }) {
  if (w.status === "written") {
    return <span className="inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> scritto</span>
  }
  if (w.status === "failed") {
    return <span className="inline-flex items-center gap-1 text-red-600 text-xs"><CircleAlert className="h-3.5 w-3.5" /> errore</span>
  }
  return <span className="inline-flex items-center gap-1 text-amber-600 text-xs"><Clock className="h-3.5 w-3.5" /> in attesa</span>
}

export default function Insert() {
  const recent = useRecentWrites(50)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Inserisci dato</h1>
        <p className="text-muted-foreground">I dati inseriti qui verranno scritti su Apple Health dal tuo iPhone alla prossima sync.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="body">
            <TabsList>
              <TabsTrigger value="body">Corpo</TabsTrigger>
              <TabsTrigger value="nutrition">Nutrizione</TabsTrigger>
            </TabsList>
            <TabsContent value="body"><InsertForm types={BODY_TYPES} /></TabsContent>
            <TabsContent value="nutrition"><InsertForm types={NUTRITION_TYPES} /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ultime scritture</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.data && recent.data.length > 0 ? (
            <div className="space-y-2">
              {recent.data.map(w => (
                <div key={w.id} className="flex flex-wrap items-center gap-3 py-2 border-b last:border-0 text-sm">
                  <StatusBadge w={w} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">
                      {getMeta(w.type).label}
                      <span className="text-muted-foreground font-normal ml-1">
                        {w.value} {w.unit}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(w.start_date)}
                      {w.error_message && <span className="ml-2 text-red-600">• {w.error_message}</span>}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDateTime(w.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nessuna scrittura recente</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
