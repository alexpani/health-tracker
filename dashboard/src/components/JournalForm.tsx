import { useEffect, useState } from "react"
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

export function JournalForm({ date, entry, onClose }: Props) {
  const isEdit = !!entry
  const [html, setHtml] = useState(entry?.content_html ?? "")
  const [tags, setTags] = useState<string[]>(entry?.tags ?? [])
  const [error, setError] = useState<string | null>(null)

  const upsert = useUpsertJournal()
  const remove = useDeleteJournal()
  const tagSuggestions = useJournalTags()

  useEffect(() => {
    if (entry) {
      setHtml(entry.content_html)
      setTags(entry.tags ?? [])
    }
  }, [entry])

  const stripHtml = (h: string) => h.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim()

  const submit = async () => {
    setError(null)
    if (!stripHtml(html)) {
      setError("Il contenuto non puo' essere vuoto")
      return
    }
    try {
      await upsert.mutateAsync({ date, content_html: html, tags })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Errore")
    }
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <Card className="w-full max-w-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle>
            {isEdit ? "Modifica voce diario" : "Nuova voce diario"}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{date}</span>
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
              Invio o virgola per aggiungere. I suggerimenti vengono dai tag che hai gia' usato.
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
              <Button variant="outline" onClick={onClose}>Annulla</Button>
              <Button onClick={submit} disabled={upsert.isPending}>
                {isEdit ? "Salva" : "Crea"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
