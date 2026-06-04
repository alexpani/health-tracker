import { useEffect, useState } from "react"
import { CheckCircle2, ExternalLink, Loader2, Maximize2, Minimize2, Save, Trash2 } from "lucide-react"
import { API_URL } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useMedicalDocCategories,
  useMedicalDocDelete,
  useMedicalDocPatch,
} from "@/lib/queries"
import type { MedicalDoc, MedicalDocSection } from "@/lib/types"

interface Props {
  section: MedicalDocSection
  doc: MedicalDoc | null
}

const NO_CATEGORY = "__none__"
const HEIGHTS: Record<string, number> = { S: 320, M: 520, L: 800 }

export default function MedicalDocPreview({ section, doc }: Props) {
  const { data: categories } = useMedicalDocCategories(section)
  const patch = useMedicalDocPatch(section)
  const del = useMedicalDocDelete(section)

  const [form, setForm] = useState({
    title: "",
    doc_date: "",
    category_id: NO_CATEGORY,
    facility_name: "",
    doctor_name: "",
    notes: "",
  })
  const [height, setHeight] = useState<keyof typeof HEIGHTS>("M")
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!doc) return
    setForm({
      title: doc.title ?? "",
      doc_date: doc.doc_date ?? "",
      category_id: doc.category_id == null ? NO_CATEGORY : String(doc.category_id),
      facility_name: doc.facility_name ?? "",
      doctor_name: doc.doctor_name ?? "",
      notes: doc.notes ?? "",
    })
  }, [doc])

  if (!doc) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border text-sm text-muted-foreground">
        Seleziona un documento per vederne l'anteprima.
      </div>
    )
  }

  async function save(extra?: { status?: "confirmed" }) {
    if (!doc) return
    try {
      await patch.mutateAsync({
        id: doc.id,
        patch: {
          title: form.title.trim() || null,
          doc_date: form.doc_date || null,
          category_id: form.category_id === NO_CATEGORY ? null : Number(form.category_id),
          facility_name: form.facility_name.trim() || null,
          doctor_name: form.doctor_name.trim() || null,
          notes: form.notes.trim() || null,
          ...extra,
        },
      })
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDelete() {
    if (!doc) return
    if (!confirm("Eliminare questo documento e il relativo PDF?")) return
    await del.mutateAsync(doc.id)
  }

  // `#navpanes=0&pagemode=none` nasconde la barra laterale con le miniature
  // delle pagine nel viewer PDF nativo del browser.
  const fileSrc = doc.file_id != null
    ? `${API_URL}/api/v1/medical-docs/files/${doc.file_id}#navpanes=0&pagemode=none`
    : null

  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Metadati</span>
          <div className="flex items-center gap-2">
            {doc.analysis_status === "pending" && (
              <span className="flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                <Loader2 className="h-3 w-3 animate-spin" /> analisi IA in corso…
              </span>
            )}
            {doc.analysis_status === "failed" && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                analisi IA fallita
              </span>
            )}
            <span
              className={
                doc.status === "confirmed"
                  ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800"
                  : "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
              }
            >
              {doc.status === "confirmed" ? "confermato" : "bozza"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Titolo" className="col-span-2">
            <Input
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Data">
            <Input
              type="date"
              value={form.doc_date}
              onChange={e => setForm({ ...form, doc_date: e.target.value })}
            />
          </Field>
          <Field label="Categoria">
            <Select
              value={form.category_id}
              onValueChange={v => setForm({ ...form, category_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>— Nessuna —</SelectItem>
                {(categories ?? []).map(c => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Struttura">
            <Input
              value={form.facility_name}
              onChange={e => setForm({ ...form, facility_name: e.target.value })}
            />
          </Field>
          <Field label="Medico">
            <Input
              value={form.doctor_name}
              onChange={e => setForm({ ...form, doctor_name: e.target.value })}
            />
          </Field>
          <Field label="Note" className="col-span-2">
            <Textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => save()} disabled={patch.isPending}>
            <Save className="mr-1 h-4 w-4" /> Salva
          </Button>
          {doc.status !== "confirmed" && (
            <Button size="sm" onClick={() => save({ status: "confirmed" })} disabled={patch.isPending}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> Conferma
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive"
            onClick={handleDelete}
            disabled={del.isPending}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Elimina
          </Button>
        </div>
      </div>

      <div className={fullscreen ? "fixed inset-0 z-50 bg-background p-4" : "rounded-lg border"}>
        <div className="flex items-center gap-1 border-b p-1.5">
          {!fullscreen && (Object.keys(HEIGHTS) as Array<keyof typeof HEIGHTS>).map(k => (
            <button
              key={k}
              onClick={() => setHeight(k)}
              className={
                "rounded px-2 py-0.5 text-xs " +
                (height === k ? "bg-primary text-primary-foreground" : "hover:bg-accent")
              }
            >
              {k}
            </button>
          ))}
          {fileSrc && (
            <a
              href={fileSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-xs hover:bg-accent"
              title="Apri il PDF in una nuova scheda"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Apri PDF
            </a>
          )}
          <button
            onClick={() => setFullscreen(f => !f)}
            className={(fileSrc ? "" : "ml-auto ") + "rounded p-1 hover:bg-accent"}
            title={fullscreen ? "Riduci" : "Schermo intero"}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
        {fileSrc ? (
          <iframe
            src={fileSrc}
            title="Anteprima documento"
            className="w-full"
            style={{ height: fullscreen ? "calc(100vh - 80px)" : HEIGHTS[height] }}
          />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            PDF non disponibile.
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  )
}
