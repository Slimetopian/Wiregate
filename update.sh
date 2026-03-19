#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${REPO_DIR}/backend/data"
STATUS_FILE="${DATA_DIR}/update-status.json"
LOG_FILE="${DATA_DIR}/update.log"
PID_FILE="${DATA_DIR}/update.pid"
BACKUP_DIR="${DATA_DIR}/update-backup"
ENV_FILE="${REPO_DIR}/.env"
BACKUP_ENV_FILE="${BACKUP_DIR}/.env.backup"
BACKUP_USERS_DIR="${BACKUP_DIR}/users-data"

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
  local branch="${4:-${BRANCH:-unknown}}"
  local current_commit="${5:-${CURRENT_COMMIT:-null}}"
  local remote_commit="${6:-${REMOTE_COMMIT:-null}}"
  local update_available="${7:-${UPDATE_AVAILABLE:-null}}"
  cat >"${STATUS_FILE}" <<EOF
{
  "branch": "$(json_escape "${branch}")",
  "currentCommit": $(if [[ "${current_commit}" == "null" || -z "${current_commit}" ]]; then printf 'null'; else printf '"%s"' "$(json_escape "${current_commit}")"; fi),
  "remoteCommit": $(if [[ "${remote_commit}" == "null" || -z "${remote_commit}" ]]; then printf 'null'; else printf '"%s"' "$(json_escape "${remote_commit}")"; fi),
  "updateAvailable": ${update_available},
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
  rm -rf "${BACKUP_DIR}"
  rm -f "${PID_FILE}"
}

finish_uptodate() {
  write_status "up-to-date" false "WireGate is already on the newest GitHub version."
  rm -rf "${BACKUP_DIR}"
  rm -f "${PID_FILE}"
}

finish_error() {
  write_status "failed" false "Update failed. Check backend/data/update.log for details."
  rm -rf "${BACKUP_DIR}"
  rm -f "${PID_FILE}"
}

backup_local_state() {
  rm -rf "${BACKUP_DIR}"
  mkdir -p "${BACKUP_DIR}"

  if [[ -f "${ENV_FILE}" ]]; then
    cp "${ENV_FILE}" "${BACKUP_ENV_FILE}"
  fi

  if [[ -d "${DATA_DIR}" ]]; then
    mkdir -p "${BACKUP_USERS_DIR}"
    find "${DATA_DIR}" -mindepth 1 -maxdepth 1 \
      ! -name 'update.log' \
      ! -name 'update-status.json' \
      ! -name 'update.pid' \
      ! -name 'update-backup' \
      -exec cp -a {} "${BACKUP_USERS_DIR}/" \;
  fi
}

restore_local_state() {
  if [[ -f "${BACKUP_ENV_FILE}" ]]; then
    cp "${BACKUP_ENV_FILE}" "${ENV_FILE}"
  fi

  if [[ -d "${BACKUP_USERS_DIR}" ]]; then
    mkdir -p "${DATA_DIR}"
    find "${BACKUP_USERS_DIR}" -mindepth 1 -maxdepth 1 -exec cp -a {} "${DATA_DIR}/" \;
  fi
}

trap finish_error ERR
trap 'restore_local_state; rm -f "${PID_FILE}"' EXIT

echo "[$(ts)] Starting WireGate update"
echo $$ >"${PID_FILE}"
write_status "running" true "Checking repository version..."

cd "${REPO_DIR}"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
CURRENT_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"

echo "[$(ts)] Preserving local configuration files"
backup_local_state

echo "[$(ts)] Fetching origin/${BRANCH}"
git fetch --all --prune

REMOTE_COMMIT="$(git rev-parse "origin/${BRANCH}" 2>/dev/null || true)"

if [[ -n "${CURRENT_COMMIT}" && -n "${REMOTE_COMMIT}" && "${CURRENT_COMMIT}" == "${REMOTE_COMMIT}" ]]; then
  UPDATE_AVAILABLE=false
  echo "[$(ts)] Already on the latest version (${CURRENT_COMMIT})"
  finish_uptodate
  exit 0
fi

UPDATE_AVAILABLE=true

echo "[$(ts)] Pulling latest code"
write_status "running" true "Pulling the newest GitHub version..."
git pull --ff-only origin "${BRANCH}"

CURRENT_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"

write_status "running" true "Installing backend dependencies..."
echo "[$(ts)] Installing backend dependencies"
npm --prefix backend install

write_status "running" true "Installing frontend dependencies..."
echo "[$(ts)] Installing frontend dependencies"
npm --prefix frontend install

write_status "running" true "Building frontend assets..."
echo "[$(ts)] Building frontend"
npm --prefix frontend run build

echo "[$(ts)] Restoring local configuration files"
restore_local_state

if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files | grep -q '^wiregate.service'; then
  write_status "running" true "Restarting WireGate service..."
  echo "[$(ts)] Restarting wiregate.service"
  systemctl restart wiregate
fi

echo "[$(ts)] Update completed successfully"
finish_success
