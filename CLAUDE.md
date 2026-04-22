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
- **Dashboard** (`dashboard/`): React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Recharts + TanStack Query, deployed via Nginx on Proxmox LXC. Layout has a **hamburger top-bar** that opens a nav drawer (Sidebar nav items listed in `src/components/layout/Sidebar.tsx`); main content is full-width.

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

### Routers

- `ingest.py` — POST batch endpoints (samples, categories, workouts). Applies:
  1. UUID blacklist filter
  2. DB-configured IngestRule (`_apply_rules`) with hit recording
  3. `INSERT ... ON CONFLICT (uuid) DO NOTHING`
- `query.py` — all GET endpoints + some POST/PATCH/DELETE for samples and workouts.
- `write.py` — `/api/v1/write` queue endpoints (POST, GET /pending, POST /{id}/confirm|fail, GET /recent, GET /allowed-types).
- `delete.py` — `/api/v1/delete/*` workflow for bulk deletion via iOS.
- `rules.py` — `/api/v1/rules` CRUD + summary + reset-stats.
- `blacklist.py` — `/api/v1/blacklist` list/add/remove + `purge-and-blacklist` (atomic delete + blacklist).

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

**Write / Delete queues (web ↔ Apple Health)**
- `POST /api/v1/write`, `GET /api/v1/write/pending`, `POST /api/v1/write/{id}/confirm|fail`
- `GET /api/v1/write/recent` — dashboard feedback on write status
- `GET /api/v1/write/allowed-types` — whitelist of write-allowed HK identifiers
- `POST /api/v1/delete/plan`, `GET /api/v1/delete/pending`, `POST /api/v1/delete/{id}/confirm|fail`, `GET /api/v1/delete/status`

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
  3. Quantity types — looped with 90-day windows (`fetchWindowDays=90`), parallel POST (`syncConcurrency=4`), batch size 1000
  4. Category types (same loop)
  5. Workouts — uses `HKAnchoredObjectQuery` persisted in UserDefaults (`hk_workout_anchor_v1`). Detects HealthKit deletions and propagates them to the backend via `POST /workouts/bulk-delete`. Replaces the previous windowed `HKSampleQuery`-based approach for workouts.
  6. **Body-metric quantity types** (BodyMass, BodyMassIndex, BodyFatPercentage, LeanBodyMass, Height, WaistCircumference) also use `HKAnchoredObjectQuery` with per-type anchor in UserDefaults (`hk_quantity_anchor_v1_<typeIdentifier>`). This catches samples written **retroactively** into HealthKit by sources like Withings (startDate in the past, creationDate later) — the windowed path with `.strictStartDate` predicate would silently miss them once `lastSyncDate` advanced past the sample's startDate. Deletions from Apple Health are propagated via `POST /samples/bulk-delete-by-uuids`.
  6. Deferred types (empty set by default; was used to defer HeartRate/HRV)
  - `performQuickSync(minInterval:120)` — throttled for auto-triggers
  - `resetBodySync()` — clears lastSyncDate for body types (was a Settings button, removed; can be reintroduced)
  - Persists last summary via UserDefaults `last_sync_summary_v1` with `LastSyncSummary` Codable struct
  - `shouldStop` flag for the stop button
- `Services/APIClient.swift` — URLSession actor with retry/backoff, endpoints for samples/categories/workouts POST + pending writes + pending deletions + confirm/fail
- `Services/BackgroundTaskManager.swift` — `BGAppRefreshTask` registration + 1h scheduling
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
- `src/lib/queries.ts` — TanStack Query hooks: samples, facets, correlated, bulk-delete, writes, rules, blacklist, workouts, workout detail, splits, delete/update/restore workout, sync sessions/status, write allowed types
- `src/lib/types.ts` — TypeScript types matching backend schemas (Sample, AggregatedPoint, SamplesResponse, Workout, WorkoutDetail, WorkoutFilters, WorkoutFacets, EffectiveTypeFacet, IngestRule, RulesSummary, BlacklistEntry, PendingWrite, SyncSession, SyncStatus, CorrelatedSample, ...)
- `src/lib/healthkit.ts` — master HK type → label/unit/color/multiplier mapping (`TYPE_META`), categories (`CATEGORIES`: activity, vitals, body, nutrition, fitness, other), sleep stages, workout activity type names (`WORKOUT_NAMES` — full HKWorkoutActivityType table), `workoutName(type, metadata)` with indoor + swim-location detection, `effectiveTypeLabel(slug, activityType)`, `extractWorkoutMetadata()` (parses HKIndoorWorkout, HKSwimmingLocationType, HKLapLength, elevation, METs, weather, brand, notes)
- `src/lib/utils.ts` — cn(), formatNumber, formatDate, formatDateTime
- `src/components/ui/` — shadcn components: button (variants incl. destructive), card, tabs, select, table, input, label, textarea, **slider** (Radix-based)
- `src/components/FilterBar.tsx` — generic filter bar for type pages (date/sources/devices/value range)
- `src/components/WorkoutFiltersSidebar.tsx` — dedicated right-sidebar filter panel for Workouts (year chips, activity chips via effective_types with counts, sources chips, datetime range, distance km, duration min, **pace dual-range slider with preset chips**)
- `src/components/TypeBrowser.tsx` — reusable tabbed browser used by Activity/Vitals/Nutrition; integrates FilterBar
- `src/components/BodyBrowser.tsx` — specialized Body page: parallel fetch of all body types, custom tooltip showing ALL values at the same instant, row-level delete with correlated-samples confirmation dialog
- `src/components/SampleTable.tsx` — paginated raw samples table, optional `onDelete` prop for trash button per row
- `src/components/charts/TimeSeriesChart.tsx` — Recharts wrapper with autoscale Y-axis, multi-year-aware X-axis formatter, full-year tooltips
- `src/components/charts/MetricCard.tsx`
- `src/components/controls/TimeRangeSelector.tsx`, `AggregationSelector.tsx`
- `src/pages/Settings.tsx` — rules CRUD (with live hits stats) + blacklist UUID list

