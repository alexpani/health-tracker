import { useEffect, useMemo, useState } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { ArrowLeft, Plus, Check, AlertCircle, FlaskConical, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { API_URL } from "@/lib/api"
import { formatDate, cn } from "@/lib/utils"
import {
  useHealthNotes,
  useJournalEntries,
  useLabAddResult,
  useLabAnalytes,
  useLabConfirmPanel,
  useLabCorrelations,
  useLabCreateAlias,
  useLabCreateAnalyte,
  useLabDeleteResult,
  useLabPanel,
  useLabPatchPanel,
  useLabPatchResult,
  useLatestWeightBefore,
} from "@/lib/queries"
import { CorrelationCard, CORR_DISCLAIMER } from "@/components/LabCorrelations"
import { HealthNoteForm } from "@/components/HealthNoteForm"
import { JournalForm } from "@/components/JournalForm"
import type {
  LabAnalyte,
  LabAutoContext,
  LabAutoContextItem,
  LabBodySnapshot,
  LabPanelDetail,
  LabResult,
  LabResultPatch,
} from "@/lib/types"

export default function LabReview() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const panelId = params.id ? Number(params.id) : null

  const { data: panel, isLoading } = useLabPanel(panelId)
  const { data: analytes } = useLabAnalytes()
  const patch = useLabPatchResult()
  const deleteResult = useLabDeleteResult()
  const addResult = useLabAddResult()
  const confirm = useLabConfirmPanel()
  const createAlias = useLabCreateAlias()
  const [showNewAnalyteForm, setShowNewAnalyteForm] = useState(false)
  // ID della riga da cui stiamo creando un analita al volo (form inline).
  const [createFromRowId, setCreateFromRowId] = useState<number | null>(null)
  // Modal per quick-create/edit di Note salute / Diario sul giorno del prelievo.
  const [quickModal, setQuickModal] = useState<
    | { kind: "note"; id: number | null }
    | { kind: "journal"; id: number | null }
    | null
  >(null)

  const analyteById = useMemo(() => {
    const m = new Map<number, LabAnalyte>()
    analytes?.forEach(a => m.set(a.id, a))
    return m
  }, [analytes])

  const analytesAlpha = useMemo(
    () =>
      [...(analytes ?? [])].sort((a, b) =>
        a.display_name_it.localeCompare(b.display_name_it, "it")
      ),
    [analytes]
  )

  if (!panelId) return <p>ID non valido.</p>
  if (isLoading || !panel) return <p>Caricamento…</p>

  const isConfirmed = panel.status === "confirmed"
  const unmatchedCount = panel.results.filter(r => r.analyte_id == null).length

  async function handleConfirm() {
    if (!panelId) return
    if (unmatchedCount > 0) {
      const ok = confirm.isPending
        ? false
        : window.confirm(
            `${unmatchedCount} analit${unmatchedCount === 1 ? "a" : "i"} senza mapping. ` +
              `Quelle righe resteranno "da rivedere" e NON appariranno in Matrice/Andamenti. ` +
              `Il resto verrà confermato e sarà subito visibile. Procedo?`
          )
      if (!ok) return
    }
    try {
      await confirm.mutateAsync(panelId)
      navigate("/lab")
    } catch (e) {
      alert(`Errore: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/lab">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Tutti i referti
          </Link>
        </Button>
        <div className="flex-1">
          <PanelHeader panel={panel} isConfirmed={isConfirmed} />
        </div>
        {panel.document_id != null && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={`${API_URL}/api/v1/lab/documents/${panel.document_id}/file`}
              target="_blank"
              rel="noreferrer"
            >
              Apri PDF
            </a>
          </Button>
        )}
      </div>

      {!isConfirmed && unmatchedCount > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {unmatchedCount} analit{unmatchedCount === 1 ? "a senza mapping" : "i senza mapping"}:
          </div>
          <ul className="mt-1 ml-6 text-xs font-mono">
            {panel.results
              .filter(r => r.analyte_id == null)
              .map(r => (
                <li key={r.id}>{r.raw_name}</li>
              ))}
          </ul>
          <p className="mt-2 text-xs">
            Puoi confermare comunque: le righe mappate finiscono subito in
            Matrice e Andamenti, quelle senza analita restano "da rivedere"
            e potrai completarle tornando qui più tardi.
          </p>
        </div>
      )}

      <BodySnapshotCard snapshot={panel.body_snapshot ?? null} testDate={panel.test_date} />

      <AutoContextSection
        auto={panel.auto_context ?? null}
        testDate={panel.test_date}
        onOpenNote={(id) => setQuickModal({ kind: "note", id })}
        onOpenJournal={(id) => setQuickModal({ kind: "journal", id })}
      />

      <PanelCorrelations panelId={panelId} />

      {quickModal && (
        <QuickEntryModal
          modal={quickModal}
          date={panel.test_date}
          onClose={() => setQuickModal(null)}
        />
      )}

      {isConfirmed && (
        <div className="rounded-md bg-blue-50 border border-blue-200 text-blue-900 px-3 py-2 text-sm dark:bg-blue-950/40 dark:border-blue-900 dark:text-blue-200">
          Referto confermato. Puoi comunque correggere le mappature, i valori e i
          range: le modifiche vengono applicate <strong>subito</strong> e
          aggiornano Matrice e Andamenti (non serve riconfermare).
        </div>
      )}

      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowNewAnalyteForm(v => !v)}
        >
          <FlaskConical className="h-4 w-4 mr-1" />
          {showNewAnalyteForm ? "Chiudi" : "Nuovo analita (generico)"}
        </Button>
        {showNewAnalyteForm && (
          <div className="mt-3">
            <NewAnalyteForm
              defaultSpecimen={panel.specimen_types[0] === "urine" ? "urine" : "blood"}
              defaultDisplayName=""
              defaultAlias={null}
              onCreated={() => setShowNewAnalyteForm(false)}
            />
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risultati ({panel.results.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <datalist id="lab-analytes-list">
            {analytesAlpha.map(a => (
              <option key={a.id} value={a.display_name_it} />
            ))}
          </datalist>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome grezzo</TableHead>
                <TableHead>Analita mappato</TableHead>
                <TableHead>Valore</TableHead>
                <TableHead>Unità</TableHead>
                <TableHead>Range</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead></TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {panel.results.flatMap(r => [
                <ResultRow
                  key={r.id}
                  result={r}
                  analytes={analytesAlpha}
                  analyteById={analyteById}
                  onPatch={async (resultId, patchBody) => {
                    await patch.mutateAsync({ resultId, patch: patchBody })
                  }}
                  onDelete={async resultId => {
                    if (!window.confirm("Eliminare questo risultato?")) return
                    try {
                      await deleteResult.mutateAsync(resultId)
                    } catch (e) {
                      alert(`Errore: ${e instanceof Error ? e.message : String(e)}`)
                    }
                  }}
                  onCreateFromRow={() =>
                    setCreateFromRowId(createFromRowId === r.id ? null : r.id)
                  }
                  creatingFromRow={createFromRowId === r.id}
                  onSaveAlias={async (analyteId, alias) => {
                    try {
                      await createAlias.mutateAsync({
                        analyte_id: analyteId,
                        alias,
                      })
                      // Nessun popup di conferma: il badge "alias noto" appare
                      // in pochi ms grazie all'invalidazione della query.
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e)
                      if (!msg.includes("409")) {
                        alert(`Errore salvataggio alias: ${msg}`)
                      }
                    }
                  }}
                />,
                createFromRowId === r.id ? (
                  <TableRow key={`${r.id}-create`}>
                    <TableCell colSpan={8} className="bg-amber-50/40">
                      <div className="mb-2 text-xs font-medium text-amber-900">
                        Crea un nuovo analita a partire da "{r.raw_name}"
                      </div>
                      <NewAnalyteForm
                        key={r.id}
                        defaultSpecimen={
                          panel.specimen_types[0] === "urine" ? "urine" : "blood"
                        }
                        defaultDisplayName={prettifyRawName(r.raw_name)}
                        defaultAlias={r.raw_name}
                        defaultUnit={r.unit_raw ?? ""}
                        defaultRefLow={
                          r.ref_low_raw != null ? String(r.ref_low_raw) : ""
                        }
                        defaultRefHigh={
                          r.ref_high_raw != null ? String(r.ref_high_raw) : ""
                        }
                        defaultRefText={r.ref_text_raw ?? ""}
                        onCreated={async analyteId => {
                          // Assegna il nuovo analita alla riga di origine —
                          // fallback al backfill backend (che salta se
                          // l'utente ha rimosso il raw_name dagli alias).
                          try {
                            await patch.mutateAsync({
                              resultId: r.id,
                              patch: { analyte_id: analyteId },
                            })
                          } catch {
                            // già invalidato dal create, nessun problema
                          }
                          setCreateFromRowId(null)
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ) : null,
              ])}
            </TableBody>
          </Table>
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await addResult.mutateAsync({ panelId: panel.id })
                } catch (e) {
                  alert(`Errore: ${e instanceof Error ? e.message : String(e)}`)
                }
              }}
              disabled={addResult.isPending}
            >
              <Plus className="h-4 w-4 mr-1" />
              {addResult.isPending ? "Aggiungo…" : "Aggiungi riga"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {!isConfirmed && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur px-6 py-3 flex justify-end gap-3">
          <Button variant="outline" onClick={() => navigate("/lab")}>
            Torna alla lista
          </Button>
          <Button onClick={handleConfirm} disabled={confirm.isPending}>
            <Check className="h-4 w-4 mr-1" />
            {confirm.isPending ? "Conferma in corso…" : "Conferma referto"}
          </Button>
        </div>
      )}
    </div>
  )
}

function ResultRow({
  result,
  analytes,
  analyteById,
  onPatch,
  onDelete,
  onSaveAlias,
  onCreateFromRow,
  creatingFromRow,
}: {
  result: LabResult
  analytes: LabAnalyte[]
  analyteById: Map<number, LabAnalyte>
  onPatch: (resultId: number, patch: LabResultPatch) => Promise<void>
  onDelete: (resultId: number) => Promise<void>
  onSaveAlias: (analyteId: number, alias: string) => Promise<void>
  onCreateFromRow: () => void
  creatingFromRow: boolean
}) {
  const current = result.analyte_id != null ? analyteById.get(result.analyte_id) : undefined
  const [nameInput, setNameInput] = useState(current?.display_name_it ?? "")
  // Edit inline di valore/unità/range — bufferizziamo in stato locale e
  // committiamo al blur. Se il server aggiorna il result (es. re-fetch
  // dopo PATCH), i valori locali restano sincronizzati via useEffect
  // (vedi sotto).
  const [valueInput, setValueInput] = useState(
    result.value_numeric != null
      ? String(result.value_numeric)
      : result.value_text ?? ""
  )
  const [unitInput, setUnitInput] = useState(result.unit_raw ?? "")
  const [refLowInput, setRefLowInput] = useState(
    result.ref_low_raw != null ? String(result.ref_low_raw) : ""
  )
  const [refHighInput, setRefHighInput] = useState(
    result.ref_high_raw != null ? String(result.ref_high_raw) : ""
  )
  const [refTextInput, setRefTextInput] = useState(result.ref_text_raw ?? "")

  // Risincronizza gli input quando i dati server cambiano (es. dopo PATCH
  // o re-ingest). Non tocca nameInput perché l'utente sta tipando lì.
  useEffect(() => {
    setValueInput(
      result.value_numeric != null
        ? String(result.value_numeric)
        : result.value_text ?? ""
    )
    setUnitInput(result.unit_raw ?? "")
    setRefLowInput(result.ref_low_raw != null ? String(result.ref_low_raw) : "")
    setRefHighInput(result.ref_high_raw != null ? String(result.ref_high_raw) : "")
    setRefTextInput(result.ref_text_raw ?? "")
  }, [
    result.value_numeric,
    result.value_text,
    result.unit_raw,
    result.ref_low_raw,
    result.ref_high_raw,
    result.ref_text_raw,
  ])

  function parseNumericInput(s: string): number | null {
    const t = s.trim().replace(",", ".")
    if (t === "") return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  async function commitValue() {
    const s = valueInput.trim()
    const asNum = parseNumericInput(s)
    // Se lo stato corrente del DB è uguale, no-op.
    const dbNum = result.value_numeric
    const dbTxt = result.value_text ?? ""
    if (asNum != null) {
      if (dbNum != null && Number(dbNum) === asNum && !dbTxt) return
      await onPatch(result.id, { value_numeric: asNum, value_text: null })
    } else {
      if (dbTxt === s && dbNum == null) return
      await onPatch(result.id, { value_numeric: null, value_text: s || null })
    }
  }

  async function commitUnit() {
    const s = unitInput.trim()
    if ((result.unit_raw ?? "") === s) return
    await onPatch(result.id, { unit_raw: s || null })
  }

  async function commitRefLow() {
    const n = parseNumericInput(refLowInput)
    if ((result.ref_low_raw ?? null) === n) return
    await onPatch(result.id, { ref_low_raw: n })
  }

  async function commitRefHigh() {
    const n = parseNumericInput(refHighInput)
    if ((result.ref_high_raw ?? null) === n) return
    await onPatch(result.id, { ref_high_raw: n })
  }

  async function commitRefText() {
    const s = refTextInput.trim()
    if ((result.ref_text_raw ?? "") === s) return
    await onPatch(result.id, { ref_text_raw: s || null })
  }

  const [rawNameInput, setRawNameInput] = useState(result.raw_name)
  useEffect(() => setRawNameInput(result.raw_name), [result.raw_name])
  async function commitRawName() {
    const s = rawNameInput.trim()
    if (!s) {
      setRawNameInput(result.raw_name)
      return
    }
    if (s === result.raw_name) return
    await onPatch(result.id, { raw_name: s })
  }


  async function commitAnalyte() {
    const trimmed = nameInput.trim()
    if (!trimmed) {
      await onPatch(result.id, { analyte_id: null })
      return
    }
    const matched = analytes.find(
      a => a.display_name_it.toLowerCase() === trimmed.toLowerCase()
    )
    if (matched) {
      if (matched.id !== result.analyte_id) {
        await onPatch(result.id, { analyte_id: matched.id })
      }
    } else {
      // Nome non esistente: non tocchiamo il DB e non resettiamo — l'utente
      // può usare il pulsante "Nuovo analita" in alto per crearlo.
      // Manteniamo il testo digitato come hint visibile.
    }
  }

  // Priorità: non mappato (rosso) > fuori range (rosso) > ok (verde).
  // Se `needs_review=true` ma l'analita è mappato, non mostriamo nulla di
  // speciale: il flag è normale fra ingest e confirm, non è un warning
  // per l'utente. Dopo il confirm resettiamo needs_review e compaiono i
  // badge definitivi.
  // Colori distinti per i 3 stati:
  //  - senza analita → ambra (caso "mancante", serve review)
  //  - fuori range   → rosso (valore reale fuori dai limiti, alert medico)
  //  - ok            → verde
  let stateBadge: JSX.Element
  if (result.analyte_id == null) {
    stateBadge = (
      <span className="text-xs rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">
        senza analita
      </span>
    )
  } else if (result.out_of_range === true) {
    stateBadge = (
      <span className="text-xs rounded-full bg-red-200 text-red-900 px-2 py-0.5 font-medium">
        fuori range
      </span>
    )
  } else if (result.out_of_range === false) {
    stateBadge = (
      <span className="text-xs rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5">
        ok
      </span>
    )
  } else {
    stateBadge = <span className="text-xs text-muted-foreground">—</span>
  }

  return (
    <TableRow>
      <TableCell>
        <Input
          value={rawNameInput}
          onChange={e => setRawNameInput(e.target.value)}
          onBlur={commitRawName}
          className="h-8 text-xs font-mono w-full min-w-[140px]"
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Input
            list="lab-analytes-list"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onBlur={commitAnalyte}
            placeholder="Cerca analita…"
            className="h-8 text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onMouseDown={e => e.preventDefault()}
            onClick={onCreateFromRow}
            title={`Crea un nuovo analita a partire da "${result.raw_name}"`}
            className={cn(
              "shrink-0",
              result.analyte_id == null
                ? creatingFromRow
                  ? "border-amber-400 bg-amber-200 text-amber-900"
                  : "border-amber-400 text-amber-700 hover:bg-amber-50"
                : creatingFromRow
                ? "bg-muted"
                : "text-muted-foreground",
            )}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {creatingFromRow ? "chiudi" : "crea"}
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <Input
          value={valueInput}
          onChange={e => setValueInput(e.target.value)}
          onBlur={commitValue}
          placeholder="valore"
          className="h-8 text-sm font-mono w-24"
          title="Modifica se l'OCR ha letto male"
        />
      </TableCell>
      <TableCell>
        <Input
          value={unitInput}
          onChange={e => setUnitInput(e.target.value)}
          onBlur={commitUnit}
          placeholder="—"
          className="h-8 text-sm w-20"
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1 text-xs">
          <Input
            value={refLowInput}
            onChange={e => setRefLowInput(e.target.value)}
            onBlur={commitRefLow}
            placeholder="min"
            className="h-8 text-xs w-16 font-mono"
          />
          <span className="text-muted-foreground">–</span>
          <Input
            value={refHighInput}
            onChange={e => setRefHighInput(e.target.value)}
            onBlur={commitRefHigh}
            placeholder="max"
            className="h-8 text-xs w-16 font-mono"
          />
          <Input
            value={refTextInput}
            onChange={e => setRefTextInput(e.target.value)}
            onBlur={commitRefText}
            placeholder="range testuale"
            className="h-8 text-xs w-32"
          />
        </div>
      </TableCell>
      <TableCell>{stateBadge}</TableCell>
      <TableCell>
        {current && result.raw_name && <AliasAction analyte={current} rawName={result.raw_name} onSaveAlias={onSaveAlias} />}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(result.id)}
          title="Elimina questo risultato"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  )
}

function AliasAction({
  analyte,
  rawName,
  onSaveAlias,
}: {
  analyte: LabAnalyte
  rawName: string
  onSaveAlias: (analyteId: number, alias: string) => Promise<void>
}) {
  const aliases = analyte.aliases ?? []
  const normalized = rawName.trim().toLowerCase()
  const alreadyAlias = aliases.some(a => a.toLowerCase() === normalized)

  const aliasTooltip =
    aliases.length > 0
      ? `Alias già noti per ${analyte.display_name_it}:\n${aliases.map(a => `• ${a}`).join("\n")}`
      : `Nessun alias salvato per ${analyte.display_name_it}`

  if (alreadyAlias) {
    return (
      <span
        className="text-xs text-emerald-700 inline-flex items-center gap-1"
        title={aliasTooltip}
      >
        <Check className="h-3.5 w-3.5" />
        alias noto
      </span>
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onSaveAlias(analyte.id, rawName)}
      title={`Salva "${rawName}" come alias di ${analyte.display_name_it}.\n\n${aliasTooltip}`}
    >
      <Plus className="h-3.5 w-3.5 mr-1" />
      alias
    </Button>
  )
}

function PanelHeader({
  panel,
  isConfirmed,
}: {
  panel: LabPanelDetail
  isConfirmed: boolean
}) {
  const patchPanel = useLabPatchPanel()
  const [editing, setEditing] = useState(false)
  const [dateInput, setDateInput] = useState(panel.test_date)
  const [labInput, setLabInput] = useState(panel.lab_name ?? "")

  useEffect(() => {
    setDateInput(panel.test_date)
    setLabInput(panel.lab_name ?? "")
  }, [panel.test_date, panel.lab_name])

  async function save() {
    const patch: { test_date?: string; lab_name?: string | null } = {}
    if (dateInput !== panel.test_date) patch.test_date = dateInput
    const newLab = labInput.trim()
    if (newLab !== (panel.lab_name ?? "")) patch.lab_name = newLab || null
    if (Object.keys(patch).length === 0) {
      setEditing(false)
      return
    }
    try {
      await patchPanel.mutateAsync({ panelId: panel.id, patch })
      setEditing(false)
    } catch (e) {
      alert(`Errore: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (!editing) {
    return (
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          Referto del {formatDate(panel.test_date)}
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-normal text-muted-foreground hover:text-primary hover:underline"
          >
            modifica
          </button>
        </h1>
        <p className="text-sm text-muted-foreground">
          {panel.lab_name ?? "Lab non specificato"} ·{" "}
          {panel.specimen_types.join(", ") || "—"} ·{" "}
          <span className={isConfirmed ? "text-emerald-600" : "text-amber-600"}>
            {isConfirmed ? "Confermato" : "In revisione"}
          </span>
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label className="text-xs">Data prelievo</Label>
        <Input
          type="date"
          value={dateInput}
          onChange={e => setDateInput(e.target.value)}
          className="h-8 text-sm w-40"
        />
      </div>
      <div className="flex-1 min-w-[200px]">
        <Label className="text-xs">Laboratorio</Label>
        <Input
          value={labInput}
          onChange={e => setLabInput(e.target.value)}
          placeholder="es. C.D.R."
          className="h-8 text-sm"
        />
      </div>
      <Button size="sm" onClick={save} disabled={patchPanel.isPending}>
        {patchPanel.isPending ? "Salvo…" : "Salva"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setDateInput(panel.test_date)
          setLabInput(panel.lab_name ?? "")
          setEditing(false)
        }}
      >
        Annulla
      </Button>
    </div>
  )
}

function PanelCorrelations({ panelId }: { panelId: number }) {
  const { data } = useLabCorrelations({ panel_id: panelId })
  const candidates = data?.candidates ?? []
  if (candidates.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Possibili associazioni con regimi / note ({candidates.length})
        </CardTitle>
        <p className="text-xs text-muted-foreground">{CORR_DISCLAIMER}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {candidates.map(c => (
          <CorrelationCard key={c.signature} c={c} showChart={false} />
        ))}
      </CardContent>
    </Card>
  )
}

function formatAutoTooltip(item: LabAutoContextItem, testDate: string): string {
  if (item.source === "journal") {
    return `Voce diario del ${formatDate(item.start_date ?? testDate)}`
  }
  if (item.source === "workout") {
    return `Workout del ${formatDate(item.start_date ?? testDate)}${
      item.detail ? ` · ${item.detail}` : ""
    }`
  }
  if (item.source === "health_note") {
    const s = item.start_date ? formatDate(item.start_date) : "?"
    const e = item.end_date ? formatDate(item.end_date) : "?"
    return s === e ? `Nota del ${s}` : `Nota dal ${s} al ${e}`
  }
  // regimen
  const s = item.start_date ? formatDate(item.start_date) : "data ignota"
  const e = item.end_date ? formatDate(item.end_date) : "in corso"
  return `Periodo: ${s} → ${e}${item.detail ? ` · ${item.detail}` : ""}`
}

const AUTO_ROWS: {
  key: "medications" | "supplements" | "training" | "diet" | "health_notes" | "journal"
  label: string
}[] = [
  { key: "medications", label: "Farmaci" },
  { key: "supplements", label: "Integratori" },
  { key: "training", label: "Piano allenamento" },
  { key: "diet", label: "Piano alimentare" },
  { key: "health_notes", label: "Note salute" },
  { key: "journal", label: "Diario" },
]

function AutoContextChip({
  item,
  testDate,
}: {
  item: LabAutoContextItem
  testDate: string
}) {
  const isWorkout = item.source === "workout"
  return (
    <span
      title={formatAutoTooltip(item, testDate)}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
        "bg-white/70 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800",
        isWorkout && "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800",
      )}
    >
      <span className="font-medium">{item.label}</span>
      {item.detail && !isWorkout && (
        <span className="text-muted-foreground">· {item.detail}</span>
      )}
    </span>
  )
}

function AutoContextSection({
  auto,
  testDate,
  onOpenNote,
  onOpenJournal,
}: {
  auto: LabAutoContext | null
  testDate: string
  onOpenNote: (id: number | null) => void
  onOpenJournal: (id: number | null) => void
}) {
  const rows = AUTO_ROWS.map(r => {
    const raw = auto ? auto[r.key] : null
    const items: LabAutoContextItem[] = Array.isArray(raw)
      ? raw
      : raw
      ? [raw]
      : []
    return { ...r, items }
  })
  const totalCount = rows.reduce((s, r) => s + r.items.length, 0)
  return (
    <div className="rounded-md border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 space-y-2">
      <div className="text-sm font-semibold flex items-center justify-between">
        <span>Contesto automatico ({formatDate(testDate)})</span>
        <span className="text-xs font-normal text-muted-foreground">
          {totalCount} voci · da regimi / note salute / diario / workout
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(r => {
          const isClickable = r.key === "health_notes" || r.key === "journal"
          const onItemClick = (id: number | null) => {
            if (r.key === "health_notes") onOpenNote(id)
            else if (r.key === "journal") onOpenJournal(id)
          }
          return (
            <div key={r.key} className="flex items-start gap-2 text-sm">
              <span className="font-medium text-xs uppercase tracking-wide text-indigo-700 dark:text-indigo-300 min-w-[120px] pt-0.5">
                {r.label}
              </span>
              <div className="flex flex-wrap gap-1 flex-1 items-center">
                {r.items.length === 0 ? (
                  isClickable ? (
                    <button
                      type="button"
                      onClick={() => onItemClick(null)}
                      className="text-xs text-indigo-700 dark:text-indigo-300 hover:underline italic"
                    >
                      + aggiungi per {formatDate(testDate)}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">—</span>
                  )
                ) : (
                  <>
                    {r.items.map((it, idx) =>
                      isClickable ? (
                        <button
                          key={`${r.key}-${idx}`}
                          type="button"
                          onClick={() => onItemClick(it.id ?? null)}
                          title={`${formatAutoTooltip(it, testDate)} · click per modificare`}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs bg-white/70 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors text-left"
                        >
                          <span className="font-medium">{it.label}</span>
                          {it.detail && (
                            <span className="text-muted-foreground">· {it.detail}</span>
                          )}
                        </button>
                      ) : (
                        <AutoContextChip
                          key={`${r.key}-${idx}`}
                          item={it}
                          testDate={testDate}
                        />
                      )
                    )}
                    {isClickable && (
                      <button
                        type="button"
                        onClick={() => onItemClick(null)}
                        title={`Nuova per ${formatDate(testDate)}`}
                        className="inline-flex items-center justify-center h-5 w-5 rounded-full border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-xs font-bold"
                      >
                        +
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function QuickEntryModal({
  modal,
  date,
  onClose,
}: {
  modal:
    | { kind: "note"; id: number | null }
    | { kind: "journal"; id: number | null }
  date: string
  onClose: () => void
}) {
  // Fetch entity per modalita' edit
  const notes = useHealthNotes(
    modal.kind === "note" && modal.id != null
      ? { active_on: date }
      : {},
  )
  const journal = useJournalEntries(date, modal.kind === "journal")
  const noteToEdit =
    modal.kind === "note" && modal.id != null
      ? notes.data?.find(n => n.id === modal.id) ?? null
      : null
  const journalToEdit =
    modal.kind === "journal" && modal.id != null
      ? journal.data?.find(e => e.id === modal.id) ?? null
      : null

  const stillLoading =
    (modal.kind === "note" && modal.id != null && !notes.data) ||
    (modal.kind === "journal" && modal.id != null && !journal.data)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-12"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl"
        onClick={e => e.stopPropagation()}
      >
        {stillLoading ? (
          <div className="rounded-md border bg-background p-6 text-sm text-muted-foreground">
            Caricamento…
          </div>
        ) : modal.kind === "note" ? (
          <HealthNoteForm
            note={noteToEdit}
            defaults={{ start_date: date, end_date: date }}
            onClose={onClose}
          />
        ) : (
          <JournalForm
            date={date}
            entry={journalToEdit}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  )
}

function BodySnapshotCard({
  snapshot,
  testDate,
}: {
  snapshot: LabBodySnapshot | null
  testDate: string
}) {
  const items: { label: string; value: string; when: string | null }[] = []
  if (snapshot?.weight) {
    items.push({
      label: "Peso",
      value: `${snapshot.weight.value.toFixed(1)} ${snapshot.weight.unit}`,
      when: snapshot.weight.start_date.slice(0, 10),
    })
  }
  if (snapshot?.body_fat) {
    items.push({
      label: "Massa grassa",
      value: `${(snapshot.body_fat.value * 100).toFixed(1)} %`,
      when: snapshot.body_fat.start_date.slice(0, 10),
    })
  }
  if (snapshot?.bmi) {
    items.push({
      label: "BMI",
      value: snapshot.bmi.value.toFixed(1),
      when: snapshot.bmi.start_date.slice(0, 10),
    })
  }

  if (items.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Corpo al prelievo ({formatDate(testDate)}): nessun dato HK nei 30 giorni
        precedenti.
      </div>
    )
  }
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {items.map(it => (
          <div key={it.label} className="flex items-baseline gap-1">
            <span className="font-medium">{it.label}:</span>
            <span className="font-mono">{it.value}</span>
            {it.when && (
              <span className="text-xs text-muted-foreground">
                (il {formatDate(it.when)})
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        Ultimi valori Apple Health ≤ data del prelievo ({formatDate(testDate)}). Non
        modificabili.
      </div>
    </div>
  )
}

function prettifyRawName(raw: string): string {
  // Converte "GLICEMIA a digiuno" → "Glicemia a digiuno"
  // e "VIT.D (25OH VITD)" → "Vit.D (25OH VITD)" (mantiene maiuscole dentro parentesi)
  const trimmed = raw.trim()
  if (!trimmed) return ""
  // Se tutto maiuscolo, mettiamo tutto minuscolo e capitalizziamo prima lettera
  if (trimmed === trimmed.toUpperCase()) {
    const lowered = trimmed.toLowerCase()
    return lowered.charAt(0).toUpperCase() + lowered.slice(1)
  }
  return trimmed
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100)
}

function NewAnalyteForm({
  defaultSpecimen,
  defaultDisplayName,
  defaultAlias,
  defaultUnit = "",
  defaultRefLow = "",
  defaultRefHigh = "",
  defaultRefText = "",
  onCreated,
}: {
  defaultSpecimen: "blood" | "urine"
  defaultDisplayName: string
  defaultAlias: string | null
  defaultUnit?: string
  defaultRefLow?: string
  defaultRefHigh?: string
  defaultRefText?: string
  onCreated: (analyteId: number, slug: string) => void
}) {
  const create = useLabCreateAnalyte()
  const { data: allAnalytes } = useLabAnalytes()
  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    allAnalytes?.forEach(a => set.add(a.category))
    return Array.from(set).sort()
  }, [allAnalytes])
  const [displayName, setDisplayName] = useState(defaultDisplayName)
  const [slug, setSlug] = useState(defaultDisplayName ? slugify(defaultDisplayName) : "")
  const [slugTouched, setSlugTouched] = useState(false)
  const [category, setCategory] = useState("")
  const [specimen, setSpecimen] = useState<"blood" | "urine" | "other">(defaultSpecimen)
  const [valueType, setValueType] =
    useState<"numeric" | "semi_quantitative" | "qualitative" | "textual">("numeric")
  const [unitCanonical, setUnitCanonical] = useState(defaultUnit)
  const [refLow, setRefLow] = useState(defaultRefLow)
  const [refHigh, setRefHigh] = useState(defaultRefHigh)
  const [refText, setRefText] = useState(defaultRefText)
  const [aliases, setAliases] = useState(defaultAlias ?? "")

  function onNameChange(v: string) {
    setDisplayName(v)
    if (!slugTouched) setSlug(slugify(v))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim() || !slug.trim() || !category.trim()) {
      alert("Nome, slug e categoria sono obbligatori")
      return
    }
    try {
      const body = {
        slug: slug.trim(),
        display_name_it: displayName.trim(),
        category: category.trim(),
        specimen,
        value_type: valueType,
        unit_canonical: unitCanonical.trim() || null,
        ref_low: refLow.trim() ? Number(refLow.replace(",", ".")) : null,
        ref_high: refHigh.trim() ? Number(refHigh.replace(",", ".")) : null,
        ref_text: refText.trim() || null,
        aliases: aliases
          .split(",")
          .map(a => a.trim())
          .filter(Boolean),
      }
      const res = await create.mutateAsync(body)
      onCreated(res.id, res.slug)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      alert(`Errore creazione analita: ${msg}`)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border bg-muted/30 p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm"
    >
      <div>
        <Label className="text-xs">Nome (italiano) *</Label>
        <Input
          value={displayName}
          onChange={e => onNameChange(e.target.value)}
          placeholder="es. Emoglobina glicata"
          className="h-8"
        />
      </div>
      <div>
        <Label className="text-xs">Slug *</Label>
        <Input
          value={slug}
          onChange={e => {
            setSlug(e.target.value)
            setSlugTouched(true)
          }}
          placeholder="es. hba1c"
          className="h-8 font-mono"
        />
      </div>
      <div>
        <Label className="text-xs">Categoria *</Label>
        <Input
          value={category}
          onChange={e => setCategory(e.target.value)}
          list="lab-categories-list"
          placeholder="es. metabolismo, ormoni, fegato…"
          className="h-8"
        />
        <datalist id="lab-categories-list">
          {categoryOptions.map(c => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
      <div>
        <Label className="text-xs">Campione</Label>
        <Select value={specimen} onValueChange={v => setSpecimen(v as typeof specimen)}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="blood">blood</SelectItem>
            <SelectItem value="urine">urine</SelectItem>
            <SelectItem value="other">other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Tipo valore</Label>
        <Select value={valueType} onValueChange={v => setValueType(v as typeof valueType)}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="numeric">numeric</SelectItem>
            <SelectItem value="semi_quantitative">semi_quantitative</SelectItem>
            <SelectItem value="qualitative">qualitative</SelectItem>
            <SelectItem value="textual">textual</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Unità canonica</Label>
        <Input
          value={unitCanonical}
          onChange={e => setUnitCanonical(e.target.value)}
          placeholder="es. mg/dl"
          className="h-8"
        />
      </div>
      <div>
        <Label className="text-xs">Range min</Label>
        <Input value={refLow} onChange={e => setRefLow(e.target.value)} className="h-8" />
      </div>
      <div>
        <Label className="text-xs">Range max</Label>
        <Input value={refHigh} onChange={e => setRefHigh(e.target.value)} className="h-8" />
      </div>
      <div>
        <Label className="text-xs">Range testuale</Label>
        <Input
          value={refText}
          onChange={e => setRefText(e.target.value)}
          placeholder="es. assente, negativo"
          className="h-8"
        />
      </div>
      <div className="md:col-span-3">
        <Label className="text-xs">Alias iniziali (separati da virgola)</Label>
        <Input
          value={aliases}
          onChange={e => setAliases(e.target.value)}
          placeholder="es. HbA1c, Emoglobina glicata, A1c"
          className="h-8"
        />
      </div>
      <div className="md:col-span-3 flex justify-end gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? "Salvataggio…" : "Crea analita"}
        </Button>
      </div>
    </form>
  )
}
