# CLAUDE.md

## Documentation Policy (read first)

Whenever you introduce **substantial** changes to this project, **update both `CLAUDE.md` and `README.md` in the same change** before committing. Substantial = anything that alters:

- Architecture, infrastructure, or deployment (new services, DBs, ports)
- Data model (new tables/columns, trigger, migration)
- Public-facing API endpoints (add/remove/change)
- iOS app public behavior (new permissions, sync triggers, tabs, user-visible features)
- Dashboard pages/routes
- Configurable rules/policies relevant to users

Minor refactors, bug fixes, and internal renames do **not** require doc updates.

Keep the files concise: prefer lists over prose, document the *what* and *why*, not line-by-line details. Always commit docs + code in the same commit.

---

## Project Overview

**Health Tracker Bridge** — self-hosted stack that bridges Apple Health and web applications.

HealthKit is only accessible from native iOS apps. This system syncs all health data to a backend database and exposes REST APIs for web apps to consume and write back. It also supports bulk imports (e.g., Endomondo), data cleaning via rules and UUID blacklist, workout detail views (Apple Fitness-style), and configurable filters.

### Components

- **iOS App** (`ios/HealthTracker/`): SwiftUI + HealthKit + SwiftData, reads/writes/deletes Apple Health data, syncs to backend
- **Backend** (`backend/`): FastAPI + async SQLAlchemy + PostgreSQL 16 + Alembic, deployed via Docker on Proxmox LXC
- **Dashboard** (`dashboard/`): React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Recharts + TanStack Query, deployed via Nginx on Proxmox LXC. Layout has a **hamburger top-bar** that opens a nav drawer (Sidebar nav items listed in `src/components/layout/Sidebar.tsx`); main content **boxed**: card centrata con `max-w-[1680px] mx-auto`, `bg-background`, `rounded-lg`, `shadow-sm` su sfondo esterno `bg-slate-100` (dark: `bg-slate-900`) — non si stiracchia su monitor ultra-wide.

### Infrastructure

| Component | Host | IP | Port |
|-----------|------|-----|------|
| Backend API + PostgreSQL | LXC `ealth-tracker` (Proxmox) | 192.168.68.166 | 8000 |
| Dashboard | LXC `ealth-dashboard` (Proxmox) | 192.168.68.190 | 80 |
| iOS App | iPhone (physical device) | — | — |

Deployment workflow: `scp` files from Mac to LXC, then `docker compose up -d --build`. SSH key `~/.ssh/id_ed25519` authorized on both LXCs for `root`.

### Repo

- GitHub: **https://github.com/alexpani/health-tracker** (public)
- Main branch: `main`
- Commit policy: always create new commits; never amend or force-push. Co-author line for Claude:
  `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`

---

## Key Technical Decisions

- **Single `health_samples` table** with `type` discriminator (avoids 80+ per-type tables). Indexes: `(type, start_date)`, `start_date`, `uuid UNIQUE`.
- **UUID-based dedup**: `INSERT ... ON CONFLICT (uuid) DO NOTHING` — crash-safe, idempotent sync.
- **Incremental sync**: `lastSyncDate` per type stored in SwiftData on the iPhone.
- **90-day fetch windows**: HealthKit queries chunked to avoid OOM (HeartRate has millions of samples).
- **Parallel POST**: 4 concurrent HTTP uploads per window for throughput.
- **Real-time sync**: `HKObserverQuery` + background delivery triggers auto-sync on new HealthKit data. Auto-sync also on app launch and foreground (10-min throttle).
- **Anchored queries for retroactive writes**: workouts and all 6 body-metric quantity types use `HKAnchoredObjectQuery` with per-type anchors in UserDefaults. This correctly handles samples written to HealthKit *after* their `startDate` (common for Withings, manual entries, CSV imports): the anchor tracks HealthKit insertion order (`HKObjectID`), not the sample's `startDate`, so late-arriving samples are never lost.
- **Server-side ingest filters**: DB-configurable `IngestRule` rows (value_range, blocked_source) with hit counters, plus a `IngestBlacklist` table keyed by HKSample UUID.
- **Auto-blacklist on delete**: PostgreSQL triggers `trg_blacklist_on_delete` (on `health_samples`) and `trg_blacklist_on_workout_delete` (on `workouts`) automatically insert the deleted UUIDs into `ingest_blacklist`. Both the samples batch and the workouts batch ingestion check this blacklist before inserting, preventing re-ingestion after re-sync.
- **Bidirectional writes/deletes**: web apps POST to `/api/v1/write` and `/api/v1/delete/plan`; iOS polls these queues and calls `HKHealthStore.save()` / `.delete(_)`.
- **Persistent sync summary**: last sync's log + timing + sample count persisted in iOS `UserDefaults` (`last_sync_summary_v1`).
- **Effective workout type**: backend derives a canonical slug (e.g., `treadmill_run`, `swim_pool`) from `activity_type` + metadata (`HKIndoorWorkout`, `HKSwimmingLocationType`). Used for filtering and labeling.

---

## Backend (`backend/`)

### Setup

```bash
cd backend
docker compose up -d
docker compose exec api alembic upgrade head
```

Alembic revision migrations folder is mounted as a volume so migrations persist across image rebuilds.

### Models (`app/models.py`)

- `HealthSample` — quantity samples (steps, heart rate, weight, ...). Columns: id, uuid (unique), type, value, unit, start_date, end_date, source_name, source_bundle_id, device, metadata JSONB.
- `CategorySample` — category samples (sleep, stand hour, etc.). Similar shape with integer value (enum).
- `Workout` — workouts (activity_type, duration seconds, total_distance meters, total_energy_burned kcal, start/end, source, metadata JSONB, **user-editable `title` + `notes`** columns, **`activities` JSONB** with per-interval lap/segment data). `title` is auto-populated at ingest from `metadata["workout name"]` when present. `activities` is a normalized array of interval entries (`kind`, `n`, `start/end`, `duration_s`, `distance_m`, `avg_hr`, `max_hr`, `kcal`, `pace_s_per_km`) extracted from `HKWorkoutActivity` (iOS 17+) and `HKWorkoutEvent` (lap/segment markers) by the iOS app. App-agnostic: works with Intervals Pro, Apple Workout structured, Strava, HealthFit, Peloton, Runkeeper and any source that writes standard HealthKit interval data.
- `PendingWrite` — web → HealthKit write queue (type, value, unit, start/end, status: pending/written/failed, hk_uuid after confirm).
- `PendingDeletion` — web → HealthKit delete queue (hk_uuid, type, source_sample_id, status).
- `IngestRule` — configurable filters (rule_type: `value_range` or `blocked_source`; optional type_identifier/source_name; value_min/max; active bool; hits_count, last_hit_at).
- `IngestBlacklist` — UUIDs never to insert; auto-populated by trigger on DELETE from `health_samples`.
- `SyncLog` — per-batch sync audit entries (device_id, sample_count, synced_at).
- `DiarioHkSync` — mapping `(date, dietary_type) → hk_uuid + value + pending_write_id`. Tracks which daily diario totals have been mirrored to Apple Salute so the reconciler can detect changes (delete old HK sample + write new one) while skipping unchanged days.
- `Regimen` — periodi di farmaci/integratori/piani alimentari/allenamento/equipaggiamento. Colonne: `kind` (`medication`|`supplement`|`diet`|`training`|`gear`), `name`, `start_date` (nullable = "iniziato prima del tracking"), `end_date` (nullable = "in corso"), `dose` (free-text — per `gear` usato come "size 43" o simili), `notes`, `source` (`manual`|`lab_backfill`), `metadata` JSONB (per `kind='diet'`: `{kcal_target?, protein_pct?, fat_pct?, carbs_pct?}`). UNIQUE index parziale `(kind, name, end_date) WHERE source='lab_backfill'` per rendere idempotente il re-run dello script di backfill dai panel lab confermati. Letta dalla pagina dashboard `/day/:date` (regimi attivi quel giorno) e `/regimens` (gestione lista + timeline Gantt). Niente HK / iOS — feature solo dashboard. Per `kind='diet'` (piano alimentare): il backend non fa niente, il frontend lo usa per sovvrascrivere il piano del diario durante il giorno. Per `kind='gear'` (es. scarpe da corsa): la dashboard calcola i km cumulativi sommando `total_distance` dei workout running (`effective_type IN [type_37, treadmill_run]`) nel periodo `[start_date, end_date or today]` — assume un solo paio attivo per volta (no associazione esplicita workout↔gear).
- `HealthNote` — note quotidiane di salute (dolori, malattie, fastidi, sintomi). Colonne: `category` (`pain`|`illness`|`discomfort`|`symptom`|`other`), `body_zone` (testo libero, suggerimenti predefiniti), `text`, `start_date` NOT NULL, `end_date` NOT NULL (default = start_date per nota di un solo giorno). Periodo chiuso obbligatorio (no "in corso"). Letta dalla pagina `/day/:date` (note attive quel giorno) e dalla pagina dedicata `/health-notes` con casella di ricerca testuale + filtri (categoria, zona, periodo). Niente HK / iOS — feature solo dashboard.
- `WorkoutRoute` — GPS route per workout outdoor. PK = `workout_uuid` (FK `workouts.uuid` ON DELETE CASCADE = una sola route per workout, eliminata col workout). `points` JSONB con array di `{lat, lon, ts, alt?, h_acc?, v_acc?, speed?, course?}` letti da `HKWorkoutRoute` via `HKWorkoutRouteQuery` lato iOS. `point_count` denormalizzato per query veloci. Una row con `points: []` = "checked, no GPS data" (workout indoor / sorgente esterna senza tracciato): l'iOS la scrive comunque per evitare di ri-controllare lo stesso workout a ogni sync. Idempotente UPSERT su workout_uuid.
- `DailyStat` — totali giornalieri pre-calcolati da `HKStatisticsCollectionQuery` lato iOS per i 9 tipi cumulative attivita' (Steps, Distance{WalkingRunning,Cycling,Swimming}, FlightsClimbed, {Active,Basal}EnergyBurned, Apple{Exercise,Stand,Move}Time). HealthKit applica internamente il dedup proprietario tra Watch e iPhone, quindi `value` combacia con i numeri dei widget di Apple Salute. UNIQUE su `(type, date, COALESCE(source, '_all_'))`. V1 scrive solo `source=NULL` (= totale aggregato cross-source). Tabella **additiva**: i sample raw restano in `health_samples` per workout splits, "Esplora", correlazione body, ecc. — la dashboard legge da qui solo per il chart Activity aggregato giornaliero.

