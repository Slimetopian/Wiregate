const express = require('express');
const os = require('os');
const { getAppMeta } = require('../lib/app-meta');
const envStore = require('../lib/env-store');
const terminalManager = require('../lib/terminal-manager');
const updateManager = require('../lib/update-manager');
const { ensureWireguardBootstrap, applyWireguardServerConfig } = require('../lib/wg-bootstrap');

const router = express.Router();

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
    return res.json({
      uptime: os.uptime(),
      hostname: os.hostname(),
      platform: os.platform(),
      memTotal: os.totalmem(),
      memFree: os.freemem(),
      loadAvg: os.loadavg(),
      app: getAppMeta(),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/terminal', (_req, res) => {
  try {
    return res.json(terminalManager.getState());
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
    let bootstrapResult = null;

    if (!hasProductionValues()) {
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

    envStore.updateEnvValues({ DEMO_MODE: 'false' });

    return res.json(
      getModeState({
        message: bootstrapResult
          ? `WireGate is running in production mode and auto-configured ${bootstrapResult.interface}.`
          : 'WireGate is running in production mode.',
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
    const port = `${req.body?.port || ''}`.trim();
    const subnet = `${req.body?.subnet || ''}`.trim();

    if (!endpoint) {
      return res.status(400).json({ error: 'Public IP or hostname is required.' });
    }

    if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      return res.status(400).json({ error: 'A valid forwarded WireGuard port is required.' });
    }

    if (!subnet || !/^(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)\.(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(subnet)) {
      return res.status(400).json({ error: 'A valid subnet prefix is required, for example 10.0.0.' });
    }

    const applied = applyWireguardServerConfig({ endpoint, port, subnet });

    return res.json({
      ...getSystemConfig(),
      interface: applied.interface,
      subnet: applied.subnet,
      publicKey: applied.publicKey,
      message: 'Saved and applied the WireGuard endpoint, port, and subnet.',
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
