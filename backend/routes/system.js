const express = require('express');
const os = require('os');
const commandRunner = require('../lib/command-runner');
const envStore = require('../lib/env-store');
const updateManager = require('../lib/update-manager');
const { ensureWireguardBootstrap } = require('../lib/wg-bootstrap');

const router = express.Router();

function isDemoMode() {
  return `${process.env.DEMO_MODE ?? 'true'}`.toLowerCase() !== 'false';
}

function autoSetupEnabled() {
  return `${process.env.AUTO_SETUP_WIREGUARD ?? 'true'}`.toLowerCase() !== 'false';
}

function hasProductionValues() {
  const env = envStore.readEnvValues();
  const required = [
    env.WG_INTERFACE || process.env.WG_INTERFACE,
    env.WG_SERVER_ENDPOINT || process.env.WG_SERVER_ENDPOINT,
    env.WG_SERVER_PORT || process.env.WG_SERVER_PORT,
    env.WG_SERVER_PUBLIC_KEY || process.env.WG_SERVER_PUBLIC_KEY,
    env.WG_SUBNET || process.env.WG_SUBNET,
  ];

  return required.every((value) => value && !`${value}`.includes('YOUR_'));
}

function getModeState(extra = {}) {
  const config = getSystemConfig();
  const canSwitchToProduction = hasProductionValues();
  const canAutoConfigure = autoSetupEnabled() && os.platform() === 'linux';

  return {
    ...envStore.currentMode(),
    canSwitchToProduction,
    canAutoConfigure,
    interface: config.interface,
    endpoint: config.endpoint,
    port: config.port,
    ...extra,
  };
}

function getSystemConfig() {
  const env = envStore.readEnvValues();
  return {
    endpoint: env.WG_SERVER_ENDPOINT || process.env.WG_SERVER_ENDPOINT || '',
    interface: env.WG_INTERFACE || process.env.WG_INTERFACE || 'wg0',
    port: env.WG_SERVER_PORT || process.env.WG_SERVER_PORT || '51820',
    subnet: env.WG_SUBNET || process.env.WG_SUBNET || '10.0.0',
    dns: env.WG_DNS || process.env.WG_DNS || '1.1.1.1',
  };
}

router.get('/', (_req, res) => {
  try {
    if (isDemoMode()) {
      return res.json({
        uptime: 60 * 60 * 24 * 3 + 60 * 60 * 7 + 60 * 42,
        hostname: 'wiregate-demo',
        platform: 'linux',
        memTotal: 8 * 1024 * 1024 * 1024,
        memFree: 5.2 * 1024 * 1024 * 1024,
        loadAvg: [0.18, 0.26, 0.31],
      });
    }

    return res.json({
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      memTotal: os.totalmem(),
      memFree: os.freemem(),
      loadAvg: os.loadavg(),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/commands', (_req, res) => {
  try {
    return res.json(commandRunner.listCommands());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/commands/:commandId', (req, res) => {
  try {
    return res.json(commandRunner.runCommand(req.params.commandId));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/mode', (_req, res) => {
  try {
    return res.json(getModeState());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/mode', (req, res) => {
  try {
    const requestedDemo = Boolean(req.body?.demo);
    let bootstrapResult = null;

    if (!requestedDemo && !hasProductionValues()) {
      if (autoSetupEnabled() && os.platform() === 'linux') {
        bootstrapResult = ensureWireguardBootstrap();
      }

      if (!hasProductionValues()) {
        return res.status(400).json({
          error:
            'Automatic WireGuard setup could not complete. Real values are still required for WG_INTERFACE, WG_SERVER_ENDPOINT, WG_SERVER_PORT, WG_SERVER_PUBLIC_KEY, and WG_SUBNET.',
        });
      }
    }

    envStore.updateEnvValues({ DEMO_MODE: requestedDemo ? 'true' : 'false' });

    return res.json(
      getModeState({
        message: requestedDemo
          ? 'Switched to test mode.'
          : bootstrapResult
            ? `Switched to production mode and auto-configured ${bootstrapResult.interface}.`
            : 'Switched to production mode.',
        bootstrap: bootstrapResult,
      })
    );
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/config', (_req, res) => {
  try {
    return res.json(getSystemConfig());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/config', (req, res) => {
  try {
    const endpoint = `${req.body?.endpoint || ''}`.trim();

    if (!endpoint) {
      return res.status(400).json({ error: 'Public IP or hostname is required.' });
    }

    envStore.updateEnvValues({ WG_SERVER_ENDPOINT: endpoint });

    return res.json({
      ...getSystemConfig(),
      message: 'Saved WireGuard public endpoint to .env.',
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/update', (_req, res) => {
  try {
    return res.json(updateManager.getStatus());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/update', (req, res) => {
  try {
    return res.json(updateManager.startUpdate({ forceInstall: Boolean(req.body?.forceInstall) }));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
