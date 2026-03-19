#!/usr/bin/env bash
set -euo pipefail

WIREGATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_URL="${1:-${REPO_URL:-}}"
SERVICE_FILE="/etc/systemd/system/wiregate.service"
SUDOERS_FILE="/etc/sudoers.d/wiregate"
CHOSEN_PORT=""

print_banner() {
  echo "======================================"
  echo "          WireGate Installer          "
  echo "======================================"
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "This installer must run as root."
    exit 1
  fi
}

ensure_wireguard() {
  if ! command -v wg >/dev/null 2>&1; then
    echo "Installing WireGuard..."
    apt update
    apt install -y wireguard
  fi
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
    if [[ "${NODE_MAJOR}" -ge 18 ]]; then
      return
    fi
  fi

  echo "Installing Node.js 18..."
  apt update
  apt install -y curl ca-certificates gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt update
  apt install -y nodejs
}

sync_repo() {
  if [[ -d "${WIREGATE_DIR}/.git" ]]; then
    echo "Git repository detected. Pulling latest changes..."
    git -C "${WIREGATE_DIR}" pull --ff-only || true
    return
  fi

  if [[ -n "${REPO_URL}" ]]; then
    TARGET_DIR="/opt/wiregate"
    if [[ -d "${TARGET_DIR}/.git" ]]; then
      echo "Updating ${TARGET_DIR}..."
      git -C "${TARGET_DIR}" pull --ff-only
    else
      echo "Cloning ${REPO_URL} into ${TARGET_DIR}..."
      git clone "${REPO_URL}" "${TARGET_DIR}"
    fi
    WIREGATE_DIR="${TARGET_DIR}"
  else
    echo "No git metadata found and no repository URL supplied. Continuing with local files."
  fi
}

prepare_env() {
  if [[ ! -f "${WIREGATE_DIR}/.env" ]]; then
    cp "${WIREGATE_DIR}/.env.example" "${WIREGATE_DIR}/.env"
  fi
}

read_env_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "${WIREGATE_DIR}/.env" | tail -n 1 | cut -d '=' -f 2-)"
  echo "${value}"
}

write_env_value() {
  local key="$1"
  local value="$2"

  if grep -qE "^${key}=" "${WIREGATE_DIR}/.env"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "${WIREGATE_DIR}/.env"
  else
    echo "${key}=${value}" >>"${WIREGATE_DIR}/.env"
  fi
}

is_port_in_use() {
  local port="$1"
  ss -ltnH "sport = :${port}" 2>/dev/null | grep -q .
}

choose_backend_port() {
  local desired_port candidate limit
  desired_port="$(read_env_value PORT)"
  desired_port="${desired_port:-3001}"

  if [[ -f "${SERVICE_FILE}" ]] && systemctl is-active --quiet wiregate; then
    CHOSEN_PORT="${desired_port}"
    echo "WireGate service already active. Keeping configured port ${CHOSEN_PORT}."
    return
  fi

  if ! is_port_in_use "${desired_port}"; then
    CHOSEN_PORT="${desired_port}"
    echo "Using backend port ${CHOSEN_PORT}."
    return
  fi

  echo "Port ${desired_port} is already in use. Searching for the next free port..."
  candidate=$((desired_port + 1))
  limit=$((desired_port + 50))

  while [[ "${candidate}" -le "${limit}" ]]; do
    if ! is_port_in_use "${candidate}"; then
      CHOSEN_PORT="${candidate}"
      write_env_value PORT "${CHOSEN_PORT}"
      echo "Selected backend port ${CHOSEN_PORT} and updated .env."
      return
    fi
    candidate=$((candidate + 1))
  done

  echo "No free backend port found between ${desired_port} and ${limit}."
  exit 1
}

install_dependencies() {
  echo "Installing backend dependencies..."
  npm --prefix "${WIREGATE_DIR}/backend" install

  echo "Installing frontend dependencies..."
  npm --prefix "${WIREGATE_DIR}/frontend" install

  echo "Building frontend..."
  npm --prefix "${WIREGATE_DIR}/frontend" run build
}

configure_sudoers() {
  local invoking_user="${SUDO_USER:-root}"
  cat >"${SUDOERS_FILE}" <<EOF
${invoking_user} ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick
EOF
  chmod 440 "${SUDOERS_FILE}"
}

configure_service() {
  local node_path
  node_path="$(command -v node)"

  cat >"${SERVICE_FILE}" <<EOF
[Unit]
Description=WireGate backend service
After=network.target

[Service]
Type=simple
WorkingDirectory=${WIREGATE_DIR}/backend
ExecStart=${node_path} server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
User=root
Group=root

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable wiregate
  systemctl restart wiregate
}

print_summary() {
  local server_ip
  server_ip="$(hostname -I | awk '{print $1}')"
  echo
  echo "WireGate is installed."
  echo "Backend port: ${CHOSEN_PORT}"
  echo "Panel URL: http://${server_ip}:${CHOSEN_PORT}"
  echo "Edit ${WIREGATE_DIR}/.env with your real WireGuard values."
  echo "Set DEMO_MODE=false before production use."
}

print_banner
require_root
ensure_wireguard
ensure_node
sync_repo
prepare_env
choose_backend_port
install_dependencies
configure_sudoers
configure_service
print_summary
