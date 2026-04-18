# Health Tracker Bridge

A **bidirectional** bridge between **Apple Health** and **web applications**.

Apple HealthKit is only accessible from native iOS apps. This project creates a self-hosted stack that:

1. **Reads** all health data from Apple Health (40+ types: steps, heart rate, sleep, weight, workouts, nutrition, VO2 max, running/cycling/walking metrics, and more)
2. **Stores** it in a PostgreSQL database via a FastAPI REST API
3. **Visualizes** it through a React web dashboard with time-series charts, filters, and per-type details
4. **Writes back** body measurements and nutrition data from web apps to Apple Health
5. **Deletes** samples both locally and on Apple Health from the dashboard
6. **Filters spurious data** at ingest time via DB-configurable rules + UUID blacklist (auto-populated by PG trigger on delete)

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   iPhone    │  sync   │   FastAPI + PG   │  query  │  React Dashboard│
│  (HealthKit)│ ──────► │   (Proxmox LXC)  │ ◄────── │  (Proxmox LXC)  │
│             │ ◄────── │                  │ ──────► │                 │
│  SwiftUI    │  write  │  REST API        │  write  │  Recharts       │
│             │  delete │  Rules + BL      │  delete │  shadcn/ui      │
└─────────────┘         └──────────────────┘         └─────────────────┘
```

## Components

### Backend (`backend/`)

FastAPI + SQLAlchemy (async) + PostgreSQL, deployed as Docker containers. Alembic for migrations.

- **Ingest API**: batch POST for quantity samples, category samples, workouts. Filtered through configurable rules + UUID blacklist.
- **Query API**: GET with aggregation (hourly, daily, weekly, monthly), pagination, filters (sources, devices, value range). Endpoints for facets, correlated samples, latest values.
- **Write API**: queue data from web apps; iOS polls `pending` and writes to Apple Health, confirms or fails.
- **Delete API**: plan + confirm + fail workflow for both local DB and Apple Health deletions.
- **Rules API**: CRUD for validation rules (value_range, blocked_source) with hit counters.
- **Blacklist API**: list/add/remove UUIDs; `purge-and-blacklist` to delete + blacklist atomically.
- **Trigger `trg_blacklist_on_delete`**: any DELETE on `health_samples` auto-blacklists the UUID — prevents re-ingestion on future syncs.

### iOS App (`ios/`)

SwiftUI native app targeting iOS 17+.

- **Reads** 40+ HealthKit data types
- **Incremental sync** with `lastSyncDate` per type stored in SwiftData
- **90-day fetch windows** for memory-safe sync of large datasets (heart rate, calories)
- **Parallel HTTP uploads** (4 concurrent) for throughput
- **Deferred sync** for heavy types (configurable)
- **Real-time auto-sync** via `HKObserverQuery` + background delivery — the app syncs as soon as Apple Health records new data, even when backgrounded
- **Auto-sync on launch + foreground** (10-min throttle)
- **BGAppRefreshTask** fallback (hourly best case)
- **Writes pending data** from web apps to Apple Health via `HKHealthStore.save()`
- **Deletes samples** on Apple Health via `HKHealthStore.delete()`
- **Progress UI**: live per-type progress bars, sample counter, stop button, date reached
- **Persistent sync summary** (last sync log, duration, timing) across app launches

### Dashboard (`dashboard/`)

React + Vite + TypeScript + Tailwind CSS + shadcn/ui + Recharts.

**Pages:**
- **Home** — today's metrics + weekly charts + sync status + last 10 sync sessions
- **Attivita** — steps, distance, flights, calories (tabbed, filter bar)
- **Vitali** — HR, HRV, SpO2, BP, respiratory, temperature, glucose
- **Corpo** — weight, BMI, body fat, lean mass, height, waist — with multi-value tooltip (all body metrics at the same instant) + row-level delete with correlated-samples confirmation
- **Sonno** — sleep analysis, stacked bar chart with sleep stages per night
- **Workout** — list with filters (date range, activity type, distance min/max, sources) + configurable chart aggregation (day/week/month/year) + pace column + delete with 8-second undo. Click a row for the **Apple Fitness-style detail page** with metrics, per-km splits, and time-series charts (heart rate, speed, power, cadence)
- **Nutrizione** — calories, macros, water, caffeine
- **Fitness** — VO2 max, running/cycling/walking advanced metrics, stair speeds
- **Esplora** — universal browser for any data type with filters
- **Inserisci** — form to write body/nutrition back to Apple Health
- **Impostazioni** — ingest rules CRUD, blacklist UUIDs, hit stats

**Filters** (on all type browsers):
- Precise date range (datetime pickers)
- Multiple sources (Withings, iPhone, Apple Watch, ...)
- Multiple devices
- Value min/max

## Quick Start

### Prerequisites
- macOS + Xcode 16+ + Apple Developer account (personal team OK)
- Docker host (Proxmox LXC, bare Linux, or macOS)
- Physical iPhone

### 1. Backend

```bash
cd backend
docker compose up -d
docker compose exec api alembic upgrade head
```

Open `http://<backend-ip>:8000/docs` for the Swagger UI.

### 2. iOS App

1. Open `ios/HealthTracker/HealthTracker.xcodeproj` in Xcode
2. Set signing team + a unique bundle identifier
3. Ensure HealthKit capability is enabled (Signing & Capabilities)
4. Connect your iPhone, select as build destination, ⌘+R
5. Grant read/write permissions when prompted
6. Open **Settings** tab, set server URL (e.g., `http://192.168.68.166:8000`)
7. Press **Sync Now** (or leave it — auto-sync will fire on launch, foreground, or when Apple Health receives new data)

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
# Sync status (fast, via pg_class)
curl http://localhost:8000/api/v1/sync/status

# Daily step count for last 7 days
curl "http://localhost:8000/api/v1/samples?type=HKQuantityTypeIdentifierStepCount&aggregation=daily&start=2025-01-01T00:00:00Z"

# Latest weight
curl "http://localhost:8000/api/v1/samples/latest?type=HKQuantityTypeIdentifierBodyMass"

# Query with filters
curl "http://localhost:8000/api/v1/samples?type=HKQuantityTypeIdentifierBodyMass&sources=Withings&value_min=70&aggregation=weekly"

# Write a weight measurement (queued; iOS will sync to Apple Health)
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

# Purge + blacklist
curl -X POST http://localhost:8000/api/v1/blacklist/purge-and-blacklist \
  -H "Content-Type: application/json" \
  -d '{"types":["HKQuantityTypeIdentifierBodyMass"],"source_name":"FooScale","reason":"cleanup"}'
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| iOS | Swift, SwiftUI, HealthKit, SwiftData, BGTaskScheduler, HKObserverQuery |
| Backend | Python, FastAPI, SQLAlchemy (async), PostgreSQL 16, Alembic, Docker |
| Dashboard | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts, TanStack Query |

## License

MIT
