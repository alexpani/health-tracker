# Health Tracker MCP Server

MCP (Model Context Protocol) server che espone il dominio Health Tracker a Claude (Desktop, Code, claude.ai connector). Read-only.

## Architettura

```
Claude (Desktop / Code / claude.ai)
        │
        │  Streamable HTTP + bearer auth
        ▼
NPM (activeproxy.it)
        │  reverse_proxy
        ▼
LXC ealth-mcp 192.168.68.100:8765
        │
        ├─ Postgres health_ro su 192.168.68.166:5432 (SELECT only)
        └─ FastAPI 192.168.68.166:8000 (per gli endpoint di sintesi)
```

## Tool esposti (prima ondata MVP)

**SQL libero (la leva principale)**
- `query_sql(sql)` — esegue SELECT su utente Postgres `health_ro`. Statement timeout 10s, auto-LIMIT 5000, no multi-statement.
- `describe_schema()` — markdown con tutte le tabelle + colonne + tipi.
- `describe_table(name)` — dettaglio + 3 row sample + valori distinti per colonne enum-like.

**Sintesi pronte (scorciatoie)**
- `get_day(date)` — snapshot completo di un giorno (proxy a `/api/v1/day/<date>`).
- `get_health_profile()` — età, peso/altezza recenti, regimi attivi, BMI.
- `get_active_regimens(date?)` — regimi attivi a una data (default oggi).

## Quickstart locale (dev)

```bash
cd mcp
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
# edita .env con i valori reali
python -m health_mcp
# → server su http://0.0.0.0:8765/mcp
```

## Deploy

```bash
./deploy/deploy.sh
```

Script idempotente: copia il codice via `scp` su `root@192.168.68.100:/opt/health-mcp/`, installa/aggiorna le dipendenze nel venv, restart `health-mcp.service`.

## Configurazione NPM

Nuovo Proxy Host:
- Domain: `healthmcp.activeproxy.it`
- Scheme: `http`
- Forward Host: `192.168.68.100`
- Forward Port: `8765`
- ✅ Websockets Support
- ✅ Block Common Exploits
- SSL: Request new certificate (Let's Encrypt) — Force SSL + HTTP/2

## Connettore claude.ai

Settings → Connectors → Custom → Add:
- URL: `https://healthmcp.activeproxy.it/mcp`
- Custom header: `Authorization: Bearer <token>` (vedi `.env`)

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "health": {
      "transport": {
        "type": "http",
        "url": "https://healthmcp.activeproxy.it/mcp",
        "headers": { "Authorization": "Bearer <token>" }
      }
    }
  }
}
```
