# Health Tracker Bridge

Self-hosted, **bidirectional** bridge between **Apple Health** and **web applications**.

HealthKit is only accessible from native iOS apps. This project lets you:

1. **Read** all health data from Apple Health (40+ types: steps, heart rate, sleep, weight, workouts, nutrition, VO2 max, running/cycling/walking advanced metrics, and more)
2. **Store** it in a PostgreSQL database via a FastAPI REST API
3. **Visualize** it through a React web dashboard with time-series charts, advanced filters, and Apple Fitness-style workout detail pages
4. **Write** body measurements and nutrition data from web apps back to Apple Health
5. **Delete** samples both locally and on Apple Health from the dashboard
6. **Filter spurious data** at ingest via DB-configurable rules + UUID blacklist (auto-populated by PG trigger on delete)
7. **Bulk import** historical data from legacy apps (e.g., Endomondo) and enrich it with GPS routes/calories/HR from a Garmin Connect export (`backend/scripts/import_garmin_routes.py`)
8. **Edit workout notes** persistently
9. **Chat with Claude about your health data** via a dedicated MCP server (read-only) accessible from Claude Desktop, Claude Code and claude.ai connector

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   iPhone    │  sync   │   FastAPI + PG   │  query  │  React Dashboard│
│  (HealthKit)│ ──────► │   (Proxmox LXC)  │ ◄────── │  (Proxmox LXC)  │
│             │ ◄────── │                  │ ──────► │                 │
│  SwiftUI    │  write  │  Rules + BL      │  write  │  Recharts       │
│             │  delete │  Trigger         │  delete │  shadcn/ui      │
└─────────────┘         └─────────┬────────┘         └─────────────────┘
                                  │ SELECT-only (health_ro)
                                  ▼
                        ┌──────────────────┐
                        │  MCP server      │  ── HTTPS ──►  Claude
                        │  (Proxmox LXC)   │   (NPM)         (Desktop / Code / web)
                        │  FastMCP+asyncpg │
                        └──────────────────┘
