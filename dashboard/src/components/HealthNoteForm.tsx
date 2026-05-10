import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useCreateHealthNote, useDeleteHealthNote, useUpdateHealthNote } from "@/lib/queries"
import { BODY_ZONES_PRESET, CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/healthNotes"
import type { HealthNote, HealthNoteCategory } from "@/lib/types"

interface Props {
  /** Quando passato, il form e' in modalita' edit */
  note?: HealthNote | null
  /** Defaults per la create (es. start/end_date = giorno corrente). Ignorato in edit. */
  defaults?: { start_date?: string; end_date?: string }
  onClose: () => void
  /** Mostra anche il pulsante di delete in edit mode */
  allowDelete?: boolean
}

export function HealthNoteForm({ note, defaults, onClose, allowDelete = true }: Props) {
  const isEdit = !!note
  const [category, setCategory] = useState<HealthNoteCategory>(note?.category ?? "pain")
  const [bodyZone, setBodyZone] = useState(note?.body_zone ?? "")
  const [text, setText] = useState(note?.text ?? "")
  const [startDate, setStartDate] = useState(note?.start_date ?? defaults?.start_date ?? "")
  const [endDate, setEndDate] = useState(note?.end_date ?? defaults?.end_date ?? defaults?.start_date ?? "")
  const [error, setError] = useState<string | null>(null)

  const create = useCreateHealthNote()
  const update = useUpdateHealthNote()
  const remove = useDeleteHealthNote()

  useEffect(() => {
    if (note) {
      setCategory(note.category)
      setBodyZone(note.body_zone ?? "")
      setText(note.text)
      setStartDate(note.start_date)
      setEndDate(note.end_date)
    }
  }, [note])

  // Auto-popolamento end_date quando l'utente cambia start_date e end_date e' vuoto o piu' piccolo
  const handleStartChange = (val: string) => {
    setStartDate(val)
    if (!isEdit && (!endDate || endDate < val)) {
      setEndDate(val)
    }
  }

  const submit = async () => {
    setError(null)
    if (!text.trim()) {
      setError("Il testo è obbligatorio")
      return
    }
    if (!startDate) {
      setError("La data di inizio è obbligatoria")
      return
    }
    if (endDate && endDate < startDate) {
      setError("La data di fine non può essere prima di quella di inizio")
      return
    }
    const payload = {
      category,
      body_zone: bodyZone.trim() || null,
      text: text.trim(),
      start_date: startDate,
      end_date: endDate || startDate,
    }
    try {
      if (isEdit && note) {
        await update.mutateAsync({ id: note.id, patch: payload })
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
    if (!note) return
    if (!confirm("Eliminare questa nota?")) return
    try {
      await remove.mutateAsync(note.id)
      onClose()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Errore"
      setError(msg)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <CardHeader>
          <CardTitle>{isEdit ? "Modifica nota" : "Nuova nota di salute"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={v => setCategory(v as HealthNoteCategory)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_ORDER.map(c => (
                  <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="body-zone">Zona corporea</Label>
            <Input
              id="body-zone"
              value={bodyZone}
              onChange={e => setBodyZone(e.target.value)}
              placeholder="Es. Ginocchio dx"
              list="health-note-zones"
              autoComplete="off"
            />
            <datalist id="health-note-zones">
              {BODY_ZONES_PRESET.map(z => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">Opzionale. Puoi scegliere dai suggerimenti o scrivere libero.</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="note-text">Descrizione</Label>
            <Textarea
              id="note-text"
              value={text}
              onChange={e => setText(e.target.value)}
              rows={3}
              placeholder="Es. Dolore acuto al ginocchio dx dopo la corsa"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Inizio</Label>
              <Input type="date" value={startDate} onChange={e => handleStartChange(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Fine</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">Default = giorno di inizio</p>
            </div>
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
    </div>
  )
}
