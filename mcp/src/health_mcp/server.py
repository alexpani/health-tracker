"""FastMCP server entry. Registra i tool e monta lo streamable-HTTP transport."""
from __future__ import annotations

import logging

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.types import ASGIApp, Receive, Scope, Send

from .auth import BearerAuthMiddleware
from .config import settings
from .resources import resource_glossary, resource_metrics_catalog, resource_profile
from .tools import analytics, snapshots, sql


class HostHeaderRewrite:
    """ASGI middleware che riscrive l'header Host a localhost prima che MCP lo veda.

    MCP transport_security ha un check anti DNS-rebinding che rifiuta host arbitrari;
    siamo dietro un reverse proxy fidato (NPM) e gestiamo l'auth con bearer token,
    quindi il check non aggiunge sicurezza ma blocca le richieste legittime.
    """

    def __init__(self, app: ASGIApp, replacement: bytes = b"localhost:8765") -> None:
        self.app = app
        self.replacement = replacement

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = [
                (k, self.replacement if k == b"host" else v)
                for k, v in scope.get("headers", [])
            ]
            scope = {**scope, "headers": headers}
        await self.app(scope, receive, send)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("health_mcp")


# stateless_http=True -> ogni request e' indipendente, niente sessione persistente.
# E' la modalita' richiesta dal connector custom di claude.ai.
mcp = FastMCP(
    "health-tracker",
    stateless_http=True,
    # Il path stesso e' il segreto: il token e' nel URL (claude.ai non supporta
    # header custom nei connector). Stesso livello di entropia di un bearer.
    streamable_http_path=f"/mcp/{settings.bearer_token}",
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=["localhost:8765", "127.0.0.1:8765"],
        allowed_origins=[
            "https://healthmcp.activeproxy.it",
            "https://claude.ai",
            "https://*.claude.ai",
            "https://*.anthropic.com",
        ],
    ),
)


# ─── SQL tools ────────────────────────────────────────────────────────────────

@mcp.tool()
async def query_sql(sql_text: str) -> dict:
    """Esegue una SELECT/WITH read-only su Postgres health_tracker.

    Vincoli:
    - solo SELECT o CTE (WITH...)
    - una sola statement (no `;` multipli)
    - LIMIT 5000 applicato automaticamente se assente
    - statement_timeout 10s

    Args:
        sql_text: la query SQL.

    Returns: {columns, rows, row_count, truncated, sql_executed} oppure {error}.
    """
    return await sql.query_sql(sql_text)


@mcp.tool()
async def describe_schema() -> str:
    """Restituisce lo schema completo del DB health_tracker in markdown.

    Una sezione per tabella con colonne, tipi, nullability e commenti. Da chiamare
    all'inizio della chat (o quando serve scrivere SQL non banali) per orientarsi
    sul modello dati.
    """
    return await sql.describe_schema()


@mcp.tool()
async def describe_table(name: str) -> dict:
    """Dettaglio di una singola tabella: colonne, indici, 3 row sample, valori distinti.

    Args:
        name: nome tabella in schema public (es. 'health_samples', 'workouts', 'regimens').
    """
    return await sql.describe_table(name)


# ─── Snapshot/sintesi tools ───────────────────────────────────────────────────

@mcp.tool()
async def get_day(day: str) -> dict:
    """Snapshot completo di una giornata.

    Aggrega attivita' (passi, distanza, calorie), corpo (latest weight/BMI/body fat),
    vitali (HR/HRV/SpO2/BP), nutrizione (kcal/macro/acqua), sonno (totale + stage),
    workout, lab panels, e regimi attivi.

    Args:
        day: data ISO YYYY-MM-DD.
    """
    return await snapshots.get_day(day)


@mcp.tool()
async def get_active_regimens(on_date: str | None = None) -> dict:
    """Regimi attivi in una data.

    Args:
        on_date: data ISO YYYY-MM-DD. Default: oggi.
    """
    return await snapshots.get_active_regimens(on_date)


@mcp.tool()
async def get_health_profile() -> dict:
    """Profilo health: eta', peso/altezza/BMI/body fat recenti, baseline RHR/HRV a 60g, regimi attivi oggi.

    Tipicamente il primo tool da chiamare per orientarsi sull'utente.
    """
    return await snapshots.get_health_profile()


# ─── Analytics tools ──────────────────────────────────────────────────────────