### Alembic Migrations

Ordered history (most recent last):
1. initial (health_samples, category_samples, workouts, sync_log)
2. pending_writes
3. pending_deletions
4. ingest_blacklist
5. **auto_blacklist_trigger** (`alembic/versions/87f97b75eed7_auto_blacklist_trigger.py`) — creates `fn_blacklist_on_delete()` function + `trg_blacklist_on_delete` trigger on `health_samples`.
6. ingest_rules
7. workout_notes (adds `workouts.notes` TEXT)
8. workout_title (adds `workouts.title` String 200)
9. workout_blacklist_trigger (`alembic/versions/a1b2c3d4e5f6_workout_blacklist_trigger.py`) — creates `fn_blacklist_on_workout_delete()` function + `trg_blacklist_on_workout_delete` trigger on `workouts`.
10. workout_activities (`alembic/versions/871fe89fe31f_workout_activities.py`) — adds `workouts.activities` JSONB for per-interval lap/segment data extracted from `HKWorkoutActivity`/`HKWorkoutEvent`.
11. diario_hk_sync (`alembic/versions/6677af61441c_diario_hk_sync.py`) — adds `diario_hk_sync` table mapping `(date, dietary_type)` to the HK sample UUID written via the pending-write queue, for idempotent diario→Apple Salute reconciliation.
12. daily_stats (`alembic/versions/3af6d8e91a02_daily_stats.py`) — adds `daily_stats` table for HK pre-aggregated daily totals (HKStatisticsCollectionQuery). UNIQUE su `(type, date, COALESCE(source, '_all_'))`.
13. regimens (`alembic/versions/4be0fa72c1d3_regimens.py`) — adds `regimens` table per farmaci/integratori/dieta/allenamento con start/end date opzionali. UNIQUE parziale `(kind, name, end_date) WHERE source='lab_backfill'` per backfill idempotente.
14. workout_routes (`alembic/versions/5cd91e7a6b03_workout_routes.py`) — adds `workout_routes` table (PK = workout_uuid FK ON DELETE CASCADE, JSONB `points`) per GPS route ingest da `HKWorkoutRoute`.
15. regimen_nutrition_metadata (`alembic/versions/06g2i9h7k5l8_regimen_nutrition_metadata.py`) — adds `metadata` JSONB column to `regimens` for diet-kind plans: `{kcal_target?, protein_pct?, fat_pct?, carbs_pct?}`.
16. health_notes (`alembic/versions/17h3j0i8l6m9_health_notes.py`) — adds `health_notes` table per note quotidiane di salute (dolori/malattie/fastidi/sintomi). Periodo chiuso (start_date e end_date entrambi NOT NULL).

### Routers

- `ingest.py` — POST batch endpoints (samples, categories, workouts). Applies:
  1. UUID blacklist filter
  2. DB-configured IngestRule (`_apply_rules`) with hit recording (entrambi i lati `source_name` passano per `_normalize_source`)
  3. `INSERT ... ON CONFLICT (uuid) DO NOTHING`
  4. `source_name` normalizzato in scrittura via `_normalize_source` (strip NBSP/narrow NBSP/ideographic space/line+paragraph separator + drop zero-width space + collapse runs). Apple Watch riporta "Apple Watch 7" che altrimenti rompe filtri exact-match e ILIKE.
- `query.py` — all GET endpoints + some POST/PATCH/DELETE for samples and workouts.
- `write.py` — `/api/v1/write` queue endpoints (POST, GET /pending, POST /{id}/confirm|fail, GET /recent, GET /allowed-types).
- `delete.py` — `/api/v1/delete/*` workflow for bulk deletion via iOS.
- `rules.py` — `/api/v1/rules` CRUD + summary + reset-stats.
- `blacklist.py` — `/api/v1/blacklist` list/add/remove + `purge-and-blacklist` (atomic delete + blacklist).
- `diario.py` — read-only proxy to `diario-alimentare` + `/sync-to-hk` reconciler (see Diario section below).
- `stretching.py` — read-only proxy to `alexpani/stretching` (`/sessions`, `/sessions/{id}`, `/routines`, `/exercises`). No writes, no HK sync.
- `daily_stats.py` — `POST /api/v1/daily-stats/batch` (upsert su `(type, date, COALESCE(source, '_all_'))`) + `GET /api/v1/daily-stats?type=&start=&end=&source=` (default `source IS NULL`). Alimentato dalla pipeline iOS `HKStatisticsCollectionQuery → /daily-stats/batch`.
- `regimens.py` — CRUD `POST/GET/PATCH/DELETE /api/v1/regimens` per farmaci/integratori/dieta/allenamento/gear. Validazione lato router: `ALLOWED_KINDS = {medication, supplement, diet, training, gear}`. Filtri: `kind`, `active_on=YYYY-MM-DD` (regimi attivi in quel giorno: `(start IS NULL OR start <= D) AND (end IS NULL OR end >= D)`), `include_ended`, `source`.
- `health_notes.py` — CRUD `POST/GET/PATCH/DELETE /api/v1/health-notes` per note quotidiane di salute. Validazione lato router: `ALLOWED_CATEGORIES = {pain, illness, discomfort, symptom, other}`. Filtri: `category`, `body_zone` (ILIKE), `text_contains` (ILIKE), `start`/`end` (range che si sovrappone), `active_on=YYYY-MM-DD`, `limit`, `offset`. Endpoint extra: `GET /days?start=&end=` ritorna lista date ISO coperte da almeno una nota nel range (per pallini mini-calendario, espansione server-side dei periodi); `GET /zones` ritorna le zone corporee distinte usate (per chip filtri).
- `day.py` — endpoint aggregato `GET /api/v1/day/{YYYY-MM-DD}` che ritorna in un singolo JSON: `activity` (da `daily_stats`, 9 tipi cumulative), `body` (latest sample per tipo <= EOD del giorno), `vitals` (AVG/MIN/MAX su HR + AVG sugli altri tipi vitali), `nutrition` (diario alimentare proxy + HK dietary fallback), `sleep` (CategorySample sleepAnalysis chiusi nel giorno con breakdown stages), `workouts` (start_date nel giorno), `lab_panels` (test_date == giorno con result count e out_of_range count), `regimens_active`. Tutte le query in parallelo via `asyncio.gather`. Riusa solo modelli/tabelle esistenti — niente nuova logica di calcolo.

### Main API Endpoints

**Ingest**
- `POST /api/v1/samples/batch` — ingest quantity samples (filtered by rules + blacklist)
- `POST /api/v1/categories/batch`, `POST /api/v1/workouts/batch` (workouts accept `notes` + `activities`). Workouts use `ON CONFLICT DO UPDATE` on `activities` only, so re-syncing an existing workout backfills intervals without overwriting user-edited `title`/`notes`.

**Query samples**
- `GET /api/v1/samples?type=&start=&end=&aggregation=none|hourly|daily|weekly|monthly&sources=&devices=&value_min=&value_max=&limit=&offset=`
- `GET /api/v1/samples/types` — distinct types with counts
- `GET /api/v1/samples/latest?type=`
- `GET /api/v1/samples/facets?type=` — distinct sources/devices + value range + **per-year counts** for filter UI (all unfiltered by time, so sidebar chips span the full historical range)
- `GET /api/v1/samples/{id}/correlated?types=&minutes=5` — samples within ±N minutes (for body page tooltip + related-deletion preview)
- `POST /api/v1/samples/bulk-delete` body `{ids:[...]}` — the DELETE trigger auto-blacklists UUIDs
- `POST /api/v1/samples/bulk-delete-by-uuids` body `{uuids:[...]}` — UUID-based bulk delete (used by iOS anchored quantity sync to propagate HealthKit deletions for body-metric types)

**Workouts** (heavy metadata-aware filtering)
- `GET /api/v1/workouts` query params:
  - `activity_type[]`, `effective_types[]` (slugs), `sources[]`, `years[]`
  - `start`, `end`, `distance_min/max` (meters), `duration_min/max` (seconds), `pace_min/max` (sec/km)
  - `notes_contains`, `title_contains` (ILIKE %x%)
  - `limit` (max 10000), `offset`
