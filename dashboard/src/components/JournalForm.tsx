import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { JournalEditor } from "@/components/JournalEditor"
import { TagInput } from "@/components/TagInput"
import {
  useDeleteJournal,
  useJournalTags,
  useUpsertJournal,
} from "@/lib/queries"
import type { JournalEntry } from "@/lib/types"

interface Props {
  date: string  // ISO YYYY-MM-DD
  entry?: JournalEntry | null
  onClose: () => void
}

const AUTO_SAVE_MS = 1500

export function JournalForm({ date, entry, onClose }: Props) {
  const isEdit = !!entry
  const [html, setHtml] = useState(entry?.content_html ?? "")
  const [tags, setTags] = useState<string[]>(entry?.tags ?? [])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const dirtyRef = useRef(false)
  const lastSavedRef = useRef({ html: entry?.content_html ?? "", tags: entry?.tags ?? [] })

  const upsert = useUpsertJournal()
  const remove = useDeleteJournal()
  const tagSuggestions = useJournalTags()

  useEffect(() => {
    if (entry) {
      setHtml(entry.content_html)
      setTags(entry.tags ?? [])
      lastSavedRef.current = { html: entry.content_html, tags: entry.tags ?? [] }
      dirtyRef.current = false
      setStatus("idle")
    }
  }, [entry])

  const stripHtml = (h: string) => h.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim()

  const saveNow = async (htmlVal: string, tagsVal: string[]) => {
    if (!stripHtml(htmlVal)) return false
    setError(null)
    setStatus("saving")
    try {
      await upsert.mutateAsync({ date, content_html: htmlVal, tags: tagsVal })
      lastSavedRef.current = { html: htmlVal, tags: tagsVal }
      setLastSavedAt(new Date())
      setStatus("saved")
      dirtyRef.current = false
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore")
      setStatus("idle")
      return false
    }
  }

  // Debounced auto-save: ogni 1.5s di idle scrive la voce.
  useEffect(() => {
    const last = lastSavedRef.current
    if (html === last.html && JSON.stringify(tags) === JSON.stringify(last.tags)) {
      return
    }
    dirtyRef.current = true
    const t = setTimeout(() => {
      saveNow(html, tags)
    }, AUTO_SAVE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, tags])

  // Save flush in caso di unmount con modifiche pending
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        // fire-and-forget — la mutation invalida le query a successo
        const cur = { html, tags }
        if (stripHtml(cur.html)) {
          upsert.mutate({ date, content_html: cur.html, tags: cur.tags })
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
    const ok = await saveNow(html, tags)
    if (ok) onClose()
  }

  const handleDelete = async () => {
    if (!entry) return
    if (!confirm("Eliminare la voce di diario di questo giorno?")) return
    try {
      await remove.mutateAsync(entry.id)
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <Card className="w-full max-w-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>
              {isEdit ? "Modifica voce diario" : "Nuova voce diario"}
              <span className="ml-2 text-sm font-normal text-muted-foreground">{date}</span>
            </span>
            {statusLabel && (
              <span className={`text-xs font-normal ${status === "saved" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                {statusLabel}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
              Invio o virgola per aggiungere. I suggerimenti vengono dai tag che hai gia' usato. Auto-save dopo 1.5s.
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
              <Button onClick={submit} disabled={upsert.isPending}>
                Salva e chiudi
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