@mcp.tool()
async def aggregate(
    metric: str,
    bucket: str = "month",
    agg: str = "avg",
    start: str | None = None,
    end: str | None = None,
) -> dict:
    """Aggrega una metrica del catalogo su bucket temporali.

    Esempi:
    - aggregate('body.weight', 'month', 'avg', '2020-01-01') -> peso medio mensile dal 2020
    - aggregate('workout.running.km', 'week', 'sum') -> km corsa totali per settimana
    - aggregate('vitals.rhr', 'day', 'avg') -> RHR giornaliera

    Args:
        metric: slug dal catalogo (vedi resource metrics://catalog o lista_metrics).
        bucket: day | week | month | quarter | year.
        agg: avg | sum | min | max | median | count | stddev | slope_per_day.
        start: ISO YYYY-MM-DD (opzionale, default = inizio dati).
        end: ISO YYYY-MM-DD (opzionale, default = oggi).

    Returns: {metric, unit, bucket, agg, n_buckets, rows:[{bucket, value, n}]}.
    """
    return await analytics.aggregate(metric, bucket, agg, start, end)


@mcp.tool()
async def compare_periods(
    periods: list[dict],
    metrics: list[str],
    aggs: list[str] | None = None,
) -> dict:
    """Confronta aggregati di N metriche su M periodi temporali arbitrari.

    Strumento principale per domande tipo "come cambiano X, Y, Z fra periodo A e periodo B".
    Non e' vincolato a regimi specifici: i periodi sono semplici range temporali.

    Esempio:
        periods = [
            {"label": "keto", "ranges": [["2022-01-15", "2022-06-30"], ["2023-09-01", "2024-02-15"]]},
            {"label": "baseline", "ranges": [["2021-01-01", "2021-12-31"]]}
        ]
        metrics = ["body.weight", "vitals.rhr", "workout.running.km", "lab.ldl", "lab.triglycerides"]

    Args:
        periods: lista di {label, ranges:[[start_iso, end_iso], ...]}. Le ranges di un periodo
                 sono unite in OR (utili per periodi non contigui, es. cicli ripetuti).
        metrics: lista di slug dal catalogo.
        aggs: aggregazioni da applicare. Default: [avg, median, stddev, min, max, count, slope_per_day].

    Returns: {results: [{period, metric, unit, n, avg, median, stddev, min, max, slope_per_day, ...}]}.
    """
    return await analytics.compare_periods(periods, metrics, aggs)


@mcp.tool()
async def correlate(
    metrics: list[str],
    bucket: str = "month",
    method: str = "pearson",
    agg: str = "avg",
    start: str | None = None,
    end: str | None = None,
) -> dict:
    """Calcola matrice di correlazione fra N metriche su bucket temporali allineati.

    Bucketizza ogni metrica con `agg`, fa INNER JOIN sui bucket comuni
    (settimane/mesi con almeno un sample di entrambe), poi calcola Pearson o Spearman.

    Esempio:
        correlate(['body.weight', 'workout.running.km', 'lab.ldl', 'lab.hdl'],
                  bucket='month', method='spearman')
        -> matrice di correlazione mensile.

    Args:
        metrics: 2+ slug.
        bucket: granularita' temporale per allineare i dati.
        method: 'pearson' (lineare) o 'spearman' (rank, robusto agli outlier).
        agg: come aggregare i valori dentro il bucket (default avg).
        start, end: filtra il range globale (ISO YYYY-MM-DD).

    Returns: {method, bucket, agg, buckets_used:int, pairs: [{a, b, n, corr}]}.
    """
    return await analytics.correlate(metrics, bucket, method, agg, start, end)  # type: ignore[arg-type]


@mcp.tool()
async def find_periods(
    metric: str,
    condition: str,
    bucket: str = "week",
    agg: str = "avg",
    max_gap_buckets: int = 0,
    start: str | None = None,
    end: str | None = None,
) -> dict:
    """Trova range temporali in cui una metrica soddisfa una condizione.

    Esempi:
    - find_periods('workout.running.km', '> 50', bucket='week', agg='sum') -> settimane con piu' di 50km
    - find_periods('vitals.rhr', '< 55', bucket='day', agg='avg') -> giorni con RHR sotto i 55 bpm
    - find_periods('body.weight', 'BETWEEN 75 AND 80', bucket='month', agg='avg', max_gap_buckets=1)

    Args:
        metric: slug del catalogo.
        condition: condizione SQL safe. Accettati: '> N', '< N', '>= N', '<= N',
                   '= N', '!= N', 'BETWEEN A AND B', 'IS NULL', 'IS NOT NULL'.
        bucket: granularita'.
        agg: come aggregare prima del confronto.
        max_gap_buckets: se >0, unisce range adiacenti separati da fino a N bucket non-matching.
        start, end: filtra range globale.

    Returns: {periods: [{start, end, n_buckets}]}.
    """
    return await analytics.find_periods(
        metric, condition, bucket, agg, max_gap_buckets, start, end
    )


