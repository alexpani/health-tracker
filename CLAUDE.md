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

When updating, keep the files concise: prefer lists over prose, document the *what* and *why*, not line-by-line details. Always commit docs + code in the same commit.

## Project Overview

Health Tracker Bridge: a bidirectional bridge between Apple Health and web applications. HealthKit is only accessible from native iOS apps, so this system syncs all health data to a backend database and exposes REST APIs for web apps to consume and write back.

## Architecture

```
iPhone (SwiftUI + HealthKit) ←→ FastAPI Backend (Proxmox LXC) ←→ Web Dashboard (React)
                                      ↕
                                 PostgreSQL
```

- **iOS App** (`ios/`): SwiftUI + HealthKit, reads/writes/deletes Apple Health data, syncs to backend
- **Backend** (`backend/`): FastAPI + SQLAlchemy + PostgreSQL, REST API for ingest/query/write/delete/rules
- **Dashboard** (`dashboard/`): React + Vite + TypeScript + Tailwind + shadcn/ui + Recharts

## Infrastructure

| Component | Host | IP | Port |
|-----------|------|-----|------|
| Backend API + PostgreSQL | LXC `ealth-tracker` (Proxmox) | 192.168.68.166 | 8000 |
| Dashboard | LXC `ealth-dashboard` (Proxmox) | 192.168.68.190 | 80 |
| iOS App | iPhone (physical device) | - | - |

## Key Technical Decisions

- **Single `health_samples` table** with `type` discriminator instead of 80+ per-type tables. Index on `(type, start_date)`.
- **UUID-based dedup**: `INSERT ... ON CONFLICT (uuid) DO NOTHING` — crash-safe, idempotent sync.
- **Incremental sync**: `lastSyncDate` per type stored in SwiftData. Fetches only new data since last sync.
- **90-day fetch windows**: HealthKit queries are chunked to avoid memory pressure on large datasets (HeartRate has millions of samples).
- **Parallel POST**: 4 concurrent HTTP uploads per window for throughput.
- **Server-side ingest filters**: DB-configurable rules (value ranges, blocked sources) reject spurious data at ingest time.
- **Auto-blacklist on delete**: PostgreSQL trigger `trg_blacklist_on_delete` auto-inserts deleted sample UUIDs into `ingest_blacklist`, preventing re-ingestion after future syncs.
- **Bidirectional writes/deletes**: web apps POST to `/api/v1/write` and `/api/v1/delete/plan`; iOS polls pending operations and syncs to HealthKit via `HKHealthStore.save()` / `.delete(_)`.
- **Real-time sync**: `HKObserverQuery` + background delivery notifies the app on new HealthKit data (watch writes, manual entries) — auto-triggers sync. Plus sync on app launch and foreground (10 min throttle).
- **Persistent sync summary**: the last sync's log + timing + sample count is persisted in UserDefaults across app launches.

## Backend

### Setup
```bash
cd backend
docker compose up -d
docker compose exec api alembic upgrade head
```

### Key Files
- `app/models.py` — SQLAlchemy ORM:
  - `HealthSample` / `CategorySample` / `Workout` — health data
  - `PendingWrite` — web → HealthKit queue
  - `PendingDeletion` — web → HealthKit delete queue
  - `IngestRule` — configurable validation rules (value_range, blocked_source) with hit counters
  - `IngestBlacklist` — UUIDs never to insert (auto-populated by trigger on DELETE)
  - `SyncLog` — sync audit log
- `app/routers/ingest.py` — POST batch endpoints; applies `IngestRule` filters + blacklist check
- `app/routers/query.py` — GET endpoints with aggregation (hourly/daily/weekly/monthly), filters (sources, devices, value range), correlated samples, bulk delete
- `app/routers/write.py` — bidirectional write queue (web → Apple Health)
- `app/routers/delete.py` — deletion plan/confirm/fail workflow
- `app/routers/rules.py` — CRUD for ingest rules, hit counters, summary
- `app/routers/blacklist.py` — list/add/remove UUIDs in blacklist; `purge-and-blacklist` to delete + blacklist in one step
- `app/schemas.py` — Pydantic request/response models
- `alembic/versions/87f97b75eed7_auto_blacklist_trigger.py` — PG trigger for auto-blacklist on DELETE

### Main API Endpoints

**Ingest / Query**
- `POST /api/v1/samples/batch` — ingest quantity samples (filtered by rules + blacklist)
- `POST /api/v1/categories/batch`, `POST /api/v1/workouts/batch`
- `GET /api/v1/samples?type=...&start=...&end=...&aggregation=daily&sources=X&devices=Y&value_min=&value_max=` — query with filters
- `GET /api/v1/samples/types` — list available types with counts
- `GET /api/v1/samples/latest?type=...` — latest sample per type
- `GET /api/v1/samples/facets?type=...` — distinct sources/devices + value range for a type
- `GET /api/v1/samples/{id}/correlated?types=...&minutes=5` — samples within time window
- `POST /api/v1/samples/bulk-delete` — delete by IDs (trigger auto-blacklists)
- `GET /api/v1/sync/status[?include_types=true]` — fast totals via pg_class.reltuples
- `GET /api/v1/sync/sessions?limit=10` — recent sync sessions (groups sync_log entries with <5 min gap)