- `GET /api/v1/workouts/facets` — for filter sidebar: `effective_types` with counts, `sources`, `years` with counts, `distance_min/max`, `duration_min/max`
- `GET /api/v1/workouts/records?years[]=&sources[]=&indoor=` — Personal records for RUNNING only (`activity_type=37`), with optional filters. Returns per-effective-type: `overall` (longest_distance/duration, fastest_pace, most_calories), `at_distance` (best time at ~5K/10K/21K/42K with +10% tolerance), `best_single_km` (fastest 1-km split reconstructed from DistanceWalkingRunning samples, top-5 candidates by average pace, paces < 3:00/km rejected as GPS artifacts). Completely decoupled from `/workouts` filters.
- `GET /api/v1/workouts/records/facets` — year counts, source counts, indoor/outdoor counts for the running-only Records page sidebar.
- `GET /api/v1/workouts/by-uuid/{uuid}` — single workout detail (includes notes + metadata)
- `GET /api/v1/workouts/by-uuid/{uuid}/splits?distance_km=1.0` — per-km splits with duration, pace, avg HR
- `DELETE /api/v1/workouts/by-uuid/{uuid}` — returns full snapshot for undo
- `POST /api/v1/workouts/bulk-delete` body `{uuids:[...]}` — bulk delete (used by iOS anchored sync to propagate HealthKit deletions; PG trigger auto-blacklists UUIDs)
- `PATCH /api/v1/workouts/by-uuid/{uuid}` body `{title?:"...", notes?:"..."}` — update editable fields (title, notes). Empty string clears.
- `GET /api/v1/workouts/by-uuid/{uuid}/route` — return GPS route `{points:[…], point_count}`. 404 se non ancora ingestito; ritorna `{points: []}` se l'app iOS ha verificato che il workout non ha dati GPS (indoor / sorgente esterna).
- `POST /api/v1/workouts/by-uuid/{uuid}/route` body `{points:[{lat,lon,ts,alt?,h_acc?,v_acc?,speed?,course?}, …]}` — ingest GPS route (idempotent UPSERT). Chiamato dall'app iOS sia per i workout appena sincronizzati (priority pass) sia dal backfill loop. Posting con `points: []` marca il workout come "checked, no GPS" così non viene ri-controllato.
- `GET /api/v1/workouts/missing-routes?limit=N&before=<iso>` — lista UUID di workout senza entry in `workout_routes`, most-recent first. Cursor `before` per paginazione. Usato dal backfill loop iOS per crawlare i workout storici.

**Effective type slugs** (see `_apply_effective_type_filter`):
- `treadmill_run`  — activity_type=37 & HKIndoorWorkout=1
- `treadmill_walk` — activity_type=52 & HKIndoorWorkout=1
- `cyclette`       — activity_type=13 & HKIndoorWorkout=1
- `swim_pool`      — activity_type=46 & HKSwimmingLocationType=1
- `swim_open_water`— activity_type=46 & HKSwimmingLocationType=2
- `type_XXX`       — plain activity_type=XXX with NO matching variant

**Sync status**
- `GET /api/v1/sync/status[?include_types=true]` — fast totals (pg_class.reltuples); full breakdown with `include_types`
- `GET /api/v1/sync/sessions?limit=10` — groups sync_log entries with <5 min gap into sessions (for the Home page table)
- `POST /api/v1/sync/heartbeat` body `{device_id, sample_count?}` — logs a sync attempt that produced no new data. The iOS app calls this at the end of `runFullSync` when `totalSamplesSynced == 0` (no samples/categories/workouts to upload), so the dashboard's sync sessions table mirrors the local app log instead of skipping empty syncs.

**Write / Delete queues (web ↔ Apple Health)**
- `POST /api/v1/write`, `GET /api/v1/write/pending`, `POST /api/v1/write/{id}/confirm|fail`
- `GET /api/v1/write/recent` — dashboard feedback on write status
- `GET /api/v1/write/allowed-types` — whitelist of write-allowed HK identifiers
- `POST /api/v1/delete/plan`, `GET /api/v1/delete/pending`, `POST /api/v1/delete/{id}/confirm|fail`, `GET /api/v1/delete/status`
- `POST /api/v1/delete/retry-failed?error_contains=...` — resetta `failed` PendingDeletion → `pending` per ritentarli al prossimo sync. Filtro opzionale `error_contains` (substring ILIKE su `error_message`); senza filtro resetta tutto. Nato per ripulire i "false fail" causati da `Protected health data is inaccessible` (HK code 8 = telefono lockato durante sync), che il vecchio iOS marcava `failed` invece di lasciarli `pending` per retry.

**Rules** (dashboard Settings page)
- `GET|POST /api/v1/rules` — list / create
- `PATCH|DELETE /api/v1/rules/{id}` — edit range, toggle active, delete
- `POST /api/v1/rules/{id}/reset-stats`
- `GET /api/v1/rules/summary` — active/total rules, blacklist size, total/recent hits

**Blacklist** (dashboard Settings page)
- `GET /api/v1/blacklist` — paginated list
- `POST /api/v1/blacklist/add` body `{entries:[{hk_uuid,reason}]}`
- `POST /api/v1/blacklist/purge-and-blacklist` — delete matching samples AND blacklist their UUIDs
- `DELETE /api/v1/blacklist/{id}`

**Diario Alimentare proxy** (read-only, forwards to `alexpani/diario-alimentare`)
- Base URL of the upstream diario configured via env `DIARIO_BASE_URL` (default `http://192.168.68.173:3000`)
- `GET /api/v1/diario/active-plan` → proxies `GET /api/external/active-plan`. Returns the active nutrition plan (`name, kcal_target, protein_pct/g, fat_pct/g, carbs_pct/g, updated_at`). 404 `no_active_plan` bubbles through; 502 on network error.
- `GET /api/v1/diario/daily-totals?from=YYYY-MM-DD&to=YYYY-MM-DD` → proxies the equivalent upstream endpoint. Returns `[{date, kcal, protein_g, fat_g, carbs_g, kcal_target}]`, one entry per day that has at least one diary record. `kcal_target` is the snapshot of the plan in effect that day.
- `POST /api/v1/diario/sync-to-hk[?from=&to=]` — idempotent reconciler that pushes the diario daily totals into Apple Health via the existing `PendingWrite`/`PendingDeletion` queues. For every (day, dietary type) pair whose diario value differs from what's tracked in the `diario_hk_sync` table, enqueues a delete of the old HK sample (if any) and a write of the new one. The iOS app processes these through `processPendingWrites`/`processPendingDeletions` at the next Sync Now. Returns `{queued_writes, queued_deletions, unchanged, days_considered}`. No cron on the backend — sync travels on the same loop as body-metric writes. Confirming a `PendingWrite` also backfills `diario_hk_sync.hk_uuid` so the next reconcile can delete it if the day's total changes.

**Stretching proxy** (read-only, forwards to `alexpani/stretching`)
- Base URL of the upstream stretching service configured via env `STRETCHING_BASE_URL` (default `http://192.168.68.150:3100`)
- `GET /api/v1/stretching/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD` → proxies `GET /api/external/sessions`. Returns `[{id, routine_id, routine_name, started_at, ended_at, duration_sec, items_total, items_skipped, notes, workout_activity_type:"flexibility"}]`.
- `GET /api/v1/stretching/sessions/{id}` → single session detail.
- `GET /api/v1/stretching/routines` → list of available routines.
- `GET /api/v1/stretching/exercises` → list of exercises.
- No writes, no HealthKit sync (for now). The dashboard just visualizes what the stretching PWA records; cancellations are done in the PWA itself.

### Ingest Rules semantics

Applied in this order:
1. **IngestBlacklist**: drop sample if its UUID is already blacklisted.
2. **IngestRule** (active only):
   - `value_range`: discard if value outside [value_min, value_max] for matching `type_identifier`
   - `blocked_source`: discard if `source_name` matches (optional `type_identifier` to scope)

Each rule hit increments `hits_count` and updates `last_hit_at`.

Current seed rules (applied once, can be edited from dashboard):
- value_range BodyMass 70–200 kg
- value_range BodyMassIndex 18–50
- value_range BodyFatPercentage 0.01–0.60
- value_range LeanBodyMass 45–150 kg
- blocked_source "Renpho"

---

## iOS App (`ios/HealthTracker/`)

### Requirements

- Xcode 16+, iOS 17+, **physical iPhone** (HealthKit has no simulator support)
- Entitlements: `com.apple.developer.healthkit`, `com.apple.developer.healthkit.background-delivery`
- `Info.plist`: `NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`, `BGTaskSchedulerPermittedIdentifiers=["com.healthtracker.sync"]`
- Bundle identifier (personal team): `com.alexpani.healthtracker.app`
- Personal teams cannot use `healthkit.access` (Clinical Health Records) — entitlements file intentionally omits it.

### Key Files

