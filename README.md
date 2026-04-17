# Health Tracker Bridge

A bidirectional bridge between **Apple Health** and **web applications**.

Apple HealthKit is only accessible from native iOS apps. This project creates a bridge that:

1. **Reads** all health data from Apple Health (steps, heart rate, sleep, weight, workouts, nutrition, and 40+ more types)
2. **Stores** it in a PostgreSQL database via a FastAPI REST API
3. **Visualizes** it through a React web dashboard with time-series charts
4. **Writes back** body measurements and nutrition data from web apps to Apple Health

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   iPhone    │  sync   │   FastAPI + PG   │  query  │  React Dashboard│
│  (HealthKit)│ ──────► │   (Proxmox LXC)  │ ◄────── │  (Proxmox LXC)  │
│             │ ◄────── │                  │ ──────► │                 │
│  SwiftUI    │  write  │  REST API        │  write  │  Recharts       │
└─────────────┘         └──────────────────┘         └─────────────────┘
```

## Components

### Backend (`backend/`)

FastAPI + SQLAlchemy + PostgreSQL, deployed as Docker containers.

- **Ingest API**: batch POST endpoints for quantity samples, category samples, and workouts
- **Query API**: GET endpoints with aggregation (hourly, daily, weekly, monthly), pagination, and filtering
- **Write API**: queue data from web apps to be written to Apple Health by the iOS app
- **Delete API**: plan and execute bulk deletions across both backend and Apple Health
- **Deduplication**: UUID-based `ON CONFLICT DO NOTHING` — idempotent and crash-safe
- **Validation filters**: server-side rules to reject out-of-range samples (e.g., shared scale data)

### iOS App (`ios/`)

SwiftUI native app targeting iOS 17+.

- Reads 40+ HealthKit data types (steps, heart rate, sleep stages, weight, SpO2, blood pressure, workouts, nutrition, etc.)
- Incremental sync with `lastSyncDate` per type stored in SwiftData
- 90-day fetch windows to manage memory on large datasets
- Parallel HTTP uploads (4 concurrent) for throughput
- Deferred sync for heavy types (HeartRate, HRV) to not block lighter data
- Background sync via `BGAppRefreshTask`
- Writes pending data from web apps to Apple Health
- Progress tracking UI with per-type progress bars and stop button

### Dashboard (`dashboard/`)

React + Vite + TypeScript + Tailwind CSS + shadcn/ui + Recharts.

- **Home**: today's metrics (steps, calories, heart rate, weight) + weekly charts
- **Activity**: steps, distance, flights climbed, calories with configurable time range and aggregation
- **Vitals**: heart rate, HRV, SpO2, blood pressure, respiratory rate, temperature
- **Body**: weight, BMI, body fat percentage, lean body mass
- **Sleep**: sleep analysis with stacked bar chart showing sleep stages per night
- **Workouts**: filterable workout list with weekly frequency chart
- **Nutrition**: calories, macros, water, caffeine
- **Explore**: select any data type and view chart + raw data table
- **Insert**: form to write body measurements and nutrition data back to Apple Health

## Quick Start

### Prerequisites

- macOS with Xcode 16+ and an Apple Developer account
- Docker on a Linux host (or Proxmox LXC)
- Physical iPhone (HealthKit requires a real device)

### 1. Backend

```bash
cd backend
docker compose up -d

# First time: generate and apply database migration
docker compose exec api alembic revision --autogenerate -m "initial"
docker compose exec api alembic upgrade head
```

API docs: `http://<backend-ip>:8000/docs`

### 2. iOS App

1. Open `ios/HealthTracker/HealthTracker.xcodeproj` in Xcode
2. Set your signing team and a unique bundle identifier
3. Add HealthKit capability in Signing & Capabilities
4. Connect your iPhone, select it as build destination
5. `⌘+R` to build and install
6. Grant HealthKit read/write permissions when prompted
7. Go to Settings tab, set backend server URL
8. Press "Sync Now" to start syncing

### 3. Dashboard

```bash
cd dashboard

# Development
npm install
VITE_API_URL=http://<backend-ip>:8000 npm run dev

# Production (Docker)
docker compose up -d --build
```

## API Examples

```bash
# Check sync status
curl http://localhost:8000/api/v1/sync/status

# Get daily step count for last 7 days
curl "http://localhost:8000/api/v1/samples?type=HKQuantityTypeIdentifierStepCount&aggregation=daily&start=$(date -v-7d +%Y-%m-%dT00:00:00Z)"

# Get latest weight
curl "http://localhost:8000/api/v1/samples/latest?type=HKQuantityTypeIdentifierBodyMass"

# Get heart rate hourly average for today
curl "http://localhost:8000/api/v1/samples?type=HKQuantityTypeIdentifierHeartRate&aggregation=hourly&start=$(date +%Y-%m-%dT00:00:00Z)"

# Write a weight measurement (will be synced to Apple Health)
curl -X POST http://localhost:8000/api/v1/write \
  -H "Content-Type: application/json" \
  -d '{"type":"HKQuantityTypeIdentifierBodyMass","value":75.5,"unit":"kg","start_date":"2025-01-01T09:00:00Z","end_date":"2025-01-01T09:00:00Z"}'

# List all available data types
curl http://localhost:8000/api/v1/samples/types
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| iOS | Swift, SwiftUI, HealthKit, SwiftData, BGTaskScheduler |
| Backend | Python, FastAPI, SQLAlchemy (async), PostgreSQL, Alembic, Docker |
| Dashboard | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts, TanStack Query |

## License

MIT
