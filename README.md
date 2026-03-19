# WireGate

Browser-based admin panel for managing WireGuard VPN users.
Run it on your Ubuntu server and manage users from any browser on your network.
No cloud services. No subscriptions. Fully open source.

## Screenshots
[placeholder — add screenshots after UI is built]

## Features
- Add and remove WireGuard VPN users with one click
- Download or scan a QR code for the VPN config file
- Live dashboard showing connected users and server stats
- Start, stop and restart WireGuard from the browser
- Live terminal output for WireGuard start, stop, and restart actions
- Browser toggle for switching between test mode and production mode
- One-click updater that pulls the newest GitHub version and rebuilds the app
- Demo mode for testing without a real WireGuard server
- One-command install script for Ubuntu

## Requirements
- Ubuntu 22.04 or later
- WireGuard installed and configured
- Node.js 18+
- A WireGuard interface (`wg0`) already set up

## Quick install (Ubuntu)
This is the fastest path on a fresh Ubuntu server. The installer checks and installs the required repo dependencies, including Node.js 18+, WireGuard, `git`, and `iproute2` when they are missing.

```bash
git clone https://github.com/Slimetopian/wiregate.git
cd wiregate
chmod +x install.sh
sudo ./install.sh
```

## Ubuntu installation plan
WireGate depends on a small set of packages and services on the server. The installer handles these automatically where possible.

### Repo requirements for Ubuntu
Before WireGate can manage a real VPN server, the host needs:
- Ubuntu 22.04 or later
- a WireGuard server config file, usually `/etc/wireguard/wg0.conf`
- the `wireguard` package installed
- Node.js 18 or newer
- `systemd` available for the `wiregate` service and optional `wg-quick@wg0` service
- network access to install packages and clone the repository

### Packages the installer checks or installs
- `wireguard` — required for `wg` and `wg-quick`
- `nodejs` 18+ — required to run the backend and build the frontend
- `git` — required when pulling or cloning the repository on the server
- `iproute2` — provides `ss`, used by the installer for automatic port conflict checks
- `curl`, `ca-certificates`, `gnupg` — used when installing Node.js from NodeSource

### Services used by WireGate
- `wiregate.service` — the browser admin panel backend, installed and enabled by `install.sh`
- `wg-quick@wg0.service` — optional but recommended if you want the WireGuard interface itself to come up automatically on boot

### Install Node.js manually on Ubuntu
If you want to install Node.js yourself before running WireGate, use:

```bash
sudo apt update
sudo apt install -y curl ca-certificates gnupg
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
sudo apt update
sudo apt install -y nodejs
node -v
npm -v
```

### Install WireGuard manually on Ubuntu
If WireGuard is not already present, install it with:

```bash
sudo apt update
sudo apt install -y wireguard
wg --version
```

### Enable the WireGuard service on boot
If your server interface is `wg0`, make sure the service is enabled:

```bash
sudo systemctl enable --now wg-quick@wg0
sudo systemctl status wg-quick@wg0
```

If your interface uses a different name, replace `wg0` with that interface name.

### Minimal WireGuard server prep before installing WireGate
WireGate expects a working WireGuard server interface. A common sequence is:

```bash
sudo mkdir -p /etc/wireguard
sudo nano /etc/wireguard/wg0.conf
sudo chmod 600 /etc/wireguard/wg0.conf
sudo systemctl enable --now wg-quick@wg0
sudo wg show
```

After that, set the matching values in `.env`, especially `WG_INTERFACE`, `WG_SERVER_PORT`, `WG_SERVER_PUBLIC_KEY`, `WG_SERVER_ENDPOINT`, and `DEMO_MODE=false`.

### Recommended Ubuntu setup order
1. Install Ubuntu 22.04 or later.
2. Make sure your WireGuard server config already exists, usually at `/etc/wireguard/wg0.conf`.
3. Clone this repository to the server.
4. Run `sudo ./install.sh`.
5. Edit `.env` with real server values and set `DEMO_MODE=false`.
6. Restart WireGate with `sudo systemctl restart wiregate`.
7. If you want the VPN interface to start on boot, run `sudo systemctl enable --now wg-quick@wg0`.

