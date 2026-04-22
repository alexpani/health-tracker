import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useStretchingSessions } from "@/lib/queries"

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function daysAgoISO(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default function Stretching() {
  const [from, setFrom] = useState<string>(daysAgoISO(30))
  const [to, setTo] = useState<string>(todayLocalISO())

  const { data, isLoading, error } = useStretchingSessions(from, to)

  const sessions = useMemo(() => data ?? [], [data])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Stretching</h1>
        <p className="text-muted-foreground">
          Sessioni di stretching registrate dall'app PWA. Dati forniti a scopo informativo, non costituiscono consigli medici.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Periodo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label htmlFor="from">Da</Label>
            <Input id="from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">A</Label>
            <Input id="to" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sessioni ({sessions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-muted-foreground">Caricamento…</p>}
          {error && <p className="text-destructive">Errore: {String(error)}</p>}
          {!isLoading && !error && sessions.length === 0 && (
            <p className="text-muted-foreground">Nessuna sessione nel periodo selezionato.</p>
          )}
          {sessions.length > 0 && (
            <pre className="text-xs overflow-auto bg-muted p-3 rounded-md">
              {JSON.stringify(sessions, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
