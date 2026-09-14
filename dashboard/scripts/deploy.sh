#!/usr/bin/env bash
# Deploy della dashboard sulla LXC ealth-dashboard (192.168.68.190).
#
# Il build (vite + tsc) e' fatto host-side perche' la LXC ha solo 1GB di
# RAM e i tool TS/rollup la fanno fuori in OOM. L'immagine Docker contiene
# solo nginx + `dist/`.
#
# Usage:
#   ./scripts/deploy.sh [VITE_API_URL]
#
# Default VITE_API_URL: "" (relativo, same-origin). L'nginx della dashboard
# fa da reverse proxy per `/api/*` verso il backend LXC, cosi' servendo la
# dashboard via HTTPS le fetch restano same-origin (niente mixed content, che
# Safari blocca in modo assoluto). Passa un URL assoluto solo per casi speciali.
#
# Idempotente: si puo' rilanciare quante volte si vuole.

set -euo pipefail

VITE_API_URL="${1-}"
LXC_HOST="root@192.168.68.190"
LXC_PATH="/opt/ealth-dashboard/dashboard"

cd "$(dirname "$0")/.."

echo "==> Build host-side (VITE_API_URL=$VITE_API_URL)"
rm -rf dist
VITE_API_URL="$VITE_API_URL" npm run build

echo "==> SCP artifacts to $LXC_HOST"
# Svuota la dist remota: scp -r fonde senza cancellare, quindi i bundle
# hashati dei deploy precedenti si accumulerebbero all'infinito nell'immagine.
ssh "$LXC_HOST" "rm -rf $LXC_PATH/dist"
scp -r dist Dockerfile nginx.conf docker-compose.yml .dockerignore \
    "$LXC_HOST:$LXC_PATH/"

echo "==> Build & restart container"
ssh "$LXC_HOST" "cd $LXC_PATH && docker compose up -d --build"

echo "==> Done. Dashboard at http://192.168.68.190/"