@mcp.tool()
async def life_timeline(
    bucket: str = "month",
    start: str | None = None,
    end: str | None = None,
) -> dict:
    """Overview compatta della vita su bucket — una riga per bucket con tutti i dati salienti.

    Una sola tabella per tutta la storia: regimi attivi, peso medio, RHR/HRV medi,
    sonno medio, km corsa, ritmo medio, calorie attive, passi, date dei lab panel
    in quel bucket, count out-of-range. Ideale per domande tipo "esamina tutta la
    mia storia e trova correlazioni" — il modello vede ~120 righe per 10 anni di
    bucket mensili e puo' ragionare in chiaro sui pattern senza fare 50 query.

    Args:
        bucket: week | month | quarter | year. Default month.
        start, end: ISO YYYY-MM-DD opzionali. Default: dal primo sample a oggi.

    Returns: {bucket, n_buckets, rows:[{bucket, bucket_end, active_regimens, weight_avg_kg,
              rhr_avg, hrv_avg_ms, sleep_avg_h_per_night, running_km_total, running_count,
              running_pace_avg_s_km, active_kcal_avg, steps_avg, lab_panel_dates,
              lab_oor_count, nutrition_kcal_avg}]}.
    """
    return await analytics.life_timeline(bucket, start, end)


@mcp.tool()
async def list_metrics() -> dict:
    """Lista tutti gli slug del catalogo metriche con categoria, unita' e descrizione."""
    from .metrics import by_category
    return {
        cat: [
            {"slug": m.slug, "unit": m.unit, "description": m.description}
            for m in items
        ]
        for cat, items in by_category().items()
    }


@mcp.tool()
async def reload_metrics_catalog() -> dict:
    """Ricarica metrics.yaml senza riavviare il servizio (utile dopo modifiche al catalogo)."""
    return await analytics.reload_metrics_catalog()


# ─── Resources (contesto sempre disponibile) ──────────────────────────────────

@mcp.resource("profile://me")
async def res_profile() -> str:
    """Profilo utente: anagrafica + baseline correnti."""
    return await resource_profile()


@mcp.resource("metrics://catalog")
def res_metrics() -> str:
    """Catalogo metriche aggregabili."""
    return resource_metrics_catalog()


@mcp.resource("glossary://project")
def res_glossary() -> str:
    """Convenzioni semantiche del progetto Health Tracker."""
    return resource_glossary()


# ─── HTTP app ────────────────────────────────────────────────────────────────

async def healthz(_request):
    return JSONResponse({"status": "ok"})


def build_app() -> ASGIApp:
    """ASGI app: MCP streamable-HTTP montato su /mcp + /healthz pubblico."""
    mcp_asgi = mcp.streamable_http_app()
    inner = Starlette(
        routes=[
            Route("/healthz", healthz, methods=["GET"]),
            Route("/livez", healthz, methods=["GET"]),
            Mount("/", app=mcp_asgi),
        ],
        middleware=[],
        lifespan=mcp_asgi.router.lifespan_context,
    )
    # Niente BearerAuthMiddleware: l'autenticazione e' implicita nel path
    # (/mcp/<token>). Path sbagliato -> 404 dal router. Path giusto -> MCP risponde.
    # HostHeaderRewrite davanti a tutto: il check anti DNS-rebinding di MCP
    # rifiuterebbe il nostro hostname pubblico, ma siamo dietro reverse-proxy
    # fidato — il rischio DNS-rebinding non si applica.
    return HostHeaderRewrite(inner)


def main() -> None:
    import uvicorn

    log.info(
        "starting health-mcp on %s:%s -> PG %s",
        settings.host,
        settings.port,
        settings.pg_dsn.split("@")[-1],
    )
    uvicorn.run(
        build_app(),
        host=settings.host,
        port=settings.port,
        log_level="info",
        access_log=False,
    )
