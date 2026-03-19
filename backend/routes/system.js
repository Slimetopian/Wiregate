const express = require('express');
const os = require('os');
const commandRunner = require('../lib/command-runner');
const envStore = require('../lib/env-store');
const updateManager = require('../lib/update-manager');

const router = express.Router();

function isDemoMode() {
  return `${process.env.DEMO_MODE ?? 'true'}`.toLowerCase() !== 'false';
}

function hasProductionValues() {
  const required = [
    process.env.WG_INTERFACE,
    process.env.WG_SERVER_ENDPOINT,
    process.env.WG_SERVER_PORT,
    process.env.WG_SERVER_PUBLIC_KEY,
    process.env.WG_SUBNET,
  ];

  return required.every((value) => value && !`${value}`.includes('YOUR_'));
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
    return res.json({
      ...envStore.currentMode(),
      canSwitchToProduction: hasProductionValues(),
      interface: process.env.WG_INTERFACE || 'wg0',
      endpoint: process.env.WG_SERVER_ENDPOINT || '',
      port: process.env.WG_SERVER_PORT || '51820',
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/mode', (req, res) => {
  try {
    const requestedDemo = Boolean(req.body?.demo);

    if (!requestedDemo && !hasProductionValues()) {
      return res.status(400).json({
        error:
          'Production mode requires real WireGuard values in .env: WG_INTERFACE, WG_SERVER_ENDPOINT, WG_SERVER_PORT, WG_SERVER_PUBLIC_KEY, and WG_SUBNET.',
      });
    }

    envStore.updateEnvValues({ DEMO_MODE: requestedDemo ? 'true' : 'false' });

    return res.json({
      ...envStore.currentMode(),
      canSwitchToProduction: hasProductionValues(),
      message: requestedDemo ? 'Switched to test mode.' : 'Switched to production mode.',
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

router.post('/update', (_req, res) => {
  try {
    return res.json(updateManager.startUpdate());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
