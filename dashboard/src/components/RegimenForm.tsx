import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useCreateRegimen, useDeleteRegimen, useRegimens, useUpdateRegimen } from "@/lib/queries"
import type { Regimen, RegimenKind } from "@/lib/types"
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock"

const KIND_LABELS: Record<RegimenKind, string> = {
  medication: "Farmaco",
  supplement: "Integratore",
  diet: "Piano alimentare",
  training: "Piano di allenamento",
  gear: "Scarpe da corsa",
}

// Tutti i tipi si possono inserire manualmente
const MANUAL_KINDS: RegimenKind[] = ["medication", "supplement", "diet", "training", "gear"]

interface Props {
  /** Quando passato, il form e' in modalita' edit */
  regimen?: Regimen | null
  /** Quando passato (e regimen nullo), il form e' in CREATE pre-compilato dai
   *  campi di questo regime (nome/dose/note/kind/metadata) ma con DATE VUOTE. */
  duplicateFrom?: Regimen | null
  /** Defaults per la create (es. start_date = oggi). Ignorato in edit. */
  defaults?: { kind?: RegimenKind; start_date?: string }
  onClose: () => void
  /** Callback "Duplica": il parent chiude questo modale e ne apre uno nuovo in
   *  modalita' duplicateFrom. Mostrato solo per i regimi terminati. */
  onDuplicate?: (source: Regimen) => void
  /** Mostra anche il pulsante di delete in edit mode */
  allowDelete?: boolean
}

