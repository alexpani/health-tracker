import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, KeyRound, Loader2, Sparkles, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiGet, apiPost, apiPut } from "@/lib/api"

interface AIConfig {
  provider: string
  model: string | null
  has_key: boolean
  key_hint: string | null
}

interface AIModel {
  id: string
  display_name: string
  created_at: string | null
}

interface AITestResult {
  ok: boolean
  model: string
  reply?: string
  latency_ms?: number
  error?: string
}

const CONFIG_KEY = ["aiConfig"]
const CUSTOM_MODEL = "__custom__"

/**
 * Sezione "Intelligenza artificiale" di /settings: modello e API key Anthropic
 * usati da analisi referti lab, metadati/riassunti di Visite-Referti-
 * Documentazione e annotazione delle correlazioni. Salvati lato server
 * (`/api/v1/ai/config`, unica fonte: niente default da env); la chiave e'
 * write-only (si vede solo un hint mascherato).
 */
export function AISettingsSection() {
  const qc = useQueryClient()
  const { data: cfg, isLoading } = useQuery({
    queryKey: CONFIG_KEY,
    queryFn: () => apiGet<AIConfig>("/api/v1/ai/config"),
  })
  const models = useQuery({
    queryKey: ["aiModels", cfg?.key_hint],
    queryFn: () => apiGet<AIModel[]>("/api/v1/ai/models"),
    enabled: !!cfg?.has_key,
    staleTime: 10 * 60_000,
    retry: false,
  })

  const [model, setModel] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [test, setTest] = useState<AITestResult | null>(null)
  const [customModel, setCustomModel] = useState(false)

  useEffect(() => {
    if (cfg) setModel(cfg.model ?? "")
  }, [cfg?.model])

  const save = useMutation({
    mutationFn: (body: { model?: string | null; api_key?: string | null }) =>
      apiPut<AIConfig>("/api/v1/ai/config", body),
    onSuccess: data => {
      qc.setQueryData(CONFIG_KEY, data)
      setTest(null)
    },
  })

  const runTest = useMutation({
    mutationFn: (body: { model?: string; api_key?: string }) =>
      apiPost<AITestResult>("/api/v1/ai/test", body),
    onSuccess: setTest,
    onError: err => setTest({ ok: false, model, error: (err as Error).message }),
  })

  if (isLoading || !cfg) {
    return <p className="text-sm text-muted-foreground">Caricamento…</p>
  }

  const modelDirty = model.trim() !== "" && model.trim() !== cfg.model
  // Il modello corrente potrebbe non essere nell'elenco (ID scritto a mano o
  // modello ritirato): lo aggiungiamo in testa cosi' la tendina lo mostra.
  const modelOptions: AIModel[] = models.data
    ? (!cfg.model || models.data.some(m => m.id === cfg.model)
        ? models.data
        : [{ id: cfg.model, display_name: "Attuale", created_at: null }, ...models.data])
    : []
  const modelInList = modelOptions.some(m => m.id === model.trim())

  return (
    <div className="space-y-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Intelligenza artificiale
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p className="text-muted-foreground">
            Usata per leggere i referti di laboratorio, estrarre metadati e riassunti di
            Visite / Referti / Documentazione e valutare le correlazioni esami ↔ regimi.
          </p>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-2">
            <span className="text-muted-foreground">Motore</span>
            <span>Anthropic Claude</span>
            <span className="text-muted-foreground">Modello</span>
            <span className="flex items-center gap-2 flex-wrap">
              {cfg.model ? <code className="text-xs">{cfg.model}</code> : <span className="text-red-600">non configurato</span>}
            </span>
            <span className="text-muted-foreground">API key</span>
            <span className="flex items-center gap-2 flex-wrap">
              {cfg.key_hint ? <code className="text-xs">{cfg.key_hint}</code> : <span className="text-red-600">non configurata</span>}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Modello</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Modello</Label>
            {models.isSuccess && !customModel ? (
              <Select
                value={modelInList ? model.trim() : undefined}
                onValueChange={v => {
                  if (v === CUSTOM_MODEL) setCustomModel(true)
                  else setModel(v)
                }}
              >
                <SelectTrigger><SelectValue placeholder="Scegli un modello" /></SelectTrigger>
                <SelectContent>
                  {modelOptions.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.display_name} <span className="text-muted-foreground font-mono text-xs ml-1">{m.id}</span>
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_MODEL}>Altro… (scrivi l'ID)</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder="es. claude-sonnet-5-5"
                  className="font-mono"
                />
                {models.isSuccess && (
                  <Button size="sm" variant="ghost" onClick={() => { setCustomModel(false); setModel(cfg.model ?? "") }}>
                    Elenco
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {models.isSuccess
                ? `${models.data.length} modelli disponibili per la tua chiave.`
                : models.isError
                  ? "Impossibile leggere l'elenco dei modelli: scrivi l'ID a mano."
                  : cfg.has_key ? "Carico l'elenco dei modelli…" : "Configura una API key per vedere l'elenco dei modelli."}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              disabled={!modelDirty || save.isPending}
              onClick={() => save.mutate({ model: model.trim() })}
            >Salva modello</Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!model.trim() || runTest.isPending}
              onClick={() => runTest.mutate({ model: model.trim() })}
            >Prova modello</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> API key</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Nuova API key Anthropic</Label>
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={cfg.key_hint ? `attuale: ${cfg.key_hint}` : "sk-ant-…"}
            />
            <p className="text-xs text-muted-foreground">
              Salvata sul server e mai mostrata per intero. Si crea su console.anthropic.com → API Keys.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              disabled={!apiKey.trim() || runTest.isPending}
              onClick={() => runTest.mutate({ api_key: apiKey.trim(), model: model.trim() || undefined })}
            >Prova chiave</Button>
            <Button
              size="sm"
              disabled={!apiKey.trim() || save.isPending}
              onClick={() => save.mutate({ api_key: apiKey.trim() }, { onSuccess: () => setApiKey("") })}
            >Salva chiave</Button>
            {cfg.has_key && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={save.isPending}
                onClick={() => {
                  if (confirm("Rimuovere la API key? Le funzioni IA smetteranno di funzionare finché non ne salvi un'altra.")) save.mutate({ api_key: null })
                }}
              >Rimuovi chiave</Button>
            )}
          </div>
        </CardContent>
      </Card>

      {(runTest.isPending || test) && (
        <div className="text-sm flex items-start gap-2 rounded-md border p-3">
          {runTest.isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin mt-0.5" /> Prova in corso…</>
          ) : test?.ok ? (
            <><CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" />
              <span>Funziona: <code>{test.model}</code> ha risposto in {test.latency_ms} ms.</span></>
          ) : (
            <><XCircle className="h-4 w-4 text-red-600 mt-0.5" />
              <span className="break-all">Errore con <code>{test?.model}</code>: {test?.error}</span></>
          )}
        </div>
      )}
      {save.isError && (
        <p className="text-sm text-red-600">Salvataggio fallito: {(save.error as Error).message}</p>
      )}
    </div>
  )
}
