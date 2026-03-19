#!/usr/bin/env bash
set -euo pipefail

WIREGATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_URL="${1:-${REPO_URL:-}}"
SERVICE_FILE="/etc/systemd/system/wiregate.service"
SUDOERS_FILE="/etc/sudoers.d/wiregate"
CHOSEN_PORT=""

ensure_git_safe_directory() {
  local repo_dir="$1"
  git config --global --add safe.directory "${repo_dir}" >/dev/null 2>&1 || true
}

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

ensure_base_packages() {
  local packages=()

  if ! command -v git >/dev/null 2>&1; then
    packages+=(git)
  fi

  if ! command -v ss >/dev/null 2>&1; then
    packages+=(iproute2)
  fi

  if ! command -v iptables >/dev/null 2>&1; then
    packages+=(iptables)
  fi

  if ! command -v make >/dev/null 2>&1; then
    packages+=(build-essential)
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    packages+=(python3)
  fi

  if [[ "${#packages[@]}" -gt 0 ]]; then
    echo "Installing required base packages: ${packages[*]}"
    apt update
    apt install -y "${packages[@]}"
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

sync_existing_repo() {
  local repo_dir="$1"
  local branch remote_ref current_commit remote_commit

  ensure_git_safe_directory "${repo_dir}"

  branch="$(git -C "${repo_dir}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  if [[ -z "${branch}" || "${branch}" == "HEAD" ]]; then
    branch="main"
  fi

  echo "Fetching latest code from origin/${branch}..."
  git -C "${repo_dir}" fetch --all --prune

  remote_ref="origin/${branch}"
  if ! git -C "${repo_dir}" rev-parse --verify "${remote_ref}" >/dev/null 2>&1; then
    remote_ref="origin/main"
  fi

  current_commit="$(git -C "${repo_dir}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  remote_commit="$(git -C "${repo_dir}" rev-parse --short "${remote_ref}" 2>/dev/null || echo unknown)"

  echo "Syncing tracked files from ${current_commit} to ${remote_commit} (${remote_ref})..."
  git -C "${repo_dir}" reset --hard "${remote_ref}"
  git -C "${repo_dir}" clean -fd
}

sync_repo() {
  if [[ "${SKIP_REPO_SYNC:-false}" == "true" ]]; then
    echo "Skipping repository sync because SKIP_REPO_SYNC=true."
    return
  fi

  if [[ -d "${WIREGATE_DIR}/.git" ]]; then
    echo "Git repository detected. Force-syncing latest tracked changes..."
    sync_existing_repo "${WIREGATE_DIR}"
    return
  fi

  if [[ -n "${REPO_URL}" ]]; then
    TARGET_DIR="/opt/wiregate"
    if [[ -d "${TARGET_DIR}/.git" ]]; then
      echo "Updating ${TARGET_DIR}..."
      sync_existing_repo "${TARGET_DIR}"
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

enforce_production_mode() {
  write_env_value DEMO_MODE false
}

is_placeholder_value() {
  local value="$1"
  [[ -z "${value}" || "${value}" == YOUR_* ]]
}

default_env_value() {
  local key="$1"
  local fallback="$2"
  local current
  current="$(read_env_value "${key}")"

  if [[ -z "${current}" ]]; then
    write_env_value "${key}" "${fallback}"
    echo "${fallback}"
    return
  fi

  echo "${current}"
}

get_primary_ip() {
  hostname -I | awk '{print $1}'
}

get_default_interface() {
  ip route show default | awk 'NR==1 {print $5}'
}

ensure_ip_forwarding() {
  cat >/etc/sysctl.d/99-wiregate.conf <<EOF
net.ipv4.ip_forward=1
EOF
  sysctl --system >/dev/null
}

extract_private_key_from_config() {
  local config_file="$1"
  awk -F ' = ' '/^PrivateKey = / {print $2; exit}' "${config_file}"
}

ensure_wireguard_bootstrap() {
  local auto_setup iface subnet listen_port endpoint config_file private_key_file public_key_file private_key public_key outbound_iface

  auto_setup="$(default_env_value AUTO_SETUP_WIREGUARD true)"

  if [[ "${auto_setup,,}" != "true" ]]; then
    echo "Automatic WireGuard bootstrap disabled. Skipping interface setup."
    return
  fi

  iface="$(default_env_value WG_INTERFACE wg0)"
  subnet="$(default_env_value WG_SUBNET 10.0.0)"
  listen_port="$(default_env_value WG_SERVER_PORT 51820)"
  endpoint="$(read_env_value WG_SERVER_ENDPOINT)"

  config_file="/etc/wireguard/${iface}.conf"
  private_key_file="/etc/wireguard/${iface}.key"
  public_key_file="/etc/wireguard/${iface}.pub"

  mkdir -p /etc/wireguard
  chmod 700 /etc/wireguard

  if [[ -f "${config_file}" ]]; then
    echo "Existing WireGuard config detected at ${config_file}. Syncing keys into WireGate."
    private_key="$(extract_private_key_from_config "${config_file}")"
    if [[ -n "${private_key}" ]]; then
      public_key="$(printf '%s' "${private_key}" | wg pubkey)"
    fi
  else
    echo "No WireGuard config found for ${iface}. Bootstrapping a new server interface."
    outbound_iface="$(get_default_interface)"

    if [[ -z "${outbound_iface}" ]]; then
      echo "Unable to detect the default outbound network interface for NAT."
      exit 1
    fi

    umask 077
    private_key="$(wg genkey)"
    public_key="$(printf '%s' "${private_key}" | wg pubkey)"
    printf '%s\n' "${private_key}" >"${private_key_file}"
    printf '%s\n' "${public_key}" >"${public_key_file}"
    ensure_ip_forwarding

    cat >"${config_file}" <<EOF
[Interface]
Address = ${subnet}.1/24
ListenPort = ${listen_port}
PrivateKey = ${private_key}
SaveConfig = true
PostUp = iptables -A FORWARD -i ${iface} -j ACCEPT; iptables -A FORWARD -o ${iface} -j ACCEPT; iptables -t nat -A POSTROUTING -s ${subnet}.0/24 -o ${outbound_iface} -j MASQUERADE
PostDown = iptables -D FORWARD -i ${iface} -j ACCEPT; iptables -D FORWARD -o ${iface} -j ACCEPT; iptables -t nat -D POSTROUTING -s ${subnet}.0/24 -o ${outbound_iface} -j MASQUERADE
EOF
    chmod 600 "${config_file}" "${private_key_file}" "${public_key_file}"

    echo "Enabling wg-quick@${iface}.service"
    systemctl enable --now "wg-quick@${iface}"
  fi

  if [[ -z "${public_key:-}" ]]; then
    echo "Unable to determine the WireGuard server public key for ${iface}."
    exit 1
  fi

  write_env_value WG_SERVER_PUBLIC_KEY "${public_key}"

  if is_placeholder_value "${endpoint}"; then
    endpoint="$(get_primary_ip)"
    if [[ -n "${endpoint}" ]]; then
      write_env_value WG_SERVER_ENDPOINT "${endpoint}"
      echo "WG_SERVER_ENDPOINT was not set. Using detected server IP ${endpoint}."
    fi
  fi

  echo "WireGuard bootstrap complete for production mode."
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

record_installed_version() {
  if command -v node >/dev/null 2>&1; then
    echo "Recording installed app version..."
    node "${WIREGATE_DIR}/backend/scripts/record-version.js" install >/dev/null 2>&1 || true
  fi
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

  if [[ "${SKIP_WIREGATE_RESTART:-false}" == "true" ]]; then
    echo "Skipping wiregate service restart because SKIP_WIREGATE_RESTART=true."
  else
    systemctl restart wiregate
  fi
}

print_summary() {
  local server_ip
  local iface
  local endpoint
  local public_key
  server_ip="$(hostname -I | awk '{print $1}')"
  iface="$(read_env_value WG_INTERFACE)"
  endpoint="$(read_env_value WG_SERVER_ENDPOINT)"
  public_key="$(read_env_value WG_SERVER_PUBLIC_KEY)"
  echo
  echo "WireGate is installed."
  echo "Backend port: ${CHOSEN_PORT}"
  echo "Panel URL: http://${server_ip}:${CHOSEN_PORT}"
  echo "WireGuard interface: ${iface:-wg0}"
  echo "WireGuard endpoint: ${endpoint:-not set}"
  echo "WireGuard public key: ${public_key:-not set}"
  echo "Private key is stored on the server in /etc/wireguard/${iface:-wg0}.conf and /etc/wireguard/${iface:-wg0}.key"
}

print_banner
require_root
ensure_base_packages
ensure_wireguard
ensure_node
sync_repo
prepare_env
enforce_production_mode
choose_backend_port
ensure_wireguard_bootstrap
install_dependencies
configure_sudoers
configure_service
record_installed_version
print_summary
