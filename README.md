# Health Tracker Bridge

Self-hosted, **bidirectional** bridge between **Apple Health** and **web applications**.

HealthKit is only accessible from native iOS apps. This project lets you:

1. **Read** all health data from Apple Health (40+ types: steps, heart rate, sleep, weight, workouts, nutrition, VO2 max, running/cycling/walking advanced metrics, and more)
2. **Store** it in a PostgreSQL database via a FastAPI REST API
3. **Visualize** it through a React web dashboard with time-series charts, advanced filters, and Apple Fitness-style workout detail pages
4. **Write** body measurements and nutrition data from web apps back to Apple Health
5. **Delete** samples both locally and on Apple Health from the dashboard
6. **Filter spurious data** at ingest via DB-configurable rules + UUID blacklist (auto-populated by PG trigger on delete)
7. **Bulk import** historical data from legacy apps (e.g., Endomondo)
8. **Edit workout notes** persistently

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   iPhone    │  sync   │   FastAPI + PG   │  query  │  React Dashboard│
│  (HealthKit)│ ──────► │   (Proxmox LXC)  │ ◄────── │  (Proxmox LXC)  │
│             │ ◄────── │                  │ ──────► │                 │
│  SwiftUI    │  write  │  Rules + BL      │  write  │  Recharts       │
│             │  delete │  Trigger         │  delete │  shadcn/ui      │
└─────────────┘         └──────────────────┘         └─────────────────┘
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
- Auto-sync on launch + foreground (10-min throttle), plus hourly `BGAppRefreshTask` fallback
- **Writes** pending data from web apps to Apple Health via `HKHealthStore.save()`
- **Deletes** samples via `HKHealthStore.delete()` (only samples the app created — HealthKit rule)
- **Propagates Apple Health deletions**: workouts and body-metric samples (peso, BMI, grasso, magra, altezza, vita) are synced via `HKAnchoredObjectQuery`, so cancellations on the phone side are mirrored to the backend (and auto-blacklisted so they can't re-appear)
- **Handles retroactive writes**: third-party scales like Withings write samples to HealthKit with `startDate` in the past but `creationDate` later; the anchored queries catch them reliably where a windowed `HKSampleQuery` would miss them
- Progress UI: per-type progress bar, sample counter, stop button, **date reached** display
- Persistent sync summary (last sync log, duration, samples) across app launches via UserDefaults
- Tabs: **Sync (default)**, Dashboard (today's body metrics), Settings

### Dashboard (`dashboard/`)

React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Recharts + TanStack Query.

**Pages:**
- **Home** — today's metrics, weekly charts, last 3 workouts, sync status, last 10 sync sessions table, **bottone "Sincronizza"** in alto a destra per refetch immediato di tutte le query dipendenti dai dati sync iOS (le query hanno già polling 30 min come fallback automatico)
- **Calendario** (`/day/:date`) — vista per giorno: scegli una data e vedi in un colpo d'occhio attivita' (da HKStatisticsCollectionQuery), corpo, vitali, nutrizione (diario o HK), sonno con stages, workout, eventuali panel lab di quel giorno, e i regimi attivi (farmaci, integratori, dieta, allenamento). Naviga con ←/→ o date picker. Link condivisibili (la data e' nell'URL).
- **Regimi** (`/regimens`) — gestione manuale di farmaci, integratori, piani alimentari e piani di allenamento come periodi (start_date / end_date opzionali, dose, note). Backfill best-effort dai campi context dei panel lab confermati via script `backend/scripts/backfill_regimens_from_lab.py`.
- **Attivita** — steps, distance, flights, calories (tabbed). Per i 9 tipi cumulative (Steps, Distance{Walking,Cycling,Swimming}, FlightsClimbed, {Active,Basal}Energy, Apple{Exercise,Stand,Move}Time) il chart aggregato giornaliero legge i totali pre-calcolati da `HKStatisticsCollectionQuery` (tabella `daily_stats`), che combaciano coi widget di Apple Salute (HK applica internamente il dedup Watch+iPhone).
- **Vitali** — HR, HRV, SpO2, BP, respiratory, temperature, glucose
- **Corpo** — weight, BMI, body fat, lean mass, height, waist. **Left sidebar filters** with year chips (2001→today, click to jump to a full year), preset ranges, source chips and weight range. **Multi-line chart** with per-series autoscale Y-axes, multi-metric tooltip and **drag-to-select** popover showing the delta for every active metric in the selected interval. **Weight variation cards** (last month / last year / all-time / selected range). **Paginated table** with all raw samples (50/page). Row-level delete with correlated-samples confirmation.
- **Sonno** — sleep analysis, stacked bar chart per night
- **Workout** — main page with **left sidebar filters** (year, activity chips, source, datetime range, distance km, duration min, **pace dual-range slider + preset chips**, title search, notes search), summary stats, workouts-per-period chart with **click-to-drilldown** zoom (year → month → week → day → workout), **sortable list** (title, pace, notes columns included), row delete with 8s undo. Third-party workout titles (e.g., Intervals Pro "Corsa Livello 2") are auto-promoted from metadata into a dedicated column. Filters **persisted in sessionStorage** so they survive navigation. Main layout uses a **hamburger menu** top-bar that opens the nav drawer.
- **Workout detail** (`/workouts/:uuid`) — Apple Fitness-style: metrics (duration, distance, calories, pace, HR), "Informazioni aggiuntive" card (indoor/outdoor, swim location, lap length, elevation, METs, weather, brand), **per-km splits** table, **Intervalli** card with per-lap distance/pace/HR/kcal (Intervals Pro, Apple Watch strutturati, Strava, HealthFit, ecc.), time-series charts (HR, running speed, power, cadence — il tooltip della velocita' mostra entrambe le unita' km/h e min/km), **editable title and notes** cards. **Mappa percorso GPS** con Leaflet + OpenStreetMap (no API key): polyline colorata per pace (verde→giallo→rosso), marker partenza/arrivo, **tooltip al hover** col tempo, velocita' (km/h + min/km) e battito cardiaco del segmento, profilo altimetrico Recharts sotto la mappa con cursore sincronizzato. Backfill automatico delle route storiche al sync (max 500/sync per non bloccare).
- **Record** (`/records`) — Personal records per la corsa con sidebar filtri indipendenti (anno / sorgente / outdoor-indoor). Per ogni variante: distanza, durata, pace medio e kcal max; miglior tempo a 5K/10K/mezza/maratona; miglior singolo km ricostruito dai sample di distanza.
- **Nutrizione** — in cima, integrazione col servizio esterno `diario-alimentare` (piano attivo, consumato oggi vs target con progress bar, trend filtrabile con sidebar propria). Sotto, dati HealthKit (calorie/macros/acqua/caffeina). Pulsante **"Sincronizza con Apple Salute"** che accoda i totali giornalieri del diario (kcal + 3 macro) sulla write/delete queue esistente: al prossimo Sync Now sull'iPhone finiscono in Apple Salute, con delete+recreate idempotente quando il totale di un giorno cambia (tracking in `diario_hk_sync`).
- **Stretching** — visualizzazione read-only delle sessioni registrate dall'app PWA `alexpani/stretching`. Selettore periodo, card (sessioni, tempo totale, streak corrente, streak max), barchart minuti/giorno e tabella sessioni. I dati vivono nella PWA; la dashboard li proxya via `/api/v1/stretching/*`. Niente sync HealthKit (per ora).
- **Fitness** — VO2 max, running/cycling/walking advanced metrics, stair speeds
- **Esplora** — universal browser: pick any data type + filter bar + chart + raw table
- **Inserisci** — form to queue body/nutrition writes back to Apple Health
- **Impostazioni** — ingest rules CRUD (add, edit min/max, toggle active, reset stats), blacklist UUID list with remove

**Filters (generic, TypeBrowser pages)**: precise date range + multiple sources + multiple devices + value min/max, with DB-range hints.

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
