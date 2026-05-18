import { useState } from "react"
import { Plus, RefreshCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useBlacklist,
  useCreateRule,
  useDeleteRule,
  useRemoveBlacklist,
  useResetRuleStats,
  useRules,
  useRulesSummary,
  useUpdateRule,
} from "@/lib/queries"
import { getMeta } from "@/lib/healthkit"
import { formatDateTime, formatNumber } from "@/lib/utils"
import type { IngestRule } from "@/lib/types"
import { SyncOverview } from "@/components/SyncOverview"

function RulesOverview() {
  const { data: summary } = useRulesSummary()
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Regole attive</p><p className="text-2xl font-semibold">{summary?.rules_active ?? 0}<span className="text-sm text-muted-foreground font-normal">/{summary?.rules_total ?? 0}</span></p></CardContent></Card>
      <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Blacklist UUID</p><p className="text-2xl font-semibold">{formatNumber(summary?.blacklist_size ?? 0)}</p></CardContent></Card>
      <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Totale scarti</p><p className="text-2xl font-semibold">{formatNumber(summary?.total_hits ?? 0)}</p></CardContent></Card>
      <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Scarti 7 giorni</p><p className="text-2xl font-semibold">{formatNumber(summary?.recent_hits_7d ?? 0)}</p></CardContent></Card>
    </div>
  )
}