- `Services/HealthKitManager.swift` — actor with:
  - `quantityTypes` static list (40+ read types including fitness-advanced: VO2 max, running power/speed/stride/GCT/vert osc, cycling power/cadence/speed/FTP, walking/stair speeds)
  - `categoryTypes` (sleep, stand hour, mindful, heart rate events)
  - `writableQuantityTypes` (body + nutrition subset)
  - `requestAuthorization` (read + write)
  - `fetchQuantitySamples/fetchCategorySamples/fetchWorkouts` with `since`/`until` for windowed fetching
  - `writeQuantitySample`, `deleteSample` (only for samples this app created — HealthKit limitation)
  - `startObservingNewSamples` — registers `HKObserverQuery` + `enableBackgroundDelivery(.hourly)` for all read types
- `Services/SyncService.swift` — `@Observable` class orchestrating full sync:
  1. `processPendingWrites` (GET pending writes → save to HK → confirm)
  2. `processPendingDeletions` (GET pending deletions → HK delete → confirm)
  3. **Daily statistics** (`syncDailyStats`) — per i 9 tipi cumulative attivita' (Steps, Distance{WalkingRunning,Cycling,Swimming}, FlightsClimbed, {Active,Basal}EnergyBurned, Apple{Exercise,Stand,Move}Time) chiama `HKStatisticsCollectionQuery` con bucket giornalieri e fa upsert in `daily_stats` via `POST /api/v1/daily-stats/batch`. Anchor per-type: UserDefaults `lastDailyStatsAt_<typeIdentifier>`, range = `[lastAt - 3 giorni, oggi]` (re-pull ultimi 3 giorni perche' il Watch puo' aggiornarli retroattivamente); primo sync = `[2014-01-01, oggi]`. Filtra `value > 0`. Idempotente. **CRITICO**: la query passa `quantitySamplePredicate = nil` (NIENTE `.strictStartDate`) — l'anchor + intervalComponents bastano per il bucketing giornaliero, e qualsiasi predicate temporale taglia sample che attraversano la mezzanotte producendo numeri diversi da Apple Salute. Cosi' i numeri combaciano esattamente con i widget di Apple Salute (HK applica internamente il dedup Watch+iPhone).
  4. Quantity types — looped with 90-day windows (`fetchWindowDays=90`), parallel POST (`syncConcurrency=4`), batch size 1000
  4. Category types (same loop)
  5. Workouts — uses `HKAnchoredObjectQuery` persisted in UserDefaults (`hk_workout_anchor_v1`). Detects HealthKit deletions and propagates them to the backend via `POST /workouts/bulk-delete`. Replaces the previous windowed `HKSampleQuery`-based approach for workouts.
  6. **Body-metric quantity types** (BodyMass, BodyMassIndex, BodyFatPercentage, LeanBodyMass, Height, WaistCircumference) also use `HKAnchoredObjectQuery` with per-type anchor in UserDefaults (`hk_quantity_anchor_v1_<typeIdentifier>`). This catches samples written **retroactively** into HealthKit by sources like Withings (startDate in the past, creationDate later) — the windowed path with `.strictStartDate` predicate would silently miss them once `lastSyncDate` advanced past the sample's startDate. Deletions from Apple Health are propagated via `POST /samples/bulk-delete-by-uuids`.
  - **BG-locked-device guard** (`isAppInBackground()`): on iOS, when the app runs in the background while the device is locked, HKAnchoredObjectQuery / HKSampleQuery silently return 0 samples for protected types (StepCount, HeartRate, AEE, BEE, ...) WITHOUT throwing an error. The naive code path advanced anchors / `lastSyncDate` to "now" anyway, which made the next sync (in foreground or with unlocked BG) start from an anchor past the real samples — silently losing them forever. Fix: when `UIApplication.shared.applicationState != .active` (background or inactive) AND the fetch returned 0 samples / 0 deletions, do NOT persist the new anchor and do NOT advance `lastSyncDate`. The retry on the next sync (or once the device unlocks) will see those samples. In foreground 0 samples truly means "nothing new" and the bookmark advances normally.
  6. Deferred types (empty set by default; was used to defer HeartRate/HRV)
  - `performQuickSync(minInterval:120)` — throttled for auto-triggers
  - `resetBodySync()` — clears lastSyncDate for body types (was a Settings button, removed; can be reintroduced)
  - Persists last summary via UserDefaults `last_sync_summary_v1` with `LastSyncSummary` Codable struct
  - `shouldStop` flag for the stop button
  - **Empty-sync heartbeat**: at the end of `runFullSync`, if `totalSamplesSynced == 0` (no new samples/categories/workouts to upload), calls `POST /api/v1/sync/heartbeat`. Without this the backend's `sync_log` would only record syncs that produced data, and the dashboard's sync sessions table would silently miss the empty syncs that the iOS UI shows.
  - **Workout GPS route ingest**: dopo `syncWorkouts()`, per ogni workout appena sincronizzato chiama `uploadRoute(forWorkoutUUID:)` (priority pass). Subito dopo lancia `syncWorkoutRoutesBackfill()` che chiede al backend i workout storici senza route (`GET /workouts/missing-routes`) e li processa fino a `maxBackfillPerSync = 500` per sync (cap per non bloccare; abbassabile una volta che lo storico iniziale e' assorbito). Per ogni workout: `HealthKitManager.fetchWorkoutRoute(workoutUUID:)` → `HKSampleQuery` su `HKSeriesType.workoutRoute()` con predicate sul workout → drena `HKWorkoutRouteQuery` (deliver i `CLLocation` in batch) → POST a `/route`. Anche workout senza GPS vengono POSTed con `points: []` per non essere ri-controllati. Errori swallowed: una route fallita non rompe il sync.
  - **Source name normalization**: `HealthKitManager.normalizedSourceName(_:)` strippa NBSP (U+00A0), narrow NBSP, ideographic space, line/paragraph separator e zero-width space dai `sourceRevision.source.name` di tutti i payload (samples, categories, workouts, anchored variants). Apple Watch riporta il proprio nome come "Apple\u{00A0}Watch\u{00A0}7" — senza normalizzazione i filtri exact-match e le `blocked_source` rules nel backend non funzionano. Stessa logica applicata anche backend-side in `_normalize_source` di `ingest.py` come safety net.
- `Services/APIClient.swift` — URLSession actor with retry/backoff, endpoints for samples/categories/workouts POST + pending writes + pending deletions + confirm/fail
- `Services/BackgroundTaskManager.swift` — `BGAppRefreshTask` registration + 1h scheduling. `handleSync` schedula SUBITO il prossimo run (prima del sync) cosi' la rotazione non si interrompe in caso di crash; e ha un `expirationHandler` che cancella il `Task` corrente e chiama `setTaskCompleted(success: false)`. Senza chiamare `setTaskCompleted` su expiration iOS marca il run come "hung" e penalizza la frequenza dei BG launch futuri (fino a smettere). `OSAllocatedUnfairLock` garantisce che `setTaskCompleted` sia chiamato esattamente una volta tra il path di completamento normale e quello di scadenza.
- `Views/ContentView.swift` — TabView order: **Sync (default), Dashboard, Settings**
- `Views/SyncStatusView.swift` — connection status, running sync progress (general + per-type with date reached), stop button, **persistent last-sync summary** (start time, duration, samples, log, interrupted badge)
- `Views/DashboardView.swift` — 5 card metrics from HealthKit direct: weight, today steps, today active calories, body fat %, BMI (all with relative timestamp subtitle)
- `Views/SettingsView.swift` — server URL + device ID + API docs link
- `HealthTrackerApp.swift` — app entry: registers BG task, requests HK auth at launch, wires `SyncService` with ModelContainer, starts HKObserverQuery, schedules auto-sync on launch + scenePhase=active (throttled 10 min)

### Auto-sync Triggers

- App launch (throttle 10 min)
- App returns to foreground (throttle 10 min)
- `HKObserverQuery` callback on new HealthKit data (throttle 2 min via `performQuickSync`)
- `BGAppRefreshTask` (iOS decides, typically hourly)

### App Icon

- Generated with Python + Pillow: gradient blue→pink background + white heart + pink ECG line
- `Assets.xcassets/AppIcon.appiconset/icon-1024.png` (1024×1024)
- xcodegen `project.yml` sets `ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon`

### Build

1. Open `ios/HealthTracker/HealthTracker.xcodeproj`
2. Signing: set team + unique bundle ID
3. Connect iPhone, ⌘+R

---

## Dashboard (`dashboard/`)

### Setup

```bash
cd dashboard
npm install
VITE_API_URL=http://192.168.68.166:8000 npm run dev
# Prod:
docker compose up -d --build   # → http://192.168.68.190
```

### Key Files

- `src/lib/api.ts` — `apiGet` / `apiPost` / `apiPatch` / `apiDelete`, with array query-param support
- `src/lib/queries.ts` — TanStack Query hooks: samples, facets, correlated, bulk-delete, writes, rules, blacklist, workouts, workout detail, splits, **route** (`useWorkoutRoute` — silently mappa 404 su `null` così la UI può mostrare il placeholder "in attesa di sync"), delete/update/restore workout, sync sessions/status, write allowed types, diario (`useDiarioActivePlan`/`useDiarioDailyTotals`/`useDiarioSyncToHK`), stretching (`useStretchingSessions`/`useStretchingRoutines`). **Polling**: tutte le 14 query dipendenti dai dati sincronizzati dall'app iOS (`useSamples`, `useLatest`, `useLatestWeightBefore`, `useSampleFacets`, `useCategories`, `useTypes`, `useDailyStats`, `useDaySnapshot`, `useWorkouts`, `useWorkoutByUuid`, `useWorkoutSplits`, `useWorkoutFacets`, `useWorkoutRecords`, `useWorkoutRecordsFacets`) hanno `refetchInterval: 30 * 60_000` (30 min) come fallback automatico. Il polling è disabilitato quando il tab è in background (default TanStack Query). Per refresh immediato l'utente clicca il bottone "Sincronizza" in Home (`SyncButton`). `useSyncStatus` e `useSyncSessions` mantengono polling 60s (sono "heartbeat" del backend). Le query indipendenti (lab, regimens, rules, blacklist, diario/stretching proxy, recentWrites, allowedWriteTypes) restano fuori dal polling 30 min.
- `src/lib/types.ts` — TypeScript types matching backend schemas (Sample, AggregatedPoint, SamplesResponse, Workout, WorkoutDetail, WorkoutFilters, WorkoutFacets, EffectiveTypeFacet, IngestRule, RulesSummary, BlacklistEntry, PendingWrite, SyncSession, SyncStatus, CorrelatedSample, DiarioPlan, DiarioDailyTotal, StretchingSession, StretchingRoutine, ...)
- `src/lib/healthkit.ts` — master HK type → label/unit/color/multiplier mapping (`TYPE_META`), categories (`CATEGORIES`: activity, vitals, body, nutrition, fitness, other), sleep stages, workout activity type names (`WORKOUT_NAMES` — full HKWorkoutActivityType table), `workoutName(type, metadata)` with indoor + swim-location detection, `effectiveTypeLabel(slug, activityType)`, `extractWorkoutMetadata()` (parses HKIndoorWorkout, HKSwimmingLocationType, HKLapLength, elevation, METs, weather, brand, notes)
- `src/lib/utils.ts` — cn(), formatNumber, formatDate, formatDateTime
- `src/components/ui/` — shadcn components: button (variants incl. destructive), card, tabs, select, table, input, label, textarea, **slider** (Radix-based)
- `src/components/FilterBar.tsx` — generic filter bar for type pages (date/sources/devices/value range)
- `src/components/WorkoutFiltersSidebar.tsx` — dedicated right-sidebar filter panel for Workouts (year chips, activity chips via effective_types with counts, sources chips, datetime range, distance km, duration min, **pace dual-range slider with preset chips**)
- `src/components/TypeBrowser.tsx` — reusable tabbed browser used by Activity/Vitals/Nutrition; integrates FilterBar
- `src/components/BodyBrowser.tsx` — specialized Body page: parallel fetch of all body types, custom tooltip showing ALL values at the same instant, row-level delete with correlated-samples confirmation dialog
- `src/components/SampleTable.tsx` — paginated raw samples table, optional `onDelete` prop for trash button per row
- `src/components/SyncButton.tsx` — bottone "Sincronizza" usato nella Home; al click invoca `queryClient.refetchQueries` su tutte le 16 query key dipendenti dai dati sync iOS (vedi `Home` in Pages/Routes per la lista). Spinner + label "Aggiornando..." durante il refetch, disabled per evitare click multipli.
- `src/components/DayCalendarSidebar.tsx` — sidebar del Calendario (`/day/:date`) con mini-calendario mensile cliccabile. Naviga mesi indipendentemente dalla data selezionata, evidenzia in verde i giorni con workout (lookup O(1) via Set), giorno selezionato in primary, oggi cerchiato. Bottone "Vai a oggi" + drawer mobile.
- `src/components/NutritionCalendar.tsx` — mini-calendario per `/nutrition` con celle colorate per aderenza al target del giorno (verde = nel target ±10%, blu = sotto, rosso = sopra, ambra = senza target). Mostra il valore kcal sotto il numero del giorno. Il filtro `kcalTargetFilter` opzionale "dimma" le celle con target diverso. **Click su un giorno** → toggle di un riassunto inline (`DaySummary`) sotto la griglia, NON naviga via dalla pagina: mostra data, kcal/macro consumati vs target, % aderenza, kcal_target del piano del giorno (se diverso dal corrente). I target macro sono mostrati solo se il `kcal_target` del giorno coincide col piano corrente (probabile stesso piano — il diario non espone i target macro storici). Bottone "vai al giorno" link a `/day/<iso>` per chi vuole comunque navigare, bottone X per chiudere.
- `src/components/WorkoutMap.tsx` — mappa Leaflet vanilla (no react-leaflet) per il GPS route di un workout. Tile OpenStreetMap, polyline divisa in segmenti colorati per pace (HSL gradient 120→0 verde→rosso, range 240-480 s/km clamped), start/end marker via `divIcon` HTML (no asset URL issues con Vite), cursor `circleMarker` blu sincronizzato via prop `hoverIndex`. `preferCanvas: true` per performance. Distanza segmenti calcolata via Haversine inline. **Tooltip "sticky" al hover**: ogni segment ha un `bindTooltip` con ora del punto, velocita' (km/h + pace min/km) e battito cardiaco — l'HR e' la media dei sample HR dentro la finestra `[tA, tB]` del segmento (binary search su `hrSeries` opzionale prop, fallback sample piu' vicino entro 30s). **Container ridimensionabile**: control bar con preset S/M/L (300/500/800 px) + toggle fullscreen (`position:fixed inset:0 z:50`) + drag handle nativo del browser (`resize: vertical`). `ResizeObserver` chiama `map.invalidateSize()` ad ogni cambio per evitare tile gray. **Highlight range**: prop `highlightedRange={startIdx, endIdx}` disegna una polyline blu spessa (weight 7) sopra i segmenti pace-colored, con `bringToFront()` e `fitBounds(maxZoom:17)` automatico — usato dal click sui Parziali.
- `src/components/ElevationChart.tsx` — Recharts `AreaChart` col profilo altimetrico vs distanza cumulativa (Haversine). Auto-hide se nessun punto ha `alt`. Tooltip con km / quota / pace, `ReferenceDot` blu per il cursore sincronizzato. Hover sul chart aggiorna `hoverIndex` lift-stato condiviso con `WorkoutMap` (lift in `WorkoutDetail.tsx`).
- `src/components/charts/TimeSeriesChart.tsx` — Recharts wrapper with autoscale Y-axis, multi-year-aware X-axis formatter, full-year tooltips
- `src/components/charts/MetricCard.tsx`
- `src/components/controls/TimeRangeSelector.tsx`, `AggregationSelector.tsx`
- `src/pages/Settings.tsx` — rules CRUD (with live hits stats) + blacklist UUID list

