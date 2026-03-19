const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { ensureSafeDirectory, getAppMeta } = require('./app-meta');

const repoRoot = path.resolve(__dirname, '../..');
const dataDir = path.resolve(__dirname, '../data');
const statusFile = path.join(dataDir, 'update-status.json');
const logFile = path.join(dataDir, 'update.log');
const pidFile = path.join(dataDir, 'update.pid');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function writeStatus({ status, running, message, pid = null }) {
  ensureDataDir();
  const current = readStatusFile();
  fs.writeFileSync(
    statusFile,
    JSON.stringify(
      {
        branch: current.branch ?? null,
        currentCommit: current.currentCommit ?? null,
        remoteCommit: current.remoteCommit ?? null,
        updateAvailable: current.updateAvailable ?? null,
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
      branch: null,
      currentCommit: null,
      remoteCommit: null,
      updateAvailable: null,
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
      branch: null,
      currentCommit: null,
      remoteCommit: null,
      updateAvailable: null,
      pid: null,
      updatedAt: null,
    };
  }
}

function getLocalGitSummary() {
  ensureSafeDirectory();

  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const currentCommit = execSync('git rev-parse HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return {
      branch,
      currentCommit,
    };
  } catch {
    return {
      branch: null,
      currentCommit: null,
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
  const running = fileStatus.running && (pid ? isProcessRunning(pid) : false);
  const appMeta = getAppMeta();

  return {
    ...appMeta,
    ...getLocalGitSummary(),
    ...fileStatus,
    pid,
    running,
    log: readLogTail(),
  };
}

function startRealUpdate(options = {}) {
  const scriptPath = path.join(repoRoot, 'update.sh');
  const forceInstall = Boolean(options.forceInstall);

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
    env: {
      ...process.env,
      FORCE_INSTALL: forceInstall ? 'true' : 'false',
    },
  });

  child.unref();
  fs.writeFileSync(pidFile, `${child.pid}`, 'utf8');
  writeStatus({ status: 'running', running: true, message: 'Update started.', pid: child.pid });

  return {
    ok: true,
    message: forceInstall ? 'Repair install started.' : 'Update started.',
    pid: child.pid,
  };
}

function startUpdate(options = {}) {
  if (process.platform !== 'linux') {
    throw new Error('Updates are only supported on the Ubuntu server.');
  }

  return startRealUpdate(options);
}

module.exports = {
  getStatus,
  startUpdate,
};
