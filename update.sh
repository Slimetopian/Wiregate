#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${REPO_DIR}/backend/data"
STATUS_FILE="${DATA_DIR}/update-status.json"
LOG_FILE="${DATA_DIR}/update.log"
PID_FILE="${DATA_DIR}/update.pid"

mkdir -p "${DATA_DIR}"
: >"${LOG_FILE}"
exec >>"${LOG_FILE}" 2>&1

ts() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_status() {
  local status="$1"
  local running="$2"
  local message="$3"
  cat >"${STATUS_FILE}" <<EOF
{
  "status": "${status}",
  "running": ${running},
  "message": "$(json_escape "${message}")",
  "pid": $$,
  "updatedAt": "$(ts)"
}
EOF
}

finish_success() {
  write_status "completed" false "Update completed successfully."
  rm -f "${PID_FILE}"
}

finish_error() {
  write_status "failed" false "Update failed. Check backend/data/update.log for details."
  rm -f "${PID_FILE}"
}

trap finish_error ERR
trap 'rm -f "${PID_FILE}"' EXIT

echo "[$(ts)] Starting WireGate update"
echo $$ >"${PID_FILE}"
write_status "running" true "Fetching latest repository changes..."

cd "${REPO_DIR}"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
echo "[$(ts)] Fetching origin/${BRANCH}"
git fetch --all --prune

echo "[$(ts)] Pulling latest code"
git pull --ff-only origin "${BRANCH}"

write_status "running" true "Installing backend dependencies..."
echo "[$(ts)] Installing backend dependencies"
npm --prefix backend install

write_status "running" true "Installing frontend dependencies..."
echo "[$(ts)] Installing frontend dependencies"
npm --prefix frontend install

write_status "running" true "Building frontend assets..."
echo "[$(ts)] Building frontend"
npm --prefix frontend run build

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^wiregate.service'; then
  write_status "running" true "Restarting WireGate service..."
  echo "[$(ts)] Restarting wiregate.service"
  systemctl restart wiregate
fi

echo "[$(ts)] Update completed successfully"
finish_success
