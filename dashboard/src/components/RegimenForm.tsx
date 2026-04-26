import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useCreateRegimen, useDeleteRegimen, useUpdateRegimen } from "@/lib/queries"
import type { Regimen, RegimenKind } from "@/lib/types"

const KIND_LABELS: Record<RegimenKind, string> = {
  medication: "Farmaco",
  supplement: "Integratore",
  diet: "Piano alimentare",
  training: "Piano di allenamento",
}

interface Props {
  /** Quando passato, il form e' in modalita' edit */
  regimen?: Regimen | null
  /** Defaults per la create (es. start_date = oggi). Ignorato in edit. */
  defaults?: { kind?: RegimenKind; start_date?: string }
  onClose: () => void
  /** Mostra anche il pulsante di delete in edit mode */
  allowDelete?: boolean
}

export function RegimenForm({ regimen, defaults, onClose, allowDelete = true }: Props) {
  const isEdit = !!regimen
  const [kind, setKind] = useState<RegimenKind>(regimen?.kind ?? defaults?.kind ?? "medication")
  const [name, setName] = useState(regimen?.name ?? "")
  const [startDate, setStartDate] = useState(regimen?.start_date ?? defaults?.start_date ?? "")
  const [endDate, setEndDate] = useState(regimen?.end_date ?? "")
  const [dose, setDose] = useState(regimen?.dose ?? "")
  const [notes, setNotes] = useState(regimen?.notes ?? "")
  const [error, setError] = useState<string | null>(null)

  const create = useCreateRegimen()
  const update = useUpdateRegimen()
  const remove = useDeleteRegimen()

  useEffect(() => {
    if (regimen) {
      setKind(regimen.kind)
      setName(regimen.name)
      setStartDate(regimen.start_date ?? "")
      setEndDate(regimen.end_date ?? "")
      setDose(regimen.dose ?? "")
      setNotes(regimen.notes ?? "")
    }
  }, [regimen])

  const submit = async () => {
    setError(null)
    if (!name.trim()) {
      setError("Il nome è obbligatorio")
      return
    }
    if (startDate && endDate && endDate < startDate) {
      setError("La data di fine non può essere prima della data di inizio")
      return
    }
    const payload = {
      kind,
      name: name.trim(),
      start_date: startDate || null,
      end_date: endDate || null,
      dose: dose.trim() || null,
      notes: notes.trim() || null,
    }
    try {
      if (isEdit && regimen) {
        await update.mutateAsync({ id: regimen.id, patch: payload })
      } else {
        await create.mutateAsync(payload)
      }
      onClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore"
      setError(msg)
    }
  }

  const handleDelete = async () => {
    if (!regimen) return
    if (!confirm(`Eliminare "${regimen.name}"?`)) return
    try {
      await remove.mutateAsync(regimen.id)
      onClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore"
      setError(msg)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Modifica regime" : "Nuovo regime"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>Tipo</Label>
          <Select value={kind} onValueChange={v => setKind(v as RegimenKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Nome</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Es. Vitamin D3" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Inizio</Label>
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">Vuoto = "iniziato prima del tracking"</p>
          </div>
          <div className="grid gap-2">
            <Label>Fine</Label>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">Vuoto = "in corso"</p>
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Dose / dettagli</Label>
          <Input value={dose} onChange={e => setDose(e.target.value)} placeholder="Es. 2000 UI/die" />
        </div>

        <div className="grid gap-2">
          <Label>Note</Label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-between">
          <div>
            {isEdit && allowDelete && (
              <Button variant="destructive" onClick={handleDelete} disabled={remove.isPending}>
                Elimina
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Annulla</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending}>
              {isEdit ? "Salva" : "Crea"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export { KIND_LABELS }
