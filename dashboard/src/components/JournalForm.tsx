import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { JournalEditor } from "@/components/JournalEditor"
import { TagInput } from "@/components/TagInput"
import {
  useCreateJournal,
  useDeleteJournal,
  useJournalTags,
  useUpdateJournal,
} from "@/lib/queries"
import type { JournalEntry } from "@/lib/types"
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock"

interface Props {
  /** Data iniziale (per nuova nota). In edit, viene da `entry.date`. */
  date: string
  /** Quando passato → modalita' edit. Quando null/undef → nuova nota. */
  entry?: JournalEntry | null
  onClose: () => void
}

const AUTO_SAVE_MS = 1500

export function JournalForm({ date: initialDate, entry, onClose }: Props) {
  useBodyScrollLock()
  const [entryId, setEntryId] = useState<number | null>(entry?.id ?? null)
  const [html, setHtml] = useState(entry?.content_html ?? "")
  const [tags, setTags] = useState<string[]>(entry?.tags ?? [])
  const [date, setDate] = useState<string>(entry?.date ?? initialDate)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const lastSavedRef = useRef({
    html: entry?.content_html ?? "",
    tags: entry?.tags ?? [],
    date: entry?.date ?? initialDate,
  })

  const create = useCreateJournal()
  const update = useUpdateJournal()
  const remove = useDeleteJournal()
  const tagSuggestions = useJournalTags()

  useEffect(() => {
    if (entry) {
      setEntryId(entry.id)
      setHtml(entry.content_html)
      setTags(entry.tags ?? [])
      setDate(entry.date)
      lastSavedRef.current = {
        html: entry.content_html,
        tags: entry.tags ?? [],
        date: entry.date,
      }
      dirtyRef.current = false
      setStatus("idle")
    }
  }, [entry])

  const stripHtml = (h: string) => h.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim()

  const saveNow = async (
    htmlVal: string,
    tagsVal: string[],
    dateVal: string,
  ): Promise<{ ok: boolean; id?: number }> => {
    if (!stripHtml(htmlVal)) return { ok: false }
    if (savingRef.current) return { ok: false }
    savingRef.current = true
    setError(null)
    setStatus("saving")
    try {
      let saved: JournalEntry
      if (entryId == null) {
        // Crea nuova entry (prima volta che l'utente scrive)
        saved = await create.mutateAsync({
          date: dateVal,
          content_html: htmlVal,
          tags: tagsVal,
        })
        setEntryId(saved.id)
      } else {
        // Patch parziale: invio solo i campi cambiati rispetto all'ultimo
        // salvataggio per non sprecare lavoro server-side (la
        // sanitizzazione bleach.clean e' la parte costosa).
        const patch: { content_html?: string; tags?: string[]; date?: string } = {}
        if (htmlVal !== lastSavedRef.current.html) patch.content_html = htmlVal
        if (JSON.stringify(tagsVal) !== JSON.stringify(lastSavedRef.current.tags)) patch.tags = tagsVal
        if (dateVal !== lastSavedRef.current.date) patch.date = dateVal
        if (Object.keys(patch).length === 0) {
          savingRef.current = false
          return { ok: true, id: entryId }
        }
        saved = await update.mutateAsync({ id: entryId, patch })
      }
      lastSavedRef.current = { html: htmlVal, tags: tagsVal, date: dateVal }
      setLastSavedAt(new Date())
      setStatus("saved")
      dirtyRef.current = false
      savingRef.current = false
      return { ok: true, id: saved.id }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore")
      setStatus("idle")
      savingRef.current = false
      return { ok: false }
    }
  }

  // Debounced auto-save
  useEffect(() => {
    const last = lastSavedRef.current
    if (
      html === last.html &&
      JSON.stringify(tags) === JSON.stringify(last.tags) &&
      date === last.date
    ) {
      return
    }
    dirtyRef.current = true
    const t = setTimeout(() => {
      saveNow(html, tags, date)
    }, AUTO_SAVE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, tags, date])

  // Flush su unmount se ci sono modifiche pending
  useEffect(() => {
    return () => {
      if (dirtyRef.current && stripHtml(html)) {
        // fire-and-forget; mutation invalida le query a successo
        if (entryId == null) {
          create.mutate({ date, content_html: html, tags })
        } else {
          const patch: { content_html?: string; tags?: string[]; date?: string } = {}
          if (html !== lastSavedRef.current.html) patch.content_html = html
          if (JSON.stringify(tags) !== JSON.stringify(lastSavedRef.current.tags)) patch.tags = tags
          if (date !== lastSavedRef.current.date) patch.date = date
          if (Object.keys(patch).length > 0) update.mutate({ id: entryId, patch })
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async () => {
    setError(null)
    if (!stripHtml(html)) {
      setError("Il contenuto non puo' essere vuoto")
      return
    }
    const res = await saveNow(html, tags, date)
    if (res.ok) onClose()
  }

  const handleDelete = async () => {
    if (entryId == null) {
      onClose()
      return
    }
    if (!confirm("Eliminare questa voce di diario?")) return
    try {
      await remove.mutateAsync(entryId)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore")
    }
  }

  const fmtTime = (d: Date) =>
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`

  const statusLabel = (() => {
    if (status === "saving") return "Salvataggio…"
    if (status === "saved" && lastSavedAt) return `Salvato ${fmtTime(lastSavedAt)}`
    return null
  })()

  const isEdit = entryId != null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/40 p-4 sm:p-8"
    >
      <Card className="w-full max-w-2xl shadow-2xl">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>
              {isEdit ? "Modifica nota" : "Nuova nota"}
            </span>
            {statusLabel && (
              <span className={`text-xs font-normal ${status === "saved" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                {statusLabel}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 max-w-[200px]">
            <Label htmlFor="journal-date">Data</Label>
            <Input
              id="journal-date"
              type="date"
              value={date}
              onChange={e => e.target.value && setDate(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label>Contenuto</Label>
            <JournalEditor value={html} onChange={setHtml} />
          </div>

          <div className="grid gap-2">
            <Label>Tag</Label>
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={tagSuggestions.data ?? []}
              placeholder="Es. lavoro, viaggio, famiglia"
            />
            <p className="text-xs text-muted-foreground">
              Auto-save dopo 1.5s di idle. Puoi cambiare la data per spostare la nota.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-between">
            <div>
              {isEdit && (
                <Button variant="destructive" onClick={handleDelete} disabled={remove.isPending}>
                  Elimina
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Chiudi
              </Button>
              <Button onClick={submit} disabled={create.isPending || update.isPending}>
                Salva e chiudi
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
