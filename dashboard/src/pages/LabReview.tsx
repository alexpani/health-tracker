import { useMemo, useState } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { ArrowLeft, Plus, Check, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { API_URL } from "@/lib/api"
import { formatDate } from "@/lib/utils"
import {
  useLabAnalytes,
  useLabConfirmPanel,
  useLabCreateAlias,
  useLabPanel,
  useLabPatchResult,
  useLatestWeightBefore,
} from "@/lib/queries"
import type { LabAnalyte, LabResult } from "@/lib/types"

export default function LabReview() {
  const params = useParams<{ id: string }>()
  const navigate = useNavigate()
  const panelId = params.id ? Number(params.id) : null

  const { data: panel, isLoading } = useLabPanel(panelId)
  const { data: analytes } = useLabAnalytes()
  const patch = useLabPatchResult()
  const confirm = useLabConfirmPanel()
  const createAlias = useLabCreateAlias()

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

  const allMapped = useMemo(() => {
    if (!panel) return false
    return panel.results.every(r => r.analyte_id != null)
  }, [panel])

  if (!panelId) return <p>ID non valido.</p>
  if (isLoading || !panel) return <p>Caricamento…</p>

  const isConfirmed = panel.status === "confirmed"
  const unmatchedCount = panel.results.filter(r => r.analyte_id == null).length

  async function handleConfirm() {
    if (!panelId) return
    try {
      const res = await confirm.mutateAsync(panelId)
      alert(
        `Confermato. ${res.out_of_range_count} valori fuori range.` +
          (res.still_needs_review > 0
            ? ` ${res.still_needs_review} ancora da rivedere (unità incompatibile).`
            : "")
      )
      navigate(`/lab/panels/${panelId}/review`)
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
          <h1 className="text-xl font-semibold">
            Referto del {formatDate(panel.test_date)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {panel.lab_name ?? "Lab non specificato"} ·{" "}
            {panel.specimen_types.join(", ") || "—"} ·{" "}
            <span
              className={
                isConfirmed ? "text-emerald-600" : "text-amber-600"
              }
            >
              {isConfirmed ? "Confermato" : "In revisione"}
            </span>
          </p>
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
            {unmatchedCount} analit{unmatchedCount === 1 ? "a" : "i"} senza mapping:
          </div>
          <ul className="mt-1 ml-6 text-xs font-mono">
            {panel.results
              .filter(r => r.analyte_id == null)
              .map(r => (
                <li key={r.id}>{r.raw_name}</li>
              ))}
          </ul>
        </div>
      )}

      <WeightAtSamplingCard testDate={panel.test_date} />

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {panel.results.map(r => (
                <ResultRow
                  key={r.id}
                  result={r}
                  analytes={analytesAlpha}
                  analyteById={analyteById}
                  readOnly={isConfirmed}
                  onPatch={async (resultId, patchBody) => {
                    await patch.mutateAsync({ resultId, patch: patchBody })
                  }}
                  onSaveAlias={async (analyteId, alias) => {
                    try {
                      await createAlias.mutateAsync({
                        analyte_id: analyteId,
                        alias,
                      })
                      alert(`Alias "${alias}" salvato.`)
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e)
                      if (msg.includes("409")) {
                        alert("Alias già esistente.")
                      } else {
                        alert(`Errore: ${msg}`)
                      }
                    }
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!isConfirmed && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background/95 backdrop-blur px-6 py-3 flex justify-end gap-3">
          <Button variant="outline" onClick={() => navigate("/lab")}>
            Torna alla lista
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!allMapped || confirm.isPending}
          >
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
  readOnly,
  onPatch,
  onSaveAlias,
}: {
  result: LabResult
  analytes: LabAnalyte[]
  analyteById: Map<number, LabAnalyte>
  readOnly: boolean
  onPatch: (resultId: number, patch: { analyte_id?: number | null }) => Promise<void>
  onSaveAlias: (analyteId: number, alias: string) => Promise<void>
}) {
  const current = result.analyte_id != null ? analyteById.get(result.analyte_id) : undefined
  const [nameInput, setNameInput] = useState(current?.display_name_it ?? "")

  const valueDisplay =
    result.value_numeric != null ? String(result.value_numeric) : result.value_text ?? "—"
  const rangeDisplay =
    result.ref_low_raw != null || result.ref_high_raw != null
      ? `${result.ref_low_raw ?? "-"} – ${result.ref_high_raw ?? "-"}`
      : result.ref_text_raw ?? ""

  async function commitAnalyte() {
    if (readOnly) return
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
      alert(
        `"${trimmed}" non è nel catalogo. Scegli un'opzione esistente (il catalogo si estende via POST /analytes in un'altra UI).`
      )
      setNameInput(current?.display_name_it ?? "")
    }
  }

  // Priorità: non mappato (rosso) > fuori range (rosso) > ok (verde).
  // Se `needs_review=true` ma l'analita è mappato, non mostriamo nulla di
  // speciale: il flag è normale fra ingest e confirm, non è un warning
  // per l'utente. Dopo il confirm resettiamo needs_review e compaiono i
  // badge definitivi.
  let stateBadge: JSX.Element
  if (result.analyte_id == null) {
    stateBadge = (
      <span className="text-xs rounded-full bg-red-100 text-red-800 px-2 py-0.5">
        senza analita
      </span>
    )
  } else if (result.out_of_range === true) {
    stateBadge = (
      <span className="text-xs rounded-full bg-red-100 text-red-800 px-2 py-0.5">
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
      <TableCell className="font-mono text-xs">{result.raw_name}</TableCell>
      <TableCell>
        {readOnly ? (
          <span>{current?.display_name_it ?? "—"}</span>
        ) : (
          <Input
            list="lab-analytes-list"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onBlur={commitAnalyte}
            placeholder="Cerca analita…"
            className="h-8 text-sm"
          />
        )}
      </TableCell>
      <TableCell className="font-mono">{valueDisplay}</TableCell>
      <TableCell>{result.unit_raw ?? "—"}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{rangeDisplay}</TableCell>
      <TableCell>{stateBadge}</TableCell>
      <TableCell>
        {!readOnly && current && result.raw_name && <AliasAction analyte={current} rawName={result.raw_name} onSaveAlias={onSaveAlias} />}
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

function WeightAtSamplingCard({ testDate }: { testDate: string }) {
  const { data, isLoading } = useLatestWeightBefore(testDate, 3)
  if (isLoading) return null
  if (!data?.data) {
    return (
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Peso al prelievo: nessun valore HK entro 3 giorni prima del {formatDate(testDate)}.
      </div>
    )
  }
  const sampleDate = data.data.start_date.slice(0, 10)
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm flex items-center justify-between">
      <span>
        <span className="font-medium">Peso al prelievo:</span>{" "}
        <span className="font-mono">
          {data.data.value.toFixed(1)} {data.data.unit}
        </span>
      </span>
      <span className="text-xs text-muted-foreground">
        rilevato il {formatDate(sampleDate)} (Apple Health)
      </span>
    </div>
  )
}
