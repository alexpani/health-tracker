import { useRef, useState } from "react"
import { AlertTriangle, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn, formatDate } from "@/lib/utils"
import { useMedicalDocCategories, useMedicalDocIngest } from "@/lib/queries"
import type { MedicalDoc, MedicalDocSection } from "@/lib/types"

interface Props {
  section: MedicalDocSection
  items: MedicalDoc[]
  isLoading: boolean
  error: unknown
  total: number
  selectedId: number | null
  onSelect: (id: number) => void
}

export default function MedicalDocsList({
  section,
  items,
  isLoading,
  error,
  total,
  selectedId,
  onSelect,
}: Props) {
  const { data: categories } = useMedicalDocCategories(section)
  const catName = (id: number | null) =>
    id == null ? null : categories?.find(c => c.id === id)?.name ?? null

  const ingest = useMedicalDocIngest(section)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const f = files[0]
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") {
      alert("Solo PDF supportati")
      return
    }
    try {
      const res = await ingest.mutateAsync(f)
      onSelect(res.id)
    } catch (e) {
      alert(`Errore upload: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "rounded-lg border-2 border-dashed p-4 text-center transition-colors",
          dragActive
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        )}
        onDragEnter={e => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={e => { e.preventDefault(); setDragActive(false) }}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          setDragActive(false)
          void handleFiles(e.dataTransfer.files)
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={e => void handleFiles(e.target.files)}
        />
        {ingest.isPending ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analizzo il PDF con l'IA…
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Trascina un PDF oppure</span>
            <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
              Scegli file
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border">
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          {total} {total === 1 ? "documento" : "documenti"}
        </div>
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Caricamento…</p>
        ) : error ? (
          <p className="p-4 text-sm text-destructive">Errore: {String(error)}</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nessun documento.</p>
        ) : (
          <ul className="max-h-[70vh] overflow-y-auto divide-y">
            {items.map(d => (
              <li key={d.id}>
                <button
                  onClick={() => onSelect(d.id)}
                  className={cn(
                    "w-full px-3 py-2 text-left transition-colors",
                    selectedId === d.id ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm font-medium">
                      {d.title || (d.analysis_status === "pending"
                        ? "Analisi IA in corso…"
                        : "(senza titolo)")}
                    </span>
                    {d.analysis_status === "pending" && (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    )}
                    {d.analysis_status === "failed" && (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    )}
                    <StatusBadge status={d.status} />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{d.doc_date ? formatDate(d.doc_date) : "data ?"}</span>
                    {catName(d.category_id) && (
                      <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                        {catName(d.category_id)}
                      </span>
                    )}
                    {d.facility_name && <span className="truncate">· {d.facility_name}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return status === "confirmed" ? (
    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
      confermato
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
      bozza
    </span>
  )
}
