const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const dataDir = path.resolve(__dirname, '../data');
const statusFile = path.join(dataDir, 'update-status.json');
const logFile = path.join(dataDir, 'update.log');
const pidFile = path.join(dataDir, 'update.pid');

let demoTimer = null;

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function isDemoMode() {
  return `${process.env.DEMO_MODE ?? 'true'}`.toLowerCase() !== 'false';
}

function writeStatus({ status, running, message, pid = null }) {
  ensureDataDir();
  fs.writeFileSync(
    statusFile,
    JSON.stringify(
      {
        status,
        running,
        message,
        pid,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
}

function appendLog(line) {
  ensureDataDir();
  fs.appendFileSync(logFile, `${line.endsWith('\n') ? line : `${line}\n`}`, 'utf8');
}

function readStatusFile() {
  ensureDataDir();
  if (!fs.existsSync(statusFile)) {
    return {
      status: 'idle',
      running: false,
      message: 'No update has been started yet.',
      pid: null,
      updatedAt: null,
    };
  }

  try {
    return JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  } catch {
    return {
      status: 'unknown',
      running: false,
      message: 'Unable to parse update status file.',
      pid: null,
      updatedAt: null,
    };
  }
}

function readLogTail(limit = 16000) {
  ensureDataDir();
  if (!fs.existsSync(logFile)) {
    return '';
  }

  const content = fs.readFileSync(logFile, 'utf8');
  return content.slice(-limit);
}

function readPid() {
  if (!fs.existsSync(pidFile)) {
    return null;
  }

  const raw = fs.readFileSync(pidFile, 'utf8').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isProcessRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getStatus() {
  const fileStatus = readStatusFile();
  const pid = readPid() || fileStatus.pid || null;
  const running = fileStatus.running && (pid ? isProcessRunning(pid) || isDemoMode() : false);

  return {
    ...fileStatus,
    pid,
    running,
    log: readLogTail(),
  };
}

function startDemoUpdate() {
  if (demoTimer) {
    throw new Error('An update is already running.');
  }

  ensureDataDir();
  fs.writeFileSync(logFile, '', 'utf8');
  writeStatus({ status: 'running', running: true, message: 'Starting demo update.', pid: process.pid });

  const lines = [
    'Fetching latest code from origin/main...',
    'Installing backend dependencies...',
    'Installing frontend dependencies...',
    'Building frontend assets...',
    'Restarting wiregate service...',
    'Update completed successfully.',
  ];

  let index = 0;
  demoTimer = setInterval(() => {
    if (index >= lines.length) {
      clearInterval(demoTimer);
      demoTimer = null;
      writeStatus({ status: 'completed', running: false, message: 'Demo update completed.', pid: null });
      return;
    }

    appendLog(lines[index]);
    writeStatus({ status: 'running', running: true, message: lines[index], pid: process.pid });
    index += 1;
  }, 500);

  return {
    ok: true,
    message: 'Demo update started.',
  };
}

function startRealUpdate() {
  const scriptPath = path.join(repoRoot, 'update.sh');

  if (!fs.existsSync(scriptPath)) {
    throw new Error('update.sh not found in the repository root.');
  }

  const current = getStatus();
  if (current.running) {
    throw new Error('An update is already running.');
  }

  ensureDataDir();
  fs.writeFileSync(logFile, '', 'utf8');

  const child = spawn('/bin/bash', [scriptPath], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
  fs.writeFileSync(pidFile, `${child.pid}`, 'utf8');
  writeStatus({ status: 'running', running: true, message: 'Update started.', pid: child.pid });

  return {
    ok: true,
    message: 'Update started.',
    pid: child.pid,
  };
}

function startUpdate() {
  if (isDemoMode()) {
    return startDemoUpdate();
  }

  if (process.platform !== 'linux') {
    throw new Error('Real updates are only supported on the Ubuntu server.');
  }

  return startRealUpdate();
}

module.exports = {
  getStatus,
  startUpdate,
};
