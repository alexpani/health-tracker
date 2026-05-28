#!/usr/bin/env bash
# Deploy idempotente del MCP server sulla LXC ealth-mcp (192.168.68.100).
# Eseguire dal Mac, working dir = root del repo.
set -euo pipefail

HOST="${HEALTH_MCP_HOST:-root@192.168.68.100}"
APP_DIR="/opt/health-mcp"
ENV_DIR="/etc/health-mcp"

cd "$(dirname "$0")/.."  # cd mcp/

echo "==> Sync codice → ${HOST}:${APP_DIR}"
ssh "$HOST" "mkdir -p ${APP_DIR} ${ENV_DIR} && rm -rf ${APP_DIR}/health_mcp"

# Trasferisce src/ + pyproject.toml + requirements.txt + deploy/.
# Esclude .venv e file locali.
rsync -avz --delete \
  --exclude='.venv' --exclude='__pycache__' --exclude='.env' --exclude='*.pyc' \
  src pyproject.toml requirements.txt deploy scripts metrics.yaml \
  "$HOST:${APP_DIR}/"

# Primo run: copia il systemd unit se assente o se diverso.
echo "==> Install systemd unit"
ssh "$HOST" "install -m 644 ${APP_DIR}/deploy/health-mcp.service /etc/systemd/system/health-mcp.service && systemctl daemon-reload"

# Crea o aggiorna venv, installa deps.
echo "==> venv + deps"
ssh "$HOST" "
  set -e
  cd ${APP_DIR}
  if [ ! -d .venv ]; then
    python3 -m venv .venv
  fi
  .venv/bin/pip install --upgrade pip --quiet
  .venv/bin/pip install -e . --quiet
"

# Controllo che .env esista lato server. Se no, abort con messaggio chiaro.
echo "==> check env file"
ssh "$HOST" "
  if [ ! -f ${ENV_DIR}/env ]; then
    echo 'ERR: ${ENV_DIR}/env non esiste. Crealo con i valori reali (vedi mcp/.env.example).'
    exit 1
  fi
  chmod 600 ${ENV_DIR}/env
"

echo "==> restart"
ssh "$HOST" "systemctl enable --now health-mcp && systemctl restart health-mcp"
sleep 1
ssh "$HOST" "systemctl status health-mcp --no-pager -l | head -n 20"

echo
echo "==> health check"
ssh "$HOST" "curl -fsS http://127.0.0.1:8765/healthz" && echo
echo "==> done."
