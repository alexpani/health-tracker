# CLAUDE.md

## Project Overview

Health Tracker Bridge: a bidirectional bridge between Apple Health and web applications. HealthKit is only accessible from native iOS apps, so this system syncs all health data to a backend database and exposes REST APIs for web apps to consume and write back.

## Architecture

```
iPhone (SwiftUI + HealthKit) ←→ FastAPI Backend (Proxmox LXC) ←→ Web Dashboard (React)
                                      ↕
                                 PostgreSQL
```

- **iOS App** (`ios/`): SwiftUI + HealthKit, reads/writes Apple Health data, syncs to backend
- **Backend** (`backend/`): FastAPI + SQLAlchemy + PostgreSQL, REST API for ingest/query/write/delete
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
- **Deferred types**: HeartRate and HRV are synced LAST to not block lighter types (weight, sleep, workouts).
- **Server-side ingest filters**: samples outside configured value ranges are silently discarded (prevents re-importing spurious data from shared devices like Withings scales).
- **Bidirectional writes**: web apps POST to `/api/v1/write`, iOS polls pending writes and saves to HealthKit via `HKHealthStore.save()`.

## Backend

### Setup
```bash
cd backend
docker compose up -d
docker compose exec api alembic revision --autogenerate -m "description"
docker compose exec api alembic upgrade head
```

### Key Files
- `app/models.py` — SQLAlchemy ORM (HealthSample, CategorySample, Workout, PendingWrite, PendingDeletion, SyncLog)
- `app/routers/ingest.py` — POST batch endpoints with validation filters
- `app/routers/query.py` — GET endpoints with aggregation (hourly/daily/weekly/monthly)
- `app/routers/write.py` — bidirectional write queue (web → Apple Health)
- `app/routers/delete.py` — deletion plan/confirm/fail workflow
- `app/schemas.py` — Pydantic request/response models
- `docker-compose.yml` — PostgreSQL 16 + API container

### API Endpoints
- `POST /api/v1/samples/batch` — ingest quantity samples
- `POST /api/v1/categories/batch` — ingest category samples
- `POST /api/v1/workouts/batch` — ingest workouts
- `GET /api/v1/samples?type=...&start=...&end=...&aggregation=daily` — query with aggregation
- `GET /api/v1/samples/types` — list all types with counts
- `GET /api/v1/samples/latest?type=...` — latest sample for a type
- `GET /api/v1/sync/status` — sync status (fast via pg_class.reltuples)
- `POST /api/v1/write` — queue a write for Apple Health
- `GET /api/v1/write/pending` — iOS polls for pending writes
- `POST /api/v1/delete/plan` — plan bulk deletion with criteria

### Ingest Filters
Configured in `app/routers/ingest.py` `SAMPLE_FILTERS` dict. Samples outside these ranges are silently discarded:
- BodyMass: 70-200 kg
- BMI: 18-50
- BodyFatPercentage: 0.01-0.60
- LeanBodyMass: 45-150 kg

## iOS App

### Requirements
- Xcode 16+, iOS 17+, physical iPhone (HealthKit requires real device)
- HealthKit capability + entitlements
- `NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription` in Info.plist

### Key Files
- `Services/HealthKitManager.swift` — HealthKit authorization, fetch (read), write, delete
- `Services/SyncService.swift` — orchestrates full sync cycle with progress tracking
- `Services/APIClient.swift` — HTTP client (URLSession) with retry logic
- `Services/BackgroundTaskManager.swift` — BGAppRefreshTask for periodic sync
- `Views/SyncStatusView.swift` — sync UI with progress bars and stop button

### Sync Flow
1. Process pending writes (web → Apple Health)
2. Process pending deletions
3. Sync quantity types (non-deferred: steps, weight, SpO2, etc.)
4. Sync category types (sleep, stand hours, etc.)
5. Sync workouts
6. Sync deferred types (HeartRate, HRV — heaviest, done last)

### Build & Run
1. Open `ios/HealthTracker/HealthTracker.xcodeproj` in Xcode
2. Set signing team and bundle identifier
3. Connect iPhone, select as destination
4. ⌘+R to build and run

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
# Accessible at http://192.168.68.190
```

### Key Files
- `src/lib/api.ts` — API client (apiGet, apiPost)
- `src/lib/queries.ts` — React Query hooks for all endpoints
- `src/lib/healthkit.ts` — HK type → label/unit/color mapping
- `src/components/TypeBrowser.tsx` — reusable chart+table browser per type
- `src/pages/Insert.tsx` — form to write data back to Apple Health

### Pages
- `/` — Home: today's metrics, weekly charts, sync status
- `/activity` — Steps, distance, flights, calories (tabbed)
- `/vitals` — Heart rate, HRV, SpO2, blood pressure, respiratory rate
- `/body` — Weight, BMI, body fat, lean mass
- `/sleep` — Sleep analysis with stacked bar chart per night
- `/workouts` — Workout list with filters and weekly frequency chart
- `/nutrition` — Calories, macros, water, caffeine
- `/explore` — Universal: select any type, view chart + raw table
- `/insert` — Write body/nutrition data to Apple Health via backend
