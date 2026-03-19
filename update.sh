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

git config --global --add safe.directory "${REPO_DIR}" >/dev/null 2>&1 || true

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
  write_status "completed" false "Installer update completed successfully."
  rm -f "${PID_FILE}"
}

finish_error() {
  write_status "failed" false "Installer update failed. Check backend/data/update.log for details."
  rm -f "${PID_FILE}"
}

trap finish_error ERR
trap 'rm -f "${PID_FILE}"' EXIT

echo "[$(ts)] Starting WireGate installer update"
echo $$ >"${PID_FILE}"
write_status "running" true "Running install.sh..."

cd "${REPO_DIR}"

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
CURRENT_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
REMOTE_COMMIT="$(git rev-parse "origin/${BRANCH}" 2>/dev/null || true)"
FORCE_INSTALL="${FORCE_INSTALL:-false}"

if [[ "${FORCE_INSTALL,,}" == "true" ]]; then
  echo "[$(ts)] Repair mode requested. Running the installer again."
  write_status "running" true "Repair mode requested. Running install.sh..."
else
  echo "[$(ts)] Update requested. Running the installer to pull and rebuild the latest site."
  write_status "running" true "Update requested. Running install.sh..."
fi

echo "[$(ts)] Executing install.sh"
if [[ "${EUID}" -eq 0 ]]; then
  SKIP_WIREGATE_RESTART=true ./install.sh
else
  sudo SKIP_WIREGATE_RESTART=true ./install.sh
fi

CURRENT_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
REMOTE_COMMIT="$(git rev-parse "origin/${BRANCH}" 2>/dev/null || true)"
UPDATE_AVAILABLE=false

echo "[$(ts)] Installer update completed successfully"
finish_success

if command -v node >/dev/null 2>&1; then
  node "${REPO_DIR}/backend/scripts/record-version.js" update >/dev/null 2>&1 || true
fi

if command -v systemctl >/dev/null 2>&1; then
  echo "[$(ts)] Restarting wiregate.service after successful update"
  systemctl restart wiregate || true
fi
