import { useRef, useState } from "react"
import { Upload, Loader2 } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useLabIngest } from "@/lib/queries"

export default function LabUploadDropzone() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const ingest = useLabIngest()

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const f = files[0]
    if (!f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf") {
      alert("Solo PDF supportati")
      return
    }
    try {
      const res = await ingest.mutateAsync(f)
      if (res.parsing_failed) {
        alert(
          `Parsing fallito sul PDF. Panel creato vuoto (#${res.panel_id}), rivedi manualmente.`
        )
      }
      navigate(`/lab/panels/${res.panel_id}/review`)
    } catch (e) {
      alert(`Errore upload: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div
      className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
        dragActive
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
      }`}
      onDragEnter={e => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={e => {
        e.preventDefault()
        setDragActive(false)
      }}
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
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span>Estraggo testo e analizzo con Claude…</span>
        </div>
      ) : (
        <>
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-2">
            Trascina qui un referto PDF oppure
          </p>
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
            Scegli file
          </Button>
        </>
      )}
    </div>
  )
}