### What the installer does
1. Confirms it is running as root.
2. Installs required base packages if missing.
3. Installs WireGuard if missing.
4. Installs Node.js 18+ if missing.
5. Copies `.env.example` to `.env` when needed.
6. Checks whether the default backend port is already in use.
7. Chooses the next free backend port automatically if needed and writes it to `.env`.
8. Runs `npm install` in both `backend/` and `frontend/`.
9. Builds the frontend for production.
10. Creates and enables the `wiregate` systemd service.
11. Writes the sudoers rule required for `wg` and `wg-quick`.
12. Prints the final URL using the chosen backend port.

### Recommended post-install checks
```bash
sudo systemctl status wiregate
sudo journalctl -u wiregate -n 100 --no-pager
sudo systemctl status wg-quick@wg0
ss -ltnp | grep 3001
```

If the installer selected a different port because `3001` was in use, check the value in `.env` and use that port instead.

## Manual setup
1. Clone the repository.
2. Run `npm install` inside `backend/`.
3. Run `npm install` inside `frontend/`.
4. Copy `.env.example` to `.env`.
5. Fill in the environment values.
6. Start the backend with `npm run dev` inside `backend/`.
7. Start the frontend with `npm run dev` inside `frontend/`.
8. Open `http://localhost:5173`.

## Environment variables
| Variable | Description |
| --- | --- |
| `PORT` | Backend port used by the Express server |
| `FRONTEND_URL` | Allowed browser origin for CORS during development |
| `WG_INTERFACE` | WireGuard interface name, usually `wg0` |
| `WG_SERVER_ENDPOINT` | Public IP or hostname clients use to connect |
| `WG_SERVER_PORT` | WireGuard listen port |
| `WG_SERVER_PUBLIC_KEY` | Public key of the server interface |
| `WG_SUBNET` | First three octets of the WireGuard subnet, for example `10.0.0` |
| `WG_DNS` | DNS server pushed to clients |
| `DEMO_MODE` | When `true`, skips real WireGuard commands and returns safe demo data |
| `ENABLE_COMMAND_CENTER` | When `true`, enables safe preset admin commands from the Settings page |

## Demo mode
Set `DEMO_MODE=true` to run WireGate on any OS without WireGuard installed.
This uses fake status, peer and system data so the UI can be tested safely.

From the Settings page, you can switch between test mode and production mode from the UI. Production mode still requires real values for `WG_INTERFACE`, `WG_SERVER_ENDPOINT`, `WG_SERVER_PORT`, `WG_SERVER_PUBLIC_KEY`, and `WG_SUBNET`.

## Command center
`ENABLE_COMMAND_CENTER` is enabled by default in `.env.example`. The Settings page exposes safe preset terminal actions such as service status, service logs, and WireGuard service restarts.

This is intended for local network administration only.

## Updating WireGate
From the Settings page, use the `Update from GitHub` button to:
- check whether a newer GitHub version exists before doing anything
- pull the newest repository version only when an update is available
- reinstall backend and frontend dependencies
- rebuild the frontend
- restart the `wiregate` service
- preserve the existing `.env` file and the saved user data in `backend/data/`

You can also run the updater manually on Ubuntu:

```bash
cd wiregate
sudo bash ./update.sh
```

## Security note
WireGate should only be reachable on your local network or behind a VPN.
Never expose port 3001 directly to the public internet.
The panel has no authentication by default, so add HTTP auth, a reverse proxy policy, or a network-level control if you need extra protection.
Private keys are generated and delivered once, then discarded.

## Running locally for development
Open two terminals.

Backend:
```bash
cd backend
cp ../.env.example .env
npm install
npm run dev
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

## Running on a real Ubuntu server
```bash
ssh user@your-server-ip
git clone https://github.com/Slimetopian/wiregate.git
cd wiregate
chmod +x install.sh
sudo ./install.sh
sudo nano .env
sudo systemctl restart wiregate
sudo systemctl enable --now wg-quick@wg0
```

If you prefer not to use the installer for prerequisites, install them manually first:

```bash
sudo apt update
sudo apt install -y wireguard git iproute2 curl ca-certificates gnupg
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_18.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
sudo apt update
sudo apt install -y nodejs
sudo systemctl enable --now wg-quick@wg0
```

## Sudoers rule required on Ubuntu
```bash
sudo visudo -f /etc/sudoers.d/wiregate
```

Add:
```text
your_user ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick
```

The install script writes this rule automatically for the invoking user.

## License
MIT
