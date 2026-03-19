const fs = require('fs');
const { execSync } = require('child_process');
const envStore = require('./env-store');

function run(command) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: '/bin/bash',
  }).trim();
}

function isLinux() {
  return process.platform === 'linux';
}

function isPlaceholder(value) {
  return !value || `${value}`.startsWith('YOUR_');
}

function getValue(name, fallback) {
  return process.env[name] || fallback;
}

function getPrimaryIp() {
  return run("hostname -I | awk '{print $1}'");
}

function getDefaultInterface() {
  return run("ip route show default | awk 'NR==1 {print $5}'");
}

function ensureIpForwarding() {
  fs.writeFileSync('/etc/sysctl.d/99-wiregate.conf', 'net.ipv4.ip_forward=1\n', 'utf8');
  run('sysctl --system >/dev/null');
}

function parsePrivateKeyFromConfig(configPath) {
  const content = fs.readFileSync(configPath, 'utf8');
  const match = content.match(/^PrivateKey\s*=\s*(.+)$/m);
  return match?.[1]?.trim() || '';
}

function ensureWireguardInstalled() {
  try {
    run('command -v wg');
  } catch {
    run('apt update');
    run('apt install -y wireguard');
  }
}

function ensureWireguardBootstrap() {
  if (!isLinux()) {
    throw new Error('Automatic WireGuard bootstrap only works on Linux servers.');
  }

  const autoSetup = `${process.env.AUTO_SETUP_WIREGUARD ?? 'true'}`.toLowerCase() !== 'false';
  if (!autoSetup) {
    throw new Error('AUTO_SETUP_WIREGUARD is disabled.');
  }

  ensureWireguardInstalled();

  const iface = getValue('WG_INTERFACE', 'wg0');
  const subnet = getValue('WG_SUBNET', '10.0.0');
  const port = getValue('WG_SERVER_PORT', '51820');
  const endpoint = process.env.WG_SERVER_ENDPOINT || '';
  const configPath = `/etc/wireguard/${iface}.conf`;
  const keyPath = `/etc/wireguard/${iface}.key`;
  const pubPath = `/etc/wireguard/${iface}.pub`;

  fs.mkdirSync('/etc/wireguard', { recursive: true, mode: 0o700 });

  let privateKey = '';
  let publicKey = '';

  if (fs.existsSync(configPath)) {
    privateKey = parsePrivateKeyFromConfig(configPath);
    if (privateKey) {
      publicKey = run(`printf '%s' '${privateKey}' | wg pubkey`);
    }
  } else {
    const outboundIface = getDefaultInterface();
    if (!outboundIface) {
      throw new Error('Unable to detect the default outbound interface.');
    }

    privateKey = run('wg genkey');
    publicKey = run(`printf '%s' '${privateKey}' | wg pubkey`);
    ensureIpForwarding();

    fs.writeFileSync(keyPath, `${privateKey}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(pubPath, `${publicKey}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.writeFileSync(
      configPath,
      [
        '[Interface]',
        `Address = ${subnet}.1/24`,
        `ListenPort = ${port}`,
        `PrivateKey = ${privateKey}`,
        'SaveConfig = true',
        `PostUp = iptables -A FORWARD -i ${iface} -j ACCEPT; iptables -A FORWARD -o ${iface} -j ACCEPT; iptables -t nat -A POSTROUTING -s ${subnet}.0/24 -o ${outboundIface} -j MASQUERADE`,
        `PostDown = iptables -D FORWARD -i ${iface} -j ACCEPT; iptables -D FORWARD -o ${iface} -j ACCEPT; iptables -t nat -D POSTROUTING -s ${subnet}.0/24 -o ${outboundIface} -j MASQUERADE`,
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 }
    );

    run(`systemctl enable --now wg-quick@${iface}`);
  }

  if (!publicKey) {
    throw new Error(`Unable to determine the WireGuard public key for ${iface}.`);
  }

  const nextEndpoint = isPlaceholder(endpoint) ? getPrimaryIp() : endpoint;
  envStore.updateEnvValues({
    WG_INTERFACE: iface,
    WG_SUBNET: subnet,
    WG_SERVER_PORT: port,
    WG_SERVER_PUBLIC_KEY: publicKey,
    WG_SERVER_ENDPOINT: nextEndpoint,
  });

  return {
    interface: iface,
    subnet,
    port,
    endpoint: nextEndpoint,
    publicKey,
    configPath,
  };
}

module.exports = {
  ensureWireguardBootstrap,
};