### Pages / Routes

- `/` — **Home**: today metric cards, weekly charts, last 3 workouts, sync status card, **last 10 sync sessions table**
- `/activity` — steps, distance, flights, calories (tabbed via TypeBrowser)
- `/vitals` — HR, HRV, SpO2, blood pressure, respiratory, temperature, glucose
- `/body` — weight, BMI, body fat, lean mass, height, waist. **Left sidebar filters** (metriche chips, aggregazione grafico, periodo preciso con preset 7g/30g/90g/1a/Tutto **+ chip anno** 2001→oggi derivati da `/samples/facets` — click imposta 1 gen/31 dic di quell'anno; sources chips, range peso). **Multi-line chart** con tooltip multi-metrica e `ReferenceArea` di **drag-to-select**: trascina orizzontalmente per far apparire un popover con il delta (`first → last`, segnato, colorato) per ogni metrica attiva nell'intervallo selezionato. **Tabella con tutti i campioni** paginata (50/pagina). **Card variazione peso** in alto (ultimo mese / ultimo anno / tutto / periodo selezionato). Row-level delete con conferma dei dati correlati (±5 min). Filtri persistiti in `sessionStorage` (`body_filters_v3`). I chip Anno e Sorgente del sidebar mostrano sempre l'intero range storico (sono popolati da `/samples/facets` non filtrato nel tempo, non dai dati della vista corrente).
- `/sleep` — sleep analysis, stacked bar per night
- `/workouts` — **main Workouts page** with **left sidebar filters** (year, activity, source, datetime, distance km, duration min, pace slider + presets, title search, notes search), summary cards, workouts-per-period chart with click-to-drilldown, **sortable** list table (click headers to sort asc/desc) with **title**, pace and truncated notes columns, row-level delete with 8s undo toast
- `/workouts/:uuid` — **Apple Fitness-style detail**: page heading uses the custom title (fallback to activity name), metrics (duration, distance, calories, avg pace, avg/max HR), "Informazioni aggiuntive" card (indoor/outdoor, swim location, lap length, elevation, METs, weather, brand), per-km splits table, **Intervalli** card (shown when `workout.activities` is present — rows colored grey for rest, shows start time / duration / distance / pace / avg+max HR / kcal per interval), time-series charts (HR, running speed, power, cadence), **editable title + notes** cards
- `/records` — **Personal Records (running-only)**: dedicated page, intentionally independent from `/workouts` filters so the two UIs don't intersect. Own left sidebar with year chips (counts from running history), source chips, Outdoor/Indoor chips; all-time by default. Per `effective_type` (`type_37` outdoor + `treadmill_run` indoor) a card with: overall (longest distance, longest duration, fastest pace, most calories), "Record per distanza" (5K/10K/mezza/maratona when available, +10% tolerance), "Miglior km ever" (fastest reconstructed 1-km split, top-5 candidates, 3:00/km floor to reject GPS artifacts). Every record clickable → workout detail. Filters persisted in `sessionStorage` (`records_filters_v1`). Backed by `/api/v1/workouts/records` + `/records/facets`.
- `/nutrition` — top section: **Diario alimentare** integration (piano attivo con kcal/protein/fat/carbs target, card "Oggi" con 4 progress bar consumato vs target, trend 7/30/90 giorni con area chart kcal consumate + linea tratteggiata target + tabella). Bottom section: HealthKit nutrition (calories, macros, water, caffeine) via TypeBrowser. Dati diario fetched via proxy `/api/v1/diario/*` (vedi sotto).
- `/stretching` — visualizzazione read-only delle sessioni stretching registrate dall'app PWA (`alexpani/stretching`). Selettore periodo (default ultimi 30 gg), 4 card stats (sessioni, tempo totale, streak corrente, streak max su giorni locali), **BarChart minuti/giorno** con gap-fill dei giorni vuoti, tabella sessioni ordinata per `started_at` desc con routine, durata, completati/totali, note. Nessuna scrittura né sync HealthKit — i dati vivono nel DB della PWA, questa pagina li proxya via `/api/v1/stretching/*` (cache TanStack Query 30s).
- `/fitness` — VO2 max, running/cycling/walking advanced metrics, stair speeds
- `/explore` — universal browser: pick any sample type with full filter bar + chart + raw table
- `/insert` — form to queue body/nutrition writes for Apple Health
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
