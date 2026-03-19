const { execSync } = require('child_process');

function commandCenterEnabled() {
  return `${process.env.ENABLE_COMMAND_CENTER ?? 'true'}`.toLowerCase() !== 'false';
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
    },
    wiregateLogs: {
      id: 'wiregateLogs',
      label: 'WireGate recent logs',
      description: 'Show the last 100 log lines from the WireGate service.',
      command: 'journalctl -u wiregate -n 100 --no-pager',
    },
    restartWiregate: {
      id: 'restartWiregate',
      label: 'Restart WireGate service',
      description: 'Restart the WireGate backend service and print the new status.',
      command: 'systemctl restart wiregate && systemctl status wiregate --no-pager',
    },
    wgShow: {
      id: 'wgShow',
      label: 'WireGuard interface status',
      description: `Run wg show for ${iface}.`,
      command: `wg show ${iface}`,
    },
    wgServiceStatus: {
      id: 'wgServiceStatus',
      label: 'WireGuard service status',
      description: `Show the systemd status for wg-quick@${iface}.`,
      command: `systemctl status wg-quick@${iface} --no-pager`,
    },
    restartWgService: {
      id: 'restartWgService',
      label: 'Restart WireGuard service',
      description: `Restart wg-quick@${iface} and print the new status.`,
      command: `systemctl restart wg-quick@${iface} && systemctl status wg-quick@${iface} --no-pager`,
    },
  };
}

function listCommands() {
  const commands = Object.values(getCommandDefinitions()).map(({ command, ...rest }) => ({
    ...rest,
    shellCommand: command,
  }));
  return {
    enabled: commandCenterEnabled(),
    commands,
    message: commandCenterEnabled()
      ? 'Restricted command center is enabled.'
      : 'Command center is disabled. Set ENABLE_COMMAND_CENTER=false only if you want to turn off the safe predefined commands.',
  };
}

function runCommand(commandId) {
  if (!commandCenterEnabled()) {
    throw new Error('Command center is disabled. Set ENABLE_COMMAND_CENTER=true in .env to enable it again.');
  }

  const commands = getCommandDefinitions();
  const selected = commands[commandId];

  if (!selected) {
    throw new Error('Unknown command preset');
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