function NewRuleForm({ onCreated }: { onCreated: () => void }) {
  const create = useCreateRule()
  const [ruleType, setRuleType] = useState<"value_range" | "blocked_source">("value_range")
  const [typeId, setTypeId] = useState("")
  const [sourceName, setSourceName] = useState("")
  const [valueMin, setValueMin] = useState("")
  const [valueMax, setValueMax] = useState("")
  const [reason, setReason] = useState("")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await create.mutateAsync({
        rule_type: ruleType,
        type_identifier: typeId || null,
        source_name: sourceName || null,
        value_min: valueMin !== "" ? parseFloat(valueMin) : null,
        value_max: valueMax !== "" ? parseFloat(valueMax) : null,
        reason: reason || null,
        active: true,
      })
      setTypeId(""); setSourceName(""); setValueMin(""); setValueMax(""); setReason("")
      onCreated()
    } catch (err) {
      alert("Errore: " + (err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Tipo regola</Label>
          <Select value={ruleType} onValueChange={v => setRuleType(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="value_range">Range valore</SelectItem>
              <SelectItem value="blocked_source">Sorgente bloccata</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Motivo (facoltativo)</Label>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="es. dati altra persona" />
        </div>
      </div>

      {ruleType === "value_range" && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Identifier tipo HealthKit</Label>
            <Input value={typeId} onChange={e => setTypeId(e.target.value)} placeholder="HKQuantityTypeIdentifierBodyMass" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Valore minimo</Label>
              <Input type="number" step="any" value={valueMin} onChange={e => setValueMin(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Valore massimo</Label>
              <Input type="number" step="any" value={valueMax} onChange={e => setValueMax(e.target.value)} />
            </div>
          </div>
        </>
      )}

      {ruleType === "blocked_source" && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Sorgente</Label>
            <Input value={sourceName} onChange={e => setSourceName(e.target.value)} placeholder="es. Renpho" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Solo per tipo (facoltativo)</Label>
            <Input value={typeId} onChange={e => setTypeId(e.target.value)} placeholder="lascia vuoto per tutti i tipi" />
          </div>
        </>
      )}

      <Button type="submit" disabled={create.isPending}>
        <Plus className="h-4 w-4 mr-1" /> Aggiungi regola
      </Button>
    </form>
  )
}

function RuleRow({ rule }: { rule: IngestRule }) {
  const update = useUpdateRule()
  const del = useDeleteRule()
  const reset = useResetRuleStats()
  const [editing, setEditing] = useState(false)
  const [vmin, setVmin] = useState(rule.value_min?.toString() ?? "")
  const [vmax, setVmax] = useState(rule.value_max?.toString() ?? "")

  const label = rule.type_identifier ? getMeta(rule.type_identifier).label : null

  return (
    <TableRow>
      <TableCell className="font-medium">
        {rule.rule_type === "value_range" ? "Range valore" : "Sorgente bloccata"}
      </TableCell>
      <TableCell>
        {rule.type_identifier ? (
          <span>
            {label ?? rule.type_identifier}
            <span className="text-xs text-muted-foreground block">{rule.type_identifier}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>{rule.source_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
      <TableCell className="tabular-nums">
        {rule.rule_type === "value_range" ? (
          editing ? (
            <div className="flex gap-1">
              <Input className="h-7 w-20" type="number" step="any" value={vmin} onChange={e => setVmin(e.target.value)} placeholder="min" />
              <Input className="h-7 w-20" type="number" step="any" value={vmax} onChange={e => setVmax(e.target.value)} placeholder="max" />
            </div>
          ) : (
            <>
              {rule.value_min ?? "−∞"} — {rule.value_max ?? "+∞"}
            </>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{rule.reason ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums">
        <div className="font-medium">{rule.hits_count}</div>
        {rule.last_hit_at && (
          <div className="text-xs text-muted-foreground">{formatDateTime(rule.last_hit_at)}</div>
        )}
      </TableCell>
      <TableCell>
        <label className="inline-flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={rule.active}
            onChange={e => update.mutate({ id: rule.id, patch: { active: e.target.checked } })}
          />
          <span className="text-xs">{rule.active ? "Attiva" : "Off"}</span>
        </label>
      </TableCell>
      <TableCell>
        <div className="flex gap-1 justify-end">
          {editing ? (
            <>
              <Button
                size="sm"
                onClick={async () => {
                  await update.mutateAsync({
                    id: rule.id,
                    patch: {
                      value_min: vmin !== "" ? parseFloat(vmin) : null,
                      value_max: vmax !== "" ? parseFloat(vmax) : null,
                    },
                  })
                  setEditing(false)
                }}
              >Salva</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Annulla</Button>
            </>
          ) : (
            rule.rule_type === "value_range" && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Modifica</Button>
            )
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => reset.mutate(rule.id)} title="Reset statistica">
            <RefreshCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => { if (confirm("Eliminare questa regola?")) del.mutate(rule.id) }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function BlacklistTab() {
  const { data: entries } = useBlacklist()
  const remove = useRemoveBlacklist()

  return (
    <Card>
      <CardHeader>
        <CardTitle>UUID in blacklist ({entries?.length ?? 0})</CardTitle>
      </CardHeader>
      <CardContent>
        {!entries || entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nessun UUID in blacklist.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>UUID</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Aggiunto</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">{e.hk_uuid}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.reason ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDateTime(e.created_at)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => { if (confirm("Rimuovere dalla blacklist?")) remove.mutate(e.id) }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

export default function Settings() {
  const { data: rules } = useRules()
  const [showNewForm, setShowNewForm] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Impostazioni</h1>
        <p className="text-muted-foreground">Regole di filtraggio, sorgenti bloccate e UUID in blacklist</p>
      </div>

      <RulesOverview />

      <Tabs defaultValue="sync">
        <TabsList>
          <TabsTrigger value="sync">Sincronizzazione</TabsTrigger>
          <TabsTrigger value="rules">Regole ingest</TabsTrigger>
          <TabsTrigger value="blacklist">Blacklist UUID</TabsTrigger>
        </TabsList>

        <TabsContent value="sync">
          <SyncOverview />
        </TabsContent>

        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Regole attive ({rules?.length ?? 0})</CardTitle>
                <Button size="sm" onClick={() => setShowNewForm(!showNewForm)}>
                  <Plus className="h-4 w-4 mr-1" /> Nuova regola
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {showNewForm && (
                <Card>
                  <CardContent className="p-4">
                    <NewRuleForm onCreated={() => setShowNewForm(false)} />
                  </CardContent>
                </Card>
              )}

              {rules && rules.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Dato HealthKit</TableHead>
                      <TableHead>Sorgente</TableHead>
                      <TableHead>Range</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="text-right">Scarti</TableHead>
                      <TableHead>Stato</TableHead>
                      <TableHead className="text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map(r => <RuleRow key={r.id} rule={r} />)}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">Nessuna regola configurata.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="blacklist">
          <BlacklistTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