**Write / Delete (web ↔ Apple Health)**
- `POST /api/v1/write` — queue a write for Apple Health
- `GET /api/v1/write/pending` — iOS polls
- `POST /api/v1/write/{id}/confirm|fail`
- `GET /api/v1/write/recent` — dashboard feedback
- `POST /api/v1/delete/plan` — plan bulk deletion
- `GET /api/v1/delete/pending`, `POST /api/v1/delete/{id}/confirm|fail`

**Rules**
- `GET|POST /api/v1/rules` — list/create
- `PATCH|DELETE /api/v1/rules/{id}` — update/remove
- `POST /api/v1/rules/{id}/reset-stats`
- `GET /api/v1/rules/summary` — counts

**Blacklist**
- `GET /api/v1/blacklist` — list
- `POST /api/v1/blacklist/add` — add UUIDs
- `POST /api/v1/blacklist/purge-and-blacklist` — delete + blacklist matching samples
- `DELETE /api/v1/blacklist/{id}`

### Ingest Rules (DB-configurable via `/api/v1/rules`)
Two rule types:
- `value_range` — discards if value outside [value_min, value_max] for `type_identifier`
- `blocked_source` — discards if `source_name` matches (optional per-type constraint)

Each rule has `hits_count` + `last_hit_at` updated on each discard. UI in dashboard `/settings`.

## iOS App

### Requirements
- Xcode 16+, iOS 17+, physical iPhone
- HealthKit capability + entitlements (`com.apple.developer.healthkit`, `com.apple.developer.healthkit.background-delivery`)
- `NSHealthShareUsageDescription` + `NSHealthUpdateUsageDescription` in Info.plist
- `BGTaskSchedulerPermittedIdentifiers` for background refresh

### Key Files
- `Services/HealthKitManager.swift`:
  - Authorization request (read + write for body/nutrition)
  - Fetch quantity/category/workout samples with date windows
  - Write samples (`writeQuantitySample`)
  - Delete samples by UUID
  - **`startObservingNewSamples`**: `HKObserverQuery` + background delivery for all read types
- `Services/SyncService.swift` — orchestrates full sync cycle:
  1. Process pending writes (web → HealthKit)
  2. Process pending deletions
  3. Sync quantity types (non-deferred)
  4. Sync category types
  5. Sync workouts
  6. Sync deferred types (if configured)
  - `performQuickSync(minInterval:)` — throttled trigger for auto-sync
  - Persists last sync summary (log, duration, samples) via UserDefaults
- `Services/APIClient.swift` — HTTP client with retry + timeout; endpoints for samples/writes/deletions
- `Services/BackgroundTaskManager.swift` — `BGAppRefreshTask` scheduling
- `Views/ContentView.swift` — TabView: Sync (default), Dashboard, Settings
- `Views/SyncStatusView.swift` — live sync progress + persistent "last sync" summary with timing, samples, full log
- `Views/DashboardView.swift` — today's metrics (weight, steps, calories, body fat, BMI) from HealthKit directly
- `Views/SettingsView.swift` — server URL config only

### Auto-sync Triggers
- App launch (throttled to 10 min)
- App returns to foreground (throttled to 10 min)
- `HKObserverQuery` notification (throttled to 2 min via `performQuickSync`)
- `BGAppRefreshTask` (iOS-managed, ~hourly best case)

### Build
1. Open `ios/HealthTracker/HealthTracker.xcodeproj`
2. Signing: set team + unique bundle ID
3. Connect iPhone, ⌘+R

## Dashboard

### Setup
```bash
cd dashboard
npm install
VITE_API_URL=http://192.168.68.166:8000 npm run dev
```

### Deploy
```bash
cd dashboard
docker compose up -d --build
# http://192.168.68.190
```

### Key Files
- `src/lib/api.ts` — `apiGet` / `apiPost` / `apiPatch` / `apiDelete`, array params supported
- `src/lib/queries.ts` — React Query hooks: samples, facets, writes, rules, blacklist, bulk-delete
- `src/lib/healthkit.ts` — HK type → label/unit/color/multiplier mapping + categories
- `src/components/TypeBrowser.tsx` — reusable chart+table for single-type browsing
- `src/components/BodyBrowser.tsx` — specialized Body page: parallel fetch of all body types, tooltip shows all values at point, row-level delete with correlated samples dialog
- `src/components/FilterBar.tsx` — date range, sources, devices, value min/max filter UI
- `src/components/SampleTable.tsx` — paginated raw samples table, optional `onDelete` prop for trash button
- `src/components/charts/TimeSeriesChart.tsx` — Recharts wrapper with autoscale Y-axis + multi-year date formatting
- `src/pages/Settings.tsx` — rules CRUD + blacklist management + hit stats

### Pages
- `/` — Home: today's metrics, weekly charts, sync status, last 10 sync sessions table
- `/activity` — Steps, distance, flights, calories
- `/vitals` — Heart rate, HRV, SpO2, blood pressure, respiratory rate
- `/body` — Weight/BMI/body fat/lean mass with multi-value tooltip + row delete
- `/sleep` — Sleep analysis with stacked bar per night
- `/workouts` — Workout list + weekly frequency chart + filters
- `/nutrition` — Calories, macros, water, caffeine
- `/fitness` — VO2 max, running/cycling/walking advanced metrics, stair speeds
- `/explore` — Universal: select any type, view chart + raw table + filters
- `/insert` — Form to write body/nutrition data to Apple Health via backend
- `/settings` — Ingest rules management, blacklist UUIDs, stats