### Pages / Routes

- `/` — **Home**: today metric cards, weekly charts, last 3 workouts, sync status card, **last 10 sync sessions table**, **bottone "Sincronizza"** in alto a destra (`components/SyncButton.tsx`) che fa `refetchQueries` su tutte le 16 query key dipendenti dai dati sync iOS (`samples`, `latest`, `latestWeight`, `sampleFacets`, `categories`, `types`, `dailyStats`, `daySnapshot`, `workouts`, `workout`, `workoutSplits`, `workoutFacets`, `workoutRecords`, `workoutRecordsFacets`, `syncStatus`, `syncSessions`). Spinner + label "Aggiornando..." durante il refetch.
- `/activity` — steps, distance, flights, calories (tabbed via TypeBrowser)
- `/vitals` — HR, HRV, SpO2, blood pressure, respiratory, temperature, glucose
- `/body` — weight, BMI, body fat, lean mass, height, waist. **Left sidebar filters** (metriche chips, aggregazione grafico, periodo preciso con preset 7g/30g/90g/1a/Tutto **+ chip anno** 2001→oggi derivati da `/samples/facets` — click imposta 1 gen/31 dic di quell'anno; sources chips, range peso). **Multi-line chart** con tooltip multi-metrica e `ReferenceArea` di **drag-to-select**: trascina orizzontalmente per far apparire un popover con il delta (`first → last`, segnato, colorato) per ogni metrica attiva nell'intervallo selezionato. **Tabella con tutti i campioni** paginata (10/pagina). **Card variazione peso** in alto (ultimo mese / ultimo anno / tutto / periodo selezionato). **Card "Calcolatore peso e dieta"** (`components/WeightCalculator.tsx`) subito sotto le card variazione, **collassabile** (default chiusa, header cliccabile con chevron + mini-summary tipo "78.4 → 75.0 kg · 7 sett" o "Sei al target"): input peso target (default = peso attuale), BMI attuale + target con categoria colorata (sottopeso/normo/sovrap/obeso), TDEE selezionabile via toggle **HK reale** (default: media giornaliera ultimi 30 giorni di Active+Basal Energy via `useDailyStats`) o **Manuale** (formula Mifflin-St Jeor con eta'/sesso/altezza/livello attivita' — fattori 1.2 sedentario / 1.375 leggero / 1.55 moderato / 1.725 attivo / 1.9 molto attivo), slider calorie (min 1200, max TDEE+500, step 50) con calcolo real-time di deficit/surplus + kg/settimana + tempo stimato + data prevista (assume `KCAL_PER_KG = 7700`). Warning ambra se deficit > 1000 kcal/die o slider < 1500 kcal/die. Auto-fallback a Manuale se HK Active+Basal non disponibili. Tutto persistito in `localStorage` chiave `body_calculator_v1` (`{targetWeight, kcalSlider, tdeeMode, manualAge, manualSex, manualHeight, manualActivity}`). Row-level delete con conferma dei dati correlati (±5 min). Filtri persistiti in `sessionStorage` (`body_filters_v3`). I chip Anno e Sorgente del sidebar mostrano sempre l'intero range storico (sono popolati da `/samples/facets` non filtrato nel tempo, non dai dati della vista corrente).
- `/sleep` — sleep analysis, stacked bar per night
- `/workouts` — **main Workouts page** with **left sidebar filters** (year, activity, source, datetime, distance km, duration min, pace slider + presets, title search, notes search), summary cards, workouts-per-period chart with click-to-drilldown, **sortable** list table (click headers to sort asc/desc) with **title**, pace and truncated notes columns, row-level delete with 8s undo toast
- `/workouts/:uuid` — **Apple Fitness-style detail**: page heading uses the custom title (fallback to activity name), metrics (duration, distance, calories, avg pace, avg/max HR), "Informazioni aggiuntive" card (indoor/outdoor, swim location, lap length, elevation, METs, weather, brand), **Parziali (per km)** table — rows **cliccabili** quando il workout ha route GPS: click sulla riga del km N → highlight blu del segmento sulla mappa, click di nuovo deseleziona. **Intervalli** card (shown when `workout.activities` is present — rows colored grey for rest, shows start time / duration / distance / pace / avg+max HR / kcal per interval) — anche le righe Intervalli sono cliccabili per evidenziare l'intervallo sulla mappa, mutuamente esclusive con i Parziali (un solo highlight attivo). Lo state condiviso e' `highlight: {kind: "km" | "activity"; id: number} | null` con derivata `highlightedRange` che mappa la finestra `[start, end]` agli indici di `route.points`. Time-series charts (HR, running speed, power, cadence — il tooltip della velocita' mostra entrambe le unita' "km/h · min/km"). **Frequenza cardiaca**: card mostrata solo se ci sono almeno 2 sample puntuali (`hrChartData.length > 1 && hrAggregatedOnly === null`). Per workout pre-2019 di Apple Watch (1 solo sample HR aggregato lungo l'intero workout, comportamento legacy di watchOS) la card e' nascosta del tutto — la FC media e' gia' visibile nelle metriche in alto. Detection del caso aggregato: `hr.data.length === 1 && sample.duration / workout.duration > 0.5`. **Titolo + Note**: i due box editabili sono affiancati in grid 2-colonne (md+). **Editable title + notes** cards. **Mappa percorso** card (`components/WorkoutMap.tsx` + `ElevationChart.tsx`): Leaflet su tile OpenStreetMap (no API key) con polyline colorata per pace, marker start/end, tooltip al hover con velocita' (km/h + min/km) e HR per il segmento, profilo altimetrico Recharts sotto la mappa con cursore sincronizzato. **Container ridimensionabile**: control bar con preset S/M/L (300/500/800 px) + drag handle nativo (`resize: vertical`) + toggle fullscreen. Placeholder se la route non e' ancora stata sincronizzata dall'app, oppure se il workout non ha dati GPS. Backed by `useWorkoutRoute(uuid)` → `GET /api/v1/workouts/by-uuid/{uuid}/route`.
- `/records` — **Personal Records (running-only)**: dedicated page, intentionally independent from `/workouts` filters so the two UIs don't intersect. Own left sidebar with year chips (counts from running history), source chips, Outdoor/Indoor chips; all-time by default. Per `effective_type` (`type_37` outdoor + `treadmill_run` indoor) a card with: overall (longest distance, longest duration, fastest pace, most calories), "Record per distanza" (5K/10K/mezza/maratona when available, +10% tolerance), "Miglior km ever" (fastest reconstructed 1-km split, top-5 candidates, 3:00/km floor to reject GPS artifacts). Every record clickable → workout detail. Filters persisted in `sessionStorage` (`records_filters_v1`). Backed by `/api/v1/workouts/records` + `/records/facets`.
- `/nutrition` — top section: **Calendario registrazioni** (`components/NutritionCalendar.tsx`) — mini-calendario mensile con celle colorate per aderenza al target del giorno: verde = nel target (±10%), blu = sotto, rosso = sopra, ambra = giorno senza piano attivo, neutro = nessun dato. Click su un giorno → naviga a `/day/<iso>`. Sotto: **Diario alimentare** integration (piano attivo con kcal/protein/fat/carbs target, card "Oggi" con 4 progress bar consumato vs target, trend 7/30/90 giorni con area chart kcal consumate + linea tratteggiata target + tabella). **Il piano mostrato è quello manuale (regimen diet) se presente per il giorno, altrimenti il piano dal diario-alimentare. I piani manuali mostrano un badge 🔧 nel nome per distinguerli.** Sidebar filtri: oltre a periodo/kcal/aderenza, **Regime alimentare** = chip per ogni `kcal_target` distinto presente nei daily totals storici (il diario non espone i nomi dei piani storici, quindi usiamo il `kcal/die` arrotondato come discriminante; valori speciali "Tutti" e "Senza target"). Bottom section: HealthKit nutrition (calories, macros, water, caffeine) via TypeBrowser. Dati diario fetched via proxy `/api/v1/diario/*` (vedi sotto).
- `/stretching` — visualizzazione read-only delle sessioni stretching registrate dall'app PWA (`alexpani/stretching`). Selettore periodo (default ultimi 30 gg), 4 card stats (sessioni, tempo totale, streak corrente, streak max su giorni locali), **BarChart minuti/giorno** con gap-fill dei giorni vuoti, tabella sessioni ordinata per `started_at` desc con routine, durata, completati/totali, note. Nessuna scrittura né sync HealthKit — i dati vivono nel DB della PWA, questa pagina li proxya via `/api/v1/stretching/*` (cache TanStack Query 30s).
- `/lab` — **Laboratorio** (PR #3): upload PDF referti, lista referti (drafts con badge "da rivedere" in alto + confermati in basso). Tabs predisposti per Matrice/Andamenti (disabled, arrivano in PR #4). Upload widget in alto a destra della pagina (drag & drop + click-to-choose, accetta solo PDF). Al drop: `POST /api/v1/lab/ingest` → navigate a `/lab/panels/{id}/review`.
- `/lab/panels/:id/review` — Review screen: link al PDF originale via `API_URL/api/v1/lab/documents/{doc_id}/file`, tabella editabile dei `lab_results` con datalist di autocomplete dal catalogo analiti, pulsante "salva alias" per imparare il nome grezzo. Sticky bottom bar con "Conferma referto" (disabled finché ogni riga ha un `analyte_id`). Se confermato: modalità read-only, nessuna sticky bar. Badge per riga: "da rivedere" (amber) / "fuori range" (red) / "ok" (green).
- Tab **Matrice** (PR #4): `components/LabMatrix.tsx`. Tabella sticky analiti × date (più recente a sinistra). Righe raggruppate per `category` con header collassabile. Celle colorate rosso se `out_of_range=true`, ambra se `needs_review=true`. Click data colonna → dettaglio panel. Click nome analita → jump a tab Andamenti pre-selezionato.
- Tab **Andamenti** (PR #4): `components/LabTrends.tsx`. Sidebar sinistra con preset temporali (12m/3y/5y/tutto) + chip analiti per categoria (multi-select, max 5 contemporanei). Per ogni analita una Recharts `LineChart` con banda di riferimento (`ReferenceArea` fra `ref_low`/`ref_high`), dot rosso più grande sui valori `out_of_range=true`. Colori per-serie fissi (rosso/blu/verde/ambra/viola).
- Card **"Peso al prelievo"** (PR #6) in `/lab/panels/:id/review`: fetch HKBodyMass più recente con `start_date <= test_date` entro 3 giorni. Solo visualizzazione, nessuna scrittura nel panel.
- Widget **"Analisi fuori range recenti"** (PR #6) in Home: `components/LabRecentOorCard.tsx`. Fetch `/api/v1/lab/recent-out-of-range?limit=10`. Si auto-nasconde se non ci sono valori fuori range. Ogni riga è un link alla review del panel.
- `/fitness` — VO2 max, running/cycling/walking advanced metrics, stair speeds
- `/explore` — universal browser: pick any sample type with full filter bar + chart + raw table
- `/insert` — form to queue body/nutrition writes for Apple Health
- `/day` (redirect a `/day/<oggi>`) e `/day/:date` — **Calendario / vista giorno**. **Sidebar a sinistra** (`components/DayCalendarSidebar.tsx`) con mini-calendario mensile cliccabile: griglia 7×N (settimana lun-dom), header con frecce ← → per navigare i mesi, giorni con workout colorati di verde (`bg-emerald-500/25`), giorno selezionato in primary, oggi cerchiato con ring. Sotto la griglia: legenda + bottone "Vai a oggi". I workout del mese arrivano da `useWorkouts({start, end})` filtrato sul mese visualizzato; lookup O(1) via Set di chiavi YYYY-MM-DD. **Pallino rosa sotto il numero del giorno** per i giorni con almeno una nota di salute (lookup via `useHealthNoteDays(start, end)` che chiede al backend l'espansione dei periodi). Su mobile (<lg) la sidebar diventa un drawer accessibile da un'icona calendario nell'header. Header sticky con frecce ←/→ (anche da tastiera), `<input type="date">` per saltare a una data, pulsante "Oggi". Card grid con: Attivita' (passi/distanza/calorie/exercise/stand/move/flights da `daily_stats`), Corpo (latest sample <= EOD), Vitali (HR avg/min/max + AVG SpO2/HRV/BP/temp), Nutrizione (4 progress bar kcal/proteine/grassi/carbo dal diario o HK fallback + acqua/caffeina/fibre), Sonno (totale + breakdown stages + ora inizio/fine), Workout (lista cliccabile a `/workouts/:uuid`), Laboratorio (panel con `test_date == giorno`, link a review), Regimi attivi (chip per kind con dose, click → modal edit, pulsante "+ Aggiungi" precompilato con `start_date=giorno`), **Note di salute** (raggruppate per categoria, ogni nota mostra zona+testo, periodo se >1 giorno, click → modal edit, pulsante "+ Aggiungi" precompilato con start/end=giorno). URL stateful: la data e' nel path, link condivisibili. Backed by `GET /api/v1/day/{date}`.
- `/health-notes` — **Note di salute**. Pagina dedicata con sidebar filtri (casella di ricerca testuale debounced su `text`, chip categoria, chip zona corporea popolati da `/health-notes/zones`, range date con preset 7g/30g/90g/1a/Tutto). Lista raggruppata cronologicamente per mese, ogni nota mostra chip categoria colorato, zona, testo, periodo. Click sulla riga → modal di edit. Pulsante "Nuova nota" in alto a destra. Filtri persistiti in `sessionStorage` chiave `health_notes_filters_v1`. Backed by CRUD `/api/v1/health-notes`.
- `/regimens` — **Regimi** (farmaci/integratori/piani alimentari/allenamento/gear). **Toggle Timeline / Tabella** in alto (default Timeline). **Vista Timeline** (`components/RegimenTimeline.tsx` + `RegimenGanttGrid.tsx` + `RegimenTimelineTooltip.tsx` + hook `hooks/useRegimenTimeline.ts`): grafico Gantt con **una riga per gruppo `(kind, name lowercase trim)`**, dove ogni gruppo riunisce le "vite" successive dello stesso regime (es. Coenzima Q10 preso ad aprile, sospeso, ripreso a maggio = 1 sola riga con 2 barre adiacenti, badge "×N" accanto al nome). **I piani alimentari (kind='diet') non compaiono nella Timeline** — solo nella vista Tabella. Y-axis = nomi gruppi ordinati per kind poi per earliest start_date. **Colonna labels FISSA** (`w-48 flex-shrink-0`), fuori dallo scroll orizzontale. **Solo la timeline interna scrollabile** (`min-w-[600px]`). Preset di periodo: Ultimo anno / Ultimi 3 anni / Ultimi 5 anni / Tutto (per "Tutto" il range parte dal regimen piu' antico con padding 30gg, non dal 1970). Colori per kind: medication=rosso, supplement=blu, training=ambra, gear=viola. Per i gear (es. scarpe da corsa): sotto il nome nella colonna sinistra mostra "N km" cumulativi (sum `total_distance` dei workout running nell'intervallo, calcolato client-side via `useGearKm` con singolo fetch per range globale gear); il tooltip al hover mostra "X km percorsi" sulla barra specifica del periodo. **Posizionamento barre**: ancore `left + right` (calcolate da `calculateBarPosition`) invece di `left + width`, cosi' tutte le barre "in corso" finiscono allineate sulla stessa linea verticale di "oggi" anche quelle minime gonfiate dal `min-width: 4px` (per le barre `tooNarrow` ancoraggio a destra se `right < 0.01`, altrimenti a sinistra). `start_date` NULL → marker "?" tratteggiato a sinistra; `end_date` NULL → barra estesa fino a oggi. Hover su barra → tooltip fixed con nome/dose/periodo/note; click su barra → modal di edit (`RegimenForm`) per quello specifico regimen del gruppo. Toggle "Mostra terminati" nasconde i gruppi i cui regimens sono **tutti** terminati. Decimazione automatica dei date markers (max 7 visibili) per evitare sovrapposizione su range ampi. **Vista Tabella**: filtri chip per `kind` + toggle "mostra terminati". Sezione "In corso" e "Terminati", entrambe raggruppate per kind in card-tabella (Nome / Dose o Kcal / Periodo / Note / Modifica). I piani alimentari (kind='diet') mostrano il target kcal e i macro % dal metadata; voci `source='lab_backfill'` mostrano badge "da lab". Modal `RegimenForm` per create/edit/delete (riutilizzato anche su `/day`): campo Nome con **autocomplete via `<datalist>` HTML5** popolato dai nomi distinti (case-insensitive) del kind selezionato (`useRegimens({ kind, include_ended: true })`); se il nome digitato matcha case-insensitive uno esistente, mostra hint ambra "Esiste già un \"X\" — verrà mostrato come secondo periodo sulla stessa riga della timeline" (solo in create, non in edit). Per i piani alimentari (kind='diet'), il form mostra una sezione collassabile per kcal_target e macro percentuali (opzionali). Backed by CRUD `/api/v1/regimens`.
- `/settings` — ingest rules CRUD (add, edit min/max, toggle active, delete, reset stats), blacklist UUID list with remove

### Filter Persistence

- Workouts page filters persisted in `sessionStorage` key `workouts_filters_v2` (filter object + chart aggregation). Survives navigation into/out of workout detail page.

### Pace Filter UX (in WorkoutFiltersSidebar)

- Dual-handle `<Slider>` (Radix-based) 3:00-15:00 /km, step 10s
- Live current range display in m:ss/km
- 5 preset chips: `< 4:30`, `4:30-5:30`, `5:30-6:30`, `6:30-7:30`, `> 7:30`

---

## Bulk Imports

### Endomondo import (historical data)

- CSV export converted to JSON and POSTed to `/api/v1/workouts/batch`
- Mapping table (Endomondo sport → HKWorkoutActivityType + variant):
  - RUNNING → 37
  - WALKING → 52
  - SWIMMING → 46
  - TREADMILL_RUNNING → 37 + `HKIndoorWorkout=1`
  - TREADMILL_WALKING → 52 + `HKIndoorWorkout=1`
  - SPINNING → 13 + `HKIndoorWorkout=1`
  - WEIGHT_TRAINING → 50 (traditionalStrengthTraining)
  - OTHER → 3000
- Notes field: `"name"` concatenated with `" - "` + `"notes"` from CSV (omits duplicates or empty)
- UUIDs are deterministic via `uuid5(namespace, f"endomondo:{start_time}:{sport}")` → re-running the script is idempotent (no duplicates)
- Source: `source_name="Endomondo"`, metadata includes `{"source":"Endomondo","endomondo_source": <TRACK_MOBILE|INPUT_MANUAL|IMPORT_GPX|IMPORT_GARMIN>}`
- Timestamps in the CSV are UTC; stored as TIMESTAMPTZ (display converts to local)
- 302 workouts imported (2011-10-08 → 2015-09-07) — the first Apple-recorded workout is 2015-09-17

---

## Dominio Lab Results (sangue / urine)

Dominio separato dal mondo HealthKit: referti di laboratorio. Spec completa in `LAB_RESULTS_SPEC.md`. Roadmap in 6 PR — **PR #1 (questa): solo schema + seed**, niente endpoint, dashboard o parsing LLM.

### Tabelle (backend)
- `lab_documents` — file PDF originali, una riga per hash `sha256` UNIQUE.
- `lab_analytes` — catalogo normalizzato (`slug`, `display_name_it`, `category`, `specimen`, `value_type`, `unit_canonical`, `ref_low/high`, `ref_text`). Catalogo iniziale: 28 analiti sangue + 17 urine, popolato dalla migration `seed_lab_analytes`.
- `lab_analyte_aliases` — sinonimi italiani per il matching nomi nei referti (UNIQUE su alias + index funzionale `ix_lab_aliases_lower ON (LOWER(alias))`).
- `lab_panels` — un referto = un panel; `specimen_types TEXT[]`, `status` draft|confirmed, FK opzionale a `lab_documents`.
- `lab_results` — singole misure; FK `analyte_id` opzionale per gestire la review (NULL finché l'utente non mappa). CASCADE on `panel_id`; SET NULL on `analyte_id`.

### Alembic — ordine migration lab (§10 della spec)
`lab_documents` → `lab_analytes`+`lab_analyte_aliases` → `lab_panels` → `lab_results` → `seed_lab_analytes`. Revision chain aggancia a `6677af61441c` (diario_hk_sync).

### Modelli SQLAlchemy
- `backend/app/models/lab.py`. `app.models` è ora un **package** (prima era un file singolo): l'import storico `from app.models import Base, HealthSample, ...` continua a funzionare identico. `__init__.py` contiene i modelli HealthKit esistenti e in coda fa `from . import lab` per registrare le tabelle lab su `Base.metadata` senza doverle importare esplicitamente in `alembic/env.py`.

### Test
- `backend/tests/` con `pytest` + `pytest-asyncio`. Requisiti in `backend/requirements-dev.txt`.
- I test richiedono un DB Postgres reale (default `postgresql+asyncpg://health:health@localhost:5432/health_tracker_test`, override via env `TEST_DATABASE_URL`). Se il DB non risponde i test sono **skipped**, non falliti.

### Policy
- App single-user self-hosted: dati medici reali **possono** vivere in repo (fixture test, commenti, esempi). Nessun obbligo di anonimizzazione. I PDF operativi stanno comunque nel volume `backend/data/lab_documents/` (in `.gitignore`) per non gonfiare la history.
- `ANTHROPIC_API_KEY` letta solo dal backend via pydantic-settings (`app/config.py`); mai dalla dashboard. Default modello: `claude-opus-4-7` (override via env `ANTHROPIC_MODEL`).
- Review umana obbligatoria prima del commit di un panel: i `lab_results` con `analyte_id IS NULL` bloccheranno il confirm (logica in PR #2b).

### Ingest pipeline (PR #2a)
- Service: `app/services/lab_ingest.py` (estrazione testo pdfplumber → Anthropic JSON parse → matching alias).
- Matching alias: **exact case-insensitive** su `lab_analyte_aliases` → fallback **pg_trgm similarity > 0.6**. Extension `pg_trgm` abilitata dalla migration `07a1b2c3d4e5`.
- Dedup upload via `sha256`: stesso PDF caricato due volte → riusa il document esistente e ritorna il panel già associato (se presente).
- Parsing deterministico lato service: decimale italiano (`27,62` → `Decimal("27.62")`), range `a - b` → `(ref_low_raw, ref_high_raw)`, reference testuale (`Superiore a 35`, `fino a 12`) → `ref_text_raw`. Asterischi "*" di out-of-range restano nel `raw_name`/`value_raw` grezzo — non sono interpretati qui, saranno ricostruiti dal confirm in PR #2b via `ref_low`/`ref_high` dell'analita.

### Endpoint lab (tutti sotto `/api/v1/lab`, in `app/routers/lab.py`)
- `POST /ingest` — multipart PDF. Ritorna `{panel_id, status, test_date, lab_name, specimen_types, analytes_count, unmatched_count, parsing_failed, document_id}`. Panel creato in `draft`.
- `GET /panels` — lista paginata con filtri `status`, `year`, `specimen`, `lab_name`.
- `GET /panels/{id}` — dettaglio + array di `results` con valori e range.
- `PATCH /panels/{id}` — edit `test_date`, `lab_name`, `notes`, `specimen_types` (funziona anche su panel confermati).
- `DELETE /panels/{id}?delete_document=true` — cancella panel (cascade sui result) + documento + PDF su disco.
- `POST /panels/{id}/confirm` — draft→confirmed. Applica conversione unità (match o equivalente) + calcolo `out_of_range` per ogni result. Rifiuta 400 se anche un solo result ha `analyte_id=NULL`.
- `PATCH /results/{id}` — edit singolo result (`analyte_id`, `value_numeric`, `value_text`, `unit_raw`, `notes`). Resetta `needs_review=True` + `out_of_range=None` + `unit_normalized=None`: il prossimo confirm rifà il check.
- `POST /aliases` `{analyte_id, alias}` — learning dalla review; 409 su duplicato.
- `POST /analytes` `{slug, display_name_it, category, specimen?, value_type?, unit_canonical?, ref_low?, ref_high?, ref_text?, aliases?}` — crea analita custom; gli alias duplicati vengono contati in `aliases_skipped`.
- `GET /documents/{id}/file` — stream del PDF originale.
- `GET /analytes` — catalogo read-only, filtri `specimen`, `category`.
- `GET /matrix` — vista sparsa analiti × date per la tab Matrice (solo `confirmed`). Ritorna `{analytes, panels, cells}` dove `cells[analyte_id][panel_id] = {value_numeric, value_text, unit, out_of_range, needs_review}`. Filtri: `start`, `end`, `specimen`, `category`.
- `GET /timeseries?analyte_slug=...&start=...&end=...` — serie temporale di un singolo analita su panel `confirmed`. Ritorna `{analyte, points[]}` con `ref_low/high` per la banda di riferimento del chart.
- `GET /recent-out-of-range?limit=N` (PR #6) — ultimi result `out_of_range=True` da panel `confirmed`, ordinati per data DESC. Usato dal widget Home.

### Extension dell'endpoint samples/latest (PR #6)
`GET /api/v1/samples/latest?type=X&before=<ISO>&window_days=N` — oltre al comportamento originale (ultimo sample del tipo), supporta `before` (ritorna il più recente con `start_date <= before`) e `window_days` (limita a `start_date >= before - N giorni`). Usato dalla card "Peso al prelievo" su `/lab/panels/:id/review` per agganciare il peso HK più vicino al prelievo (default finestra 3 giorni).

### Unit matching (confirm, §5.3)
- `app/services/lab_units.py`: `normalize_unit` (lowercase, strip, `µ→u`), `units_equivalent` (tabella di sinonimi: `ng/ml ≡ µg/l`, `U/l ≡ IU/l`, …), `numeric_out_of_range`, `qualitative_out_of_range`.
- Il confirm **non** effettua conversioni numeriche fra unità diverse (es. `mg/dl ↔ mmol/l`): in quel caso lascia `needs_review=True` con hint su range raw. L'utente risolve in review (cambia unit_raw o mappa l'analita giusto).
- Qualitativi (urine): `out_of_range=True` se `ref_text` indica assenza e `value_text` è un marker positivo (`+`, `++`, `tracce`, `positivo`, …).

### Volume Docker
- `backend/docker-compose.yml` monta `./data/lab_documents` su `/app/data/lab_documents`. Variabile `LAB_DOCUMENTS_DIR` nel container.

### Import storico xlsx (PR #5)
- Script: `backend/scripts/import_spreadsheet_lab.py`.
- Uso: `python -m scripts.import_spreadsheet_lab --file storico.xlsx [--sheet Analisi] [--dry-run|--commit]`.
- Formato atteso: riga 1 = date in colonne B.., colonna A = nomi analiti, riga "Note" → popolamento `panel.notes` per colonna. Valori: numeri con virgola italiana, testo qualitativo, o "numero + unità inline" (es. `3,02 pg/ml`).
- Matching: exact case-insensitive su `lab_analyte_aliases`. Miss → result inserito comunque con `analyte_id=NULL` e `needs_review=True` (da risolvere via UI /lab review).
- I panel creati sono `status='confirmed'` con `specimen_types=['blood']` (default MVP — editabile via `PATCH /panels/{id}`).
- Dry-run di default: scrive `import_report.tsv` accanto al file di input con: panel trovati, count valori per colonna, righe non mappate. Nessuna scrittura su DB.
- Dep aggiunta: `openpyxl`.

---

## Operational Commands

### Deploy

```bash
# Backend
scp backend/app/... root@192.168.68.166:/opt/health-tracker/backend/...
ssh root@192.168.68.166 "cd /opt/health-tracker/backend && docker compose up -d --build api"
# Migrations
ssh root@192.168.68.166 "cd /opt/health-tracker/backend && docker compose exec -T api alembic revision --autogenerate -m 'msg' && docker compose exec -T api alembic upgrade head"

# Dashboard
scp -r dashboard/src root@192.168.68.190:/opt/ealth-dashboard/dashboard/
ssh root@192.168.68.190 "cd /opt/ealth-dashboard/dashboard && docker compose up -d --build"
```

### DB quick queries

```bash
# Per-type counts
ssh root@192.168.68.166 "docker exec health-tracker-db psql -U health -d health_tracker -c \"SELECT type, COUNT(*) FROM health_samples GROUP BY type ORDER BY 2 DESC;\""

# Inspect workout metadata keys
ssh root@192.168.68.166 "docker exec health-tracker-db psql -U health -d health_tracker -c \"SELECT activity_type, k, COUNT(*) FROM workouts, jsonb_each(metadata) AS kv(k, v) WHERE jsonb_typeof(metadata)='object' GROUP BY 1,2 ORDER BY 1;\""

# Blacklist size
ssh root@192.168.68.166 "docker exec health-tracker-db psql -U health -d health_tracker -c \"SELECT COUNT(*) FROM ingest_blacklist;\""
```

### Sync check

```bash
curl -s http://192.168.68.166:8000/api/v1/sync/status | python3 -m json.tool
curl -s "http://192.168.68.166:8000/api/v1/sync/status?include_types=true" | python3 -m json.tool
```

---

## Known Limitations / Notes

- HealthKit does not let apps delete samples they didn't create (e.g., Withings scale data). For those, user must delete from Apple Salute manually, OR we blacklist the UUID server-side (which prevents re-ingestion but doesn't remove from Apple Health).
- The auto-blacklist trigger is installed on BOTH `health_samples` and `workouts`. Deleting a workout (via dashboard or iOS sync-detected HK deletion) permanently blocks re-ingestion of that UUID.
- `iOS Info.plist` is regenerated by xcodegen from `project.yml`. Custom keys added directly to `Info.plist` persist, but do not rely on it: prefer setting them via `project.yml` entitlements/settings.
- `BGAppRefreshTask` scheduling is a hint — iOS decides the actual execution time. Real-time reactivity comes from `HKObserverQuery` + `.hourly` background delivery.
- Personal team signing: cannot use `com.apple.developer.healthkit.access` (Clinical Health Records). Standard HealthKit + background-delivery are fine.