```

## Components

### Backend (`backend/`)

FastAPI + async SQLAlchemy + PostgreSQL 16, Dockerized. Alembic migrations.

- **Ingest**: batch POST for quantity samples, category samples, workouts. Filtered through configurable rules + UUID blacklist + source blocklist.
- **Query**: GET with aggregation (hourly/daily/weekly/monthly), filters (sources, devices, value range), correlated samples within a time window, sample facets, latest values, sync status (fast via `pg_class.reltuples`), sync sessions (grouped from `sync_log`).
- **Sync heartbeat**: `POST /api/v1/sync/heartbeat` — l'app iOS lo chiama alla fine di un sync che non ha prodotto nuovi dati (nessun batch da inviare), così la tabella sync sessions della dashboard riflette la stessa lista mostrata nell'app invece di saltare le sync vuote.
- **Workouts**: rich filtering by `effective_types` (canonical slugs derived from `activity_type` + metadata, e.g., `treadmill_run`, `swim_pool`), `years[]`, `sources[]`, distance/duration/pace ranges. Single workout detail + per-km splits + delete (with snapshot for undo) + notes PATCH.
- **Write queue**: web → Apple Health via an iOS-polled pending queue. Confirm/fail lifecycle.
- **Delete queue**: plan + confirm + fail workflow for Apple Health deletions issued from the web.
- **Rules + blacklist**: CRUD for ingest rules (value_range, blocked_source) with hit counters; UUID blacklist with `purge-and-blacklist` atomic operation.
- **Auto-blacklist trigger**: any DELETE on `health_samples` automatically adds the UUID to `ingest_blacklist` → prevents re-ingestion on future syncs.

### iOS App (`ios/HealthTracker/`)

SwiftUI native app targeting iOS 17+.

- Reads 40+ HealthKit data types (including VO2 max, running power/speed/stride, cycling power/cadence, walking speed/asymmetry, stair speeds)
- Incremental sync with `lastSyncDate` per type in SwiftData
- Memory-safe 90-day fetch windows; **parallel** HTTP uploads (4 concurrent); batch size 1000
- **Real-time auto-sync**: `HKObserverQuery` + background delivery → app reacts to new HealthKit data, even when backgrounded
- Auto-sync on launch + foreground (10-min throttle), plus hourly `BGAppRefreshTask` fallback and **Significant Location Changes** wake-ups (CoreLocation SLC monitoring; the app uses cell-tower changes as a wake signal only — no GPS, no coordinates persisted)
- **Writes** pending data from web apps to Apple Health via `HKHealthStore.save()`
- **Deletes** samples via `HKHealthStore.delete()` (only samples the app created — HealthKit rule)
- **Propagates Apple Health deletions**: workouts and ~30 low/medium-volume quantity types (body metrics, dietary, low-frequency vitals like resting heart rate / HRV / VO2 max, mobility metrics) are synced via `HKAnchoredObjectQuery`, so cancellations on the phone side are mirrored to the backend (and auto-blacklisted so they can't re-appear)
- **Handles retroactive writes**: third-party scales like Withings — and the Apple Watch itself for resting HR, wrist temperature and VO2 max — write samples to HealthKit with `startDate` in the past but `creationDate` later; the anchored queries catch them reliably where a windowed `HKSampleQuery` would miss them (critical for once-a-day metrics, where a single missed sample loses a whole day)
- Progress UI: per-type progress bar, sample counter, stop button, **date reached** display
- Persistent sync summary (last sync log, duration, samples) across app launches via UserDefaults
- Tabs: **Sync (default)**, Dashboard (today's body metrics), Settings

### Dashboard (`dashboard/`)

React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Recharts + TanStack Query.

**Pages:**
- **Home** — today's metrics, weekly charts, last 3 workouts, sync status, last 10 sync sessions table, **bottone "Sincronizza"** in alto a destra per refetch immediato di tutte le query dipendenti dai dati sync iOS (le query hanno già polling 30 min come fallback automatico)
- **Calendario** (`/day/:date`) — vista per giorno: scegli una data e vedi in un colpo d'occhio attivita' (da HKStatisticsCollectionQuery), corpo, vitali, nutrizione (diario o HK), sonno con stages, workout, eventuali panel lab di quel giorno, regimi attivi (farmaci, integratori, dieta, allenamento) e le **voci di diario** del giorno (N note per giorno, rich text + tag con editor Tiptap, ognuna con la propria data editabile per spostarla). Naviga con ←/→ o date picker. Link condivisibili (la data e' nell'URL).
- **Diario** (`/journal`) — gestione veloce delle voci diario (N voci per giorno, data editabile per spostare una nota): **heatmap annuale** GitHub-style in cima (click su una cella → giorno), ricerca full-text con **stemming italiano** (multi-parola, virgolette per frase esatta), chip tag con menu "Rinomina/Elimina ovunque", **selezione multipla** con toolbar bulk (Aggiungi tag / Rimuovi tag / Elimina), click sulla riga apre la modifica con auto-save, icona calendario laterale per saltare al giorno, cestino per cancellare; highlight `<mark>` dei match nella preview. **Quick capture globale**: icona libro nella topbar + scorciatoia **`Cmd/Ctrl+J`** creano sempre una nuova nota sulla data odierna da qualsiasi pagina. **Auto-save** ogni 1.5s di idle nel JournalForm con indicatore "Salvato HH:MM:SS".
- **Regimi** (`/regimens`) — gestione manuale di farmaci, integratori, piani alimentari, piani di allenamento e equipaggiamento come periodi (start_date / end_date opzionali, dose, note). Backfill best-effort dai campi context dei panel lab confermati via script `backend/scripts/backfill_regimens_from_lab.py`. **Auto-detect piani di allenamento** dai workout sincronizzati via `backend/scripts/autodetect_training_regimens.py` (cron notturno alle 03:45): rileva fasce con ≥10 workout/30gg e gap max 15gg, badge "da workout" e date bloccate (resto editabile). Nella tab **Alimentazione**, i piani gestiti nel diario-alimentare appaiono read-only ("dal diario"): lo **storico** è ricostruito dai daily snapshot del diario (`GET /api/v1/diario/plan-history`), così i piani passati finiscono tra i "Terminati" col nome reale e l'attivo resta "in corso" (storico da ~apr 2026; periodi precedenti coperti dai diet manuali). **Avvisi promemoria**: quando un regime raggiunge il giorno di inizio o il suo ultimo giorno previsto, all'accesso alla dashboard compare un popup (uno per regime, da spuntare singolarmente). L'avviso **continua a riapparire nei giorni successivi** finché non viene confermato una volta (conferma permanente via localStorage); si risolve da solo se il regime viene prolungato o eliminato.
- **Visite / Referti / Documentazione** (`/visite`, `/referti`, `/documentazione`) — tre archivi documentali con lo stesso funzionamento: carichi un PDF (visita specialistica, esame strumentale, attestato/certificato), l'IA pre-compila i metadati (data, categoria, titolo, struttura, medico), poi revisioni a mano e confermi. L'upload risponde subito e l'**analisi IA gira in background** (la lista mostra "analisi in corso…" finché termina). I **PDF scansionati vengono convertiti in PDF cercabili** via OCR (ocrmypdf + tesseract ita/eng), così anche i referti cartacei finiscono nella ricerca full-text. Per le **Visite** l'IA compila automaticamente le **note** con un riassunto dei contenuti salienti (motivo, esito, terapie, follow-up), ma solo se le note sono vuote — non sovrascrive mai quelle scritte a mano; se il documento non è leggibile, salta. Categorie gestibili per sezione. UI master-detail: filtri a sinistra (ricerca full-text con stemming italiano, chip categoria, periodo, stato), elenco al centro, anteprima del PDF a destra che si aggiorna scorrendo l'elenco. Niente HealthKit / iOS — feature solo dashboard.
- **Laboratorio** (`/lab`) — referti del sangue/urine: carichi un PDF, l'IA estrae gli analiti, revisioni e confermi. Tab **Matrice** (analiti × date, celle rosse fuori range), **Andamenti** (grafici nel tempo con banda di riferimento) e **Correlazioni**. La tab **Correlazioni** evidenzia **da sola** le possibili associazioni fra una variazione marcata di un esame e un evento di terapia/integratore/nota di salute avvenuto nello stesso periodo (es. transaminasi ↑ in concomitanza con un aumento di allopurinolo): un motore deterministico trova e ordina le coincidenze, poi l'IA aggiunge la **plausibilità farmacologica** e una breve spiegazione del meccanismo — sempre come **ipotesi da verificare con un medico**, mai diagnosi o consigli. Le stesse segnalazioni compaiono come card nella review del referto, come pallino sulle celle coinvolte della Matrice e come widget proattivo nella vista di oggi. Niente HealthKit / iOS — feature solo dashboard.
- **Attivita** — steps, distance, flights, calories (tabbed). Per i 9 tipi cumulative (Steps, Distance{Walking,Cycling,Swimming}, FlightsClimbed, {Active,Basal}Energy, Apple{Exercise,Stand,Move}Time) il chart aggregato giornaliero legge i totali pre-calcolati da `HKStatisticsCollectionQuery` (tabella `daily_stats`), che combaciano coi widget di Apple Salute (HK applica internamente il dedup Watch+iPhone).
- **Vitali** — HR, HRV, SpO2, BP, respiratory, temperature, glucose
- **Corpo** — weight, BMI, body fat, lean mass, height, waist. **Left sidebar filters** with year chips (2001→today, click to jump to a full year), preset ranges, source chips and weight range. **Multi-line chart** with per-series autoscale Y-axes, multi-metric tooltip and **drag-to-select** popover showing the delta for every active metric in the selected interval. **Weight variation cards** (last month / last year / all-time / selected range). **Paginated table** with all raw samples (50/page). Row-level delete with correlated-samples confirmation.
- **Sonno** — sleep analysis, stacked bar chart per night
- **Workout** — main page with **left sidebar filters** (year, activity chips, source, datetime range, distance km, duration min, **pace dual-range slider + preset chips**, title search, notes search), summary stats, workouts-per-period chart with **click-to-drilldown** zoom (year → month → week → day → workout), **sortable list** (title, pace, notes columns included), row delete with 8s undo. Third-party workout titles (e.g., Intervals Pro "Corsa Livello 2") are auto-promoted from metadata into a dedicated column. Filters **persisted in sessionStorage** so they survive navigation. **Modalità confronto**: toggle "Confronta" che attiva checkbox per riga, blocca la navigazione e raccoglie due workout in due slot (A/B); selezionato il primo, la lista si filtra automaticamente sullo stesso tipo; barra sticky in basso con bottone "Confronta" che apre la pagina di confronto. Main layout uses a **hamburger menu** top-bar that opens the nav drawer.
- **Confronto workout** (`/workouts/compare?a=<uuid>&b=<uuid>`) — affianca due workout dello stesso tipo: card header A/B con link al detail singolo, griglia metriche principali con delta colorato (verde = A migliore, rosso = peggiore — durata/ritmo/HR favoriscono il minore; distanza/calorie il maggiore), tabella parziali per km unificata con delta ritmo, e quattro chart sovrapposti (HR, velocità, potenza, cadenza) con asse X = tempo trascorso dall'inizio per allineare workout di date diverse. Mappa GPS non disponibile in questa vista — link ai detail singoli per il tracciato.
- **Workout detail** (`/workouts/:uuid`) — Apple Fitness-style: metrics (duration, distance, calories, pace, HR), "Informazioni aggiuntive" card (indoor/outdoor, swim location, lap length, elevation, METs, weather, brand), **per-km splits** table — **righe cliccabili**: click su un km evidenzia il segmento sulla mappa (calcolato dai timestamp cumulativi del workout). **Intervalli** card with per-lap distance/pace/HR/kcal (Intervals Pro, Apple Watch strutturati, Strava, HealthFit, ecc.), time-series charts (HR, running speed, power, cadence, oscillazione verticale, tempo di contatto col suolo, lunghezza falcata, **vertical ratio** — tooltip velocita' con km/h + min/km; le metriche di forma della corsa appaiono solo se presenti; ogni chart mostra min/max nell'header). La vertical ratio (oscillazione ÷ falcata, %) e' derivata client-side e include una nota collassabile su come interpretarla. I chart time-series condividono la stessa scala oraria e i **tooltip sono sincronizzati**: hover su un grafico mostra il cursore e i valori corrispondenti su tutti gli altri. **Selezione di un intervallo**: trascinando orizzontalmente su un grafico si evidenzia una finestra temporale su tutti i chart in parallelo e un popover mostra i valori medi di ogni metrica in quell'intervallo. Per workout pre-2019 di Apple Watch (1 solo sample HR aggregato lungo l'intero workout) la card del chart cardiaco e' nascosta del tutto — la FC media e' gia' visibile nelle metriche in alto. Titolo e Note nei due box affiancati. **Editable title and notes** cards. **Mappa percorso GPS** con Leaflet + OpenStreetMap (no API key): polyline colorata per pace, marker partenza/arrivo, tooltip al hover col tempo, velocita' (km/h + min/km) e battito cardiaco, profilo altimetrico Recharts sincronizzato. **Container ridimensionabile**: preset S/M/L + drag handle verticale + toggle fullscreen. Backfill automatico delle route storiche al sync (max 500/sync per non bloccare).
- **Record** (`/records`) — Personal records per la corsa con sidebar filtri indipendenti (anno / sorgente / outdoor-indoor). Per ogni variante: distanza, durata, pace medio e kcal max; miglior tempo a 5K/10K/mezza/maratona; miglior singolo km ricostruito dai sample di distanza.
- **Nutrizione** — in cima, **Calendario registrazioni** con celle colorate per aderenza al target e riassunto del giorno selezionato sotto la griglia (default = oggi, sostituisce la vecchia card "Oggi"; il nome del piano alimentare attivo è mostrato accanto al titolo del calendario). Sotto, integrazione col servizio esterno `diario-alimentare` con sezione "Storico filtrato" (area chart kcal consumate + linea tratteggiata target + tabella). Click su una barra dell'istogramma o cambio del filtro periodo → il calendario salta sul giorno corrispondente. Calendario e istogramma condividono un hook `useConsolidatedDailyTotals` (diario + sample HK dietary esterni) che colora anche i giorni pre-diario (es. Lifesum 2015). In fondo, dati HealthKit (calorie/macros/acqua/caffeina). Pulsante **"Sincronizza con Apple Salute"** che accoda i totali giornalieri del diario (kcal + 3 macro) sulla write/delete queue esistente: al prossimo Sync Now sull'iPhone finiscono in Apple Salute, con delete+recreate idempotente quando il totale di un giorno cambia (tracking in `diario_hk_sync`).
- **Stretching** — visualizzazione read-only delle sessioni registrate dall'app PWA `alexpani/stretching`. Selettore periodo, card (sessioni, tempo totale, streak corrente, streak max), barchart minuti/giorno e tabella sessioni. I dati vivono nella PWA; la dashboard li proxya via `/api/v1/stretching/*`. Niente sync HealthKit (per ora).
- **Fitness** — VO2 max, running/cycling/walking advanced metrics, stair speeds
- **Esplora** — universal browser: pick any data type + filter bar + chart + raw table
- **Inserisci** — form to queue body/nutrition writes back to Apple Health
- **Impostazioni** — ingest rules CRUD (add, edit min/max, toggle active, reset stats), blacklist UUID list with remove

**Filters (generic, TypeBrowser pages)**: precise date range + multiple sources + multiple devices + value min/max, with DB-range hints.

### MCP Server (`mcp/`)

Read-only Model Context Protocol server che espone Health Tracker a Claude (Desktop, Code, claude.ai connector). Permette di chattare con Claude sui propri dati salute usando linguaggio naturale.

**15 tool**:
- `query_sql` / `describe_schema` / `describe_table` — SQL libero su utente Postgres `health_ro` (SELECT-only, statement_timeout 10s, auto-LIMIT 5000).
- `get_day` / `get_active_regimens` / `get_health_profile` — sintesi via FastAPI backend.
- `aggregate` / `compare_periods` / `correlate` / `find_periods` / `life_timeline` — primitive analitiche per domande tipo "esamina 10 anni e trova correlazioni". Bucket day/week/month/quarter/year, aggregati avg/sum/median/stddev/slope, Pearson/Spearman.
- `get_workout_intervals` / `list_recent_workouts` — drilldown nei segmenti interni dei workout strutturati (Intervals Pro, Apple custom, Strava intervals): legge `workouts.activities` JSONB e classifica i segmenti come `run`/`walk`/`mixed` via soglie pace.
- `list_metrics` / `reload_metrics_catalog` — gestione del catalogo `metrics.yaml`.

**3 resource statiche** caricate automaticamente: `profile://me`, `metrics://catalog`, `glossary://project` (convenzioni semantiche del progetto).

**Catalogo metriche estensibile** in `mcp/metrics.yaml`: ~45 slug per body, vitals, activity, workout, nutrition, sleep, lab. Ogni metrica è una subquery che ritorna `(t, v)`; aggiungere una metrica = aggiungere una voce YAML (hot-reload via tool, niente restart).

**Deploy**: Debian 13 LXC `ealth-mcp` (192.168.68.100), Python venv + systemd nativo. NPM (`healthmcp.activeproxy.it`) per TLS. Token segreto nel PATH dell'URL (`/mcp/<64-hex>`) perché claude.ai web non supporta header custom. `cd mcp && ./deploy/deploy.sh`.

## Quick Start

### Prerequisites

- macOS + Xcode 16+ + Apple Developer account (personal team OK)
- Docker host (Proxmox LXC, Linux, or macOS)
- Physical iPhone

### 1. Backend

```bash
cd backend
docker compose up -d
docker compose exec api alembic upgrade head
```

Swagger UI: `http://<backend-ip>:8000/docs`

### 2. iOS App

1. Open `ios/HealthTracker/HealthTracker.xcodeproj` in Xcode
2. Set signing team + a unique bundle identifier
3. Ensure HealthKit capability is enabled (Signing & Capabilities)
4. Connect iPhone, select as build destination, ⌘+R
5. Grant read/write permissions (you'll be prompted)
6. Open **Settings** tab, set server URL (e.g., `http://192.168.68.166:8000`)
7. Press **Sync Now** (or leave it to auto-sync on launch / foreground / HealthKit updates)

### 3. Dashboard

```bash
cd dashboard

# Development
npm install
VITE_API_URL=http://<backend-ip>:8000 npm run dev

# Production (Docker)
docker compose up -d --build
# → http://<dashboard-ip>
```

## API Examples

```bash
# Fast sync status (via pg_class)
curl http://localhost:8000/api/v1/sync/status

# Recent sync sessions
curl http://localhost:8000/api/v1/sync/sessions?limit=10

# Daily step count last 7 days
curl "http://localhost:8000/api/v1/samples?type=HKQuantityTypeIdentifierStepCount&aggregation=daily&start=2025-01-01T00:00:00Z"

# Latest weight
curl "http://localhost:8000/api/v1/samples/latest?type=HKQuantityTypeIdentifierBodyMass"

# Filtered samples with sources + value range
curl "http://localhost:8000/api/v1/samples?type=HKQuantityTypeIdentifierBodyMass&sources=Withings&value_min=70&aggregation=weekly"

# Write a weight measurement (queued; iOS syncs to Apple Health on next sync)
curl -X POST http://localhost:8000/api/v1/write \
  -H "Content-Type: application/json" \
  -d '{"type":"HKQuantityTypeIdentifierBodyMass","value":75.5,"unit":"kg","start_date":"2026-01-01T09:00:00Z","end_date":"2026-01-01T09:00:00Z"}'

# Plan a bulk deletion
curl -X POST http://localhost:8000/api/v1/delete/plan \
  -H "Content-Type: application/json" \
  -d '{"types":["HKQuantityTypeIdentifierBodyMass"],"value_max":70}'

# Create a new ingest rule
curl -X POST http://localhost:8000/api/v1/rules \
  -H "Content-Type: application/json" \
  -d '{"rule_type":"blocked_source","source_name":"FooScale","reason":"unreliable"}'

# Purge + blacklist (atomic)
curl -X POST http://localhost:8000/api/v1/blacklist/purge-and-blacklist \
  -H "Content-Type: application/json" \
  -d '{"types":["HKQuantityTypeIdentifierBodyMass"],"source_name":"FooScale","reason":"cleanup"}'

# Workouts: advanced filters
curl "http://localhost:8000/api/v1/workouts?effective_types=treadmill_run&effective_types=type_37&years=2023&years=2024&pace_min=300&pace_max=360&distance_min=3000"

# Workout detail + splits
curl http://localhost:8000/api/v1/workouts/by-uuid/<uuid>
curl "http://localhost:8000/api/v1/workouts/by-uuid/<uuid>/splits?distance_km=1.0"

# Update workout notes
curl -X PATCH http://localhost:8000/api/v1/workouts/by-uuid/<uuid> \
  -H "Content-Type: application/json" \
  -d '{"notes":"good run"}'
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| iOS | Swift, SwiftUI, HealthKit, SwiftData, BGTaskScheduler, HKObserverQuery |
| Backend | Python, FastAPI, SQLAlchemy (async), PostgreSQL 16, Alembic, Docker |
| Dashboard | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix primitives), Recharts, TanStack Query |

## License

MIT
