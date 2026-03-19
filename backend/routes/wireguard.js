const express = require('express');
const wgManager = require('../lib/wg-manager');

const router = express.Router();

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

router.get('/status', (_req, res) => {
  try {
    res.json(wgManager.getStatus());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/peers', (_req, res) => {
  try {
    res.json(wgManager.getPeers());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stream/:action', (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const stop = wgManager.streamInterfaceAction(req.params.action, {
      onData: (chunk) => writeSse(res, 'chunk', { chunk }),
      onEnd: () => {
        writeSse(res, 'end', { ok: true });
        res.end();
      },
      onError: (error) => {
        writeSse(res, 'error', { error: error.message });
        res.end();
      },
    });

    req.on('close', () => {
      if (typeof stop === 'function') {
        stop();
      } else if (stop?.kill) {
        stop.kill('SIGTERM');
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/start', (_req, res) => {
  try {
    res.json(wgManager.startInterface());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/stop', (_req, res) => {
  try {
    res.json(wgManager.stopInterface());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/restart', (_req, res) => {
  try {
    res.json(wgManager.restartInterface());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
