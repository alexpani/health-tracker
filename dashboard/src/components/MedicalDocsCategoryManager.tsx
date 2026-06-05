import { useState } from "react"
import { Pencil, Plus, Trash2, X, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useMedicalDocCategories, useMedicalDocCategoryMutations } from "@/lib/queries"
import type { MedicalDocSection } from "@/lib/types"

interface Props {
  section: MedicalDocSection
  onClose: () => void
}

/** Modal CRUD per le categorie di una sezione. */
export default function MedicalDocsCategoryManager({ section, onClose }: Props) {
  const { data: categories } = useMedicalDocCategories(section)
  const { create, rename, remove } = useMedicalDocCategoryMutations(section)
  const [newName, setNewName] = useState("")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState("")

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    try {
      await create.mutateAsync(name)
      setNewName("")
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleRename(id: number) {
    const name = editName.trim()
    if (!name) return
    try {
      await rename.mutateAsync({ id, name })
      setEditingId(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDelete(id: number, label: string, count: number) {
    const msg = count > 0
      ? `Eliminare la categoria "${label}"? ${count} documenti resteranno senza categoria.`
      : `Eliminare la categoria "${label}"?`
    if (!confirm(msg)) return
    await remove.mutateAsync(id)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div
        className="w-full max-w-md rounded-lg bg-background shadow-lg"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Gestisci categorie</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-1">
          {(categories ?? []).map(c => (
            <div key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
              {editingId === c.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleRename(c.id)}
                    autoFocus
                    className="h-7"
                  />
                  <button onClick={() => handleRename(c.id)} className="text-emerald-600">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-muted-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.doc_count}</span>
                  <button
                    onClick={() => { setEditingId(c.id); setEditName(c.name) }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(c.id, c.name, c.doc_count)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
          {(categories ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Nessuna categoria.</p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t px-4 py-3">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
            placeholder="Nuova categoria…"
            className="h-8"
          />
          <Button size="sm" onClick={handleCreate} disabled={!newName.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
