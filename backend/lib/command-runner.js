const { execSync } = require('child_process');

function isDemoMode() {
  return `${process.env.DEMO_MODE ?? 'true'}`.toLowerCase() !== 'false';
}

function commandCenterEnabled() {
  return `${process.env.ENABLE_COMMAND_CENTER ?? 'false'}`.toLowerCase() === 'true';
}

function getInterfaceName() {
  return process.env.WG_INTERFACE || 'wg0';
}

function getCommandDefinitions() {
  const iface = getInterfaceName();

  return {
    wiregateStatus: {
      id: 'wiregateStatus',
      label: 'WireGate service status',
      description: 'Show the active systemd state for the WireGate backend service.',
      command: 'systemctl status wiregate --no-pager',
      demoOutput: '● wiregate.service - WireGate backend service\n     Loaded: loaded (/etc/systemd/system/wiregate.service; enabled)\n     Active: active (running) since Thu 2026-03-19 11:00:00 UTC; 12min ago',
    },
    wiregateLogs: {
      id: 'wiregateLogs',
      label: 'WireGate recent logs',
      description: 'Show the last 100 log lines from the WireGate service.',
      command: 'journalctl -u wiregate -n 100 --no-pager',
      demoOutput: 'Mar 19 11:00:00 wiregate-demo systemd[1]: Started wiregate.service - WireGate backend service.\nMar 19 11:01:12 wiregate-demo node[914]: WireGate backend listening on http://0.0.0.0:3001',
    },
    restartWiregate: {
      id: 'restartWiregate',
      label: 'Restart WireGate service',
      description: 'Restart the WireGate backend service and print the new status.',
      command: 'systemctl restart wiregate && systemctl status wiregate --no-pager',
      demoOutput: 'Restarted wiregate.service\n● wiregate.service - WireGate backend service\n     Active: active (running)',
    },
    wgShow: {
      id: 'wgShow',
      label: 'WireGuard interface status',
      description: `Run wg show for ${iface}.`,
      command: `wg show ${iface}`,
      demoOutput: `interface: ${iface}\n  public key: demo-public-key\n  listening port: 51820\npeer: demo-peer-key\n  allowed ips: 10.0.0.2/32`,
    },
    wgServiceStatus: {
      id: 'wgServiceStatus',
      label: 'WireGuard service status',
      description: `Show the systemd status for wg-quick@${iface}.`,
      command: `systemctl status wg-quick@${iface} --no-pager`,
      demoOutput: `● wg-quick@${iface}.service - WireGuard via wg-quick(${iface})\n     Active: active (exited)`,
    },
    restartWgService: {
      id: 'restartWgService',
      label: 'Restart WireGuard service',
      description: `Restart wg-quick@${iface} and print the new status.`,
      command: `systemctl restart wg-quick@${iface} && systemctl status wg-quick@${iface} --no-pager`,
      demoOutput: `Restarted wg-quick@${iface}.service\n● wg-quick@${iface}.service - WireGuard via wg-quick(${iface})\n     Active: active (exited)`,
    },
  };
}

function listCommands() {
  const commands = Object.values(getCommandDefinitions()).map(({ command, demoOutput, ...rest }) => rest);
  return {
    enabled: commandCenterEnabled(),
    commands,
    message: commandCenterEnabled()
      ? 'Restricted command center is enabled.'
      : 'Command center is disabled. Set ENABLE_COMMAND_CENTER=true in .env to enable safe predefined commands.',
  };
}

function runCommand(commandId) {
  if (!commandCenterEnabled()) {
    throw new Error('Command center is disabled. Set ENABLE_COMMAND_CENTER=true in .env to enable it.');
  }

  const commands = getCommandDefinitions();
  const selected = commands[commandId];

  if (!selected) {
    throw new Error('Unknown command preset');
  }

  if (isDemoMode()) {
    return {
      id: selected.id,
      label: selected.label,
      output: selected.demoOutput,
      executedAt: new Date().toISOString(),
      demo: true,
    };
  }

  try {
    const output = execSync(selected.command, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash',
    }).trim();

    return {
      id: selected.id,
      label: selected.label,
      output: output || 'Command completed with no output.',
      executedAt: new Date().toISOString(),
      demo: false,
    };
  } catch (error) {
    const stdout = error.stdout?.toString()?.trim();
    const stderr = error.stderr?.toString()?.trim();
    throw new Error(stderr || stdout || error.message || 'Command failed');
  }
}

module.exports = {
  listCommands,
  runCommand,
};