export function RegimenForm({ regimen, duplicateFrom, defaults, onClose, onDuplicate, allowDelete = true }: Props) {
  useBodyScrollLock()
  const isEdit = !!regimen
  // Sorgente per i campi non-data: regime in edit, oppure quello da duplicare.
  const src = regimen ?? duplicateFrom ?? null
  const initialKind: RegimenKind = (() => {
    const k = src?.kind ?? defaults?.kind ?? "medication"
    // Edit/duplica di un piano alimentare? lascia diet per visualizzazione.
    if (src?.kind === "diet") return "diet"
    return MANUAL_KINDS.includes(k) ? k : "medication"
  })()
  const [kind, setKind] = useState<RegimenKind>(initialKind)
  const [name, setName] = useState(src?.name ?? "")
  // Date: SOLO da regimen (edit) o defaults (create). In duplica restano vuote.
  const [startDate, setStartDate] = useState(regimen?.start_date ?? defaults?.start_date ?? "")
  const [endDate, setEndDate] = useState(regimen?.end_date ?? "")
  const [dose, setDose] = useState(src?.dose ?? "")
  const [notes, setNotes] = useState(src?.notes ?? "")
  const [kcalTarget, setKcalTarget] = useState(src?.metadata?.kcal_target ?? "")
  const [proteinPct, setProteinPct] = useState(src?.metadata?.protein_pct ?? "")
  const [fatPct, setFatPct] = useState(src?.metadata?.fat_pct ?? "")
  const [carbsPct, setCarbsPct] = useState(src?.metadata?.carbs_pct ?? "")
  const [showNutritionFields, setShowNutritionFields] = useState(initialKind === "diet" && !!src)
  const [error, setError] = useState<string | null>(null)

  // Un regime e' "terminato" se ha una end_date passata. Usato per gate del
  // pulsante Duplica (ha senso ripartire da un regime concluso).
  const todayIso = new Date().toISOString().slice(0, 10)
  const isEnded = !!regimen?.end_date && regimen.end_date < todayIso

  const create = useCreateRegimen()
  const update = useUpdateRegimen()
  const remove = useDeleteRegimen()

  // Lista nomi distinti per il kind corrente (case-insensitive),
  // usati per autocomplete + rilevamento duplicati. Include anche
  // i regimens terminati: voglio suggerire un nome anche se preso
  // tempo fa, per raggruppare i due periodi sulla stessa linea.
  const allRegimens = useRegimens({ kind, include_ended: true })
  const existingNames = useMemo(() => {
    const set = new Map<string, string>()
    for (const r of allRegimens.data ?? []) {
      // Skip se editing e questo e' lo stesso regime
      if (regimen && r.id === regimen.id) continue
      const norm = r.name.trim().toLowerCase()
      if (!norm) continue
      if (!set.has(norm)) set.set(norm, r.name.trim())
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b, 'it'))
  }, [allRegimens.data, regimen])

  // Match case-insensitive col nome digitato: mostra hint se esiste gia'
  const duplicateMatch = useMemo(() => {
    const norm = name.trim().toLowerCase()
    if (!norm) return null
    return existingNames.find(n => n.toLowerCase() === norm) ?? null
  }, [name, existingNames])

  useEffect(() => {
    if (regimen) {
      setKind(regimen.kind)
      setName(regimen.name)
      setStartDate(regimen.start_date ?? "")
      setEndDate(regimen.end_date ?? "")
      setDose(regimen.dose ?? "")
      setNotes(regimen.notes ?? "")
      setKcalTarget(regimen.metadata?.kcal_target ?? "")
      setProteinPct(regimen.metadata?.protein_pct ?? "")
      setFatPct(regimen.metadata?.fat_pct ?? "")
      setCarbsPct(regimen.metadata?.carbs_pct ?? "")
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
    const payload: any = {
      kind,
      name: name.trim(),
      start_date: startDate || null,
      end_date: endDate || null,
      dose: kind === "training" ? null : (dose.trim() || null),
      notes: notes.trim() || null,
    }

    // Aggiungi metadata per piani alimentari
    if (kind === "diet") {
      const meta: Record<string, number> = {}
      if (kcalTarget) meta.kcal_target = parseFloat(String(kcalTarget))
      if (proteinPct) meta.protein_pct = parseFloat(String(proteinPct))
      if (fatPct) meta.fat_pct = parseFloat(String(fatPct))
      if (carbsPct) meta.carbs_pct = parseFloat(String(carbsPct))
      payload.metadata = Object.keys(meta).length > 0 ? meta : null
    } else {
      payload.metadata = null
    }
    try {
      if (isEdit && regimen) {
        await update.mutateAsync({ id: regimen.id, patch: payload })
      } else {
        await create.mutateAsync(payload)
      }
      onClose()
    } catch (e: unknown) {
      // Log esplicito in console: se la modal copre il messaggio di
      // errore in basso, almeno l'utente puo' aprire devtools.
      console.error("RegimenForm submit failed:", e, "payload:", payload)
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
      console.error("RegimenForm delete failed:", e)
      const msg = e instanceof Error ? e.message : "Errore"
      setError(msg)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4 sm:p-8"
    >
      <Card
        className="w-full max-w-lg shadow-2xl"
      >
      <CardHeader>
        <CardTitle>{isEdit ? "Modifica regime" : duplicateFrom ? "Duplica regime" : "Nuovo regime"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Errore in alto cosi' e' sempre visibile (la modal puo' essere
            piu' alta del viewport, ma l'utente vede sempre la testata). */}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="grid gap-2">
          <Label>Tipo</Label>
          <Select value={kind} onValueChange={v => setKind(v as RegimenKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MANUAL_KINDS.map(k => (
                <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Nome</Label>
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Es. Vitamin D3"
            list="regimen-names"
            autoComplete="off"
          />
          <datalist id="regimen-names">
            {existingNames.map(n => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {duplicateMatch && !isEdit && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Esiste già un "{duplicateMatch}" — verrà mostrato come secondo periodo sulla stessa riga della timeline.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Inizio</Label>
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              disabled={regimen?.source === "training_autodetect"}
              title={regimen?.source === "training_autodetect" ? "Calcolato automaticamente dai workout, non modificabile" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {regimen?.source === "training_autodetect"
                ? "Calcolato dallo script di autodetect"
                : 'Vuoto = "iniziato prima del tracking"'}
            </p>
          </div>
          <div className="grid gap-2">
            <Label>Fine</Label>
            <Input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              disabled={regimen?.source === "training_autodetect"}
              title={regimen?.source === "training_autodetect" ? "Calcolato automaticamente dai workout, non modificabile" : undefined}
            />
            <p className="text-xs text-muted-foreground">
              {regimen?.source === "training_autodetect"
                ? "Calcolato dallo script di autodetect"
                : 'Vuoto = "in corso"'}
            </p>
          </div>
        </div>

        {kind === "diet" ? (
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => setShowNutritionFields(!showNutritionFields)}
              className="flex items-center gap-2 text-left text-sm font-medium"
            >
              <span>{showNutritionFields ? "▼" : "▶"}</span>
              Dati nutrizionali
            </button>
            {showNutritionFields && (
              <div className="pl-4 space-y-3 border-l border-muted">
                <div className="grid gap-2">
                  <Label htmlFor="kcal">Kcal giornaliere</Label>
                  <Input
                    id="kcal"
                    type="number"
                    value={kcalTarget}
                    onChange={e => setKcalTarget(e.target.value)}
                    placeholder="Es. 2200"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="grid gap-2">
                    <Label htmlFor="protein">Proteine %</Label>
                    <Input
                      id="protein"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={proteinPct}
                      onChange={e => setProteinPct(e.target.value)}
                      placeholder="30"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="fat">Grassi %</Label>
                    <Input
                      id="fat"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={fatPct}
                      onChange={e => setFatPct(e.target.value)}
                      placeholder="25"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="carbs">Carboidrati %</Label>
                    <Input
                      id="carbs"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={carbsPct}
                      onChange={e => setCarbsPct(e.target.value)}
                      placeholder="45"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : kind === "training" ? null : (
          <div className="grid gap-2">
            <Label>Dose / dettagli</Label>
            <Input value={dose} onChange={e => setDose(e.target.value)} placeholder="Es. 2000 UI/die" />
          </div>
        )}

        <div className="grid gap-2">
          <Label>Note</Label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
        </div>

        <div className="flex justify-between">
          <div>
            {isEdit && allowDelete && (
              <Button variant="destructive" onClick={handleDelete} disabled={remove.isPending}>
                {remove.isPending ? "Eliminazione…" : "Elimina"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {isEdit && onDuplicate && isEnded && (
              <Button variant="outline" onClick={() => onDuplicate(regimen!)}>
                Duplica
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>Annulla</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending
                ? "Salvataggio…"
                : isEdit ? "Salva" : "Crea"}
            </Button>
          </div>
        </div>
      </CardContent>
      </Card>
    </div>
  )
}

export { KIND_LABELS }
