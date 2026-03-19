const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const dataDir = path.resolve(__dirname, '../data');
const versionHistoryFile = path.join(dataDir, 'version-history.json');
const backendPackage = require('../package.json');

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function ensureSafeDirectory() {
  try {
    execSync(`git config --global --add safe.directory "${repoRoot}"`, {
      cwd: repoRoot,
      stdio: 'ignore',
      shell: '/bin/bash',
    });
  } catch {
    // Ignore Git config failures and fall back to best-effort metadata reads.
  }
}

function readGit(command) {
  ensureSafeDirectory();

  try {
    return execSync(command, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: '/bin/bash',
    }).trim();
  } catch {
    return '';
  }
}

function readVersionHistory() {
  ensureDataDir();

  if (!fs.existsSync(versionHistoryFile)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(versionHistoryFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeVersionHistory(entries) {
  ensureDataDir();
  fs.writeFileSync(versionHistoryFile, JSON.stringify(entries, null, 2), 'utf8');
}

function getAppMeta() {
  const baseVersion = backendPackage.version || '1.0.0';
  const branch = readGit('git rev-parse --abbrev-ref HEAD') || null;
  const currentCommit = readGit('git rev-parse HEAD') || null;
  const shortCommit = readGit('git rev-parse --short HEAD') || null;
  const buildNumber = Number(readGit('git rev-list --count HEAD')) || 0;
  const latestChange = readGit('git log -1 --pretty=%s') || 'Unknown change';
  const history = readVersionHistory();
  const knownCommits = new Set(history.map((entry) => entry.commit).filter(Boolean));
  if (currentCommit) {
    knownCommits.add(currentCommit);
  }

  return {
    baseVersion,
    displayVersion: `${baseVersion}+${buildNumber}${shortCommit ? `.${shortCommit}` : ''}`,
    buildNumber,
    branch,
    currentCommit,
    shortCommit,
    latestChange,
    updateCount: knownCommits.size,
    history,
  };
}

function recordInstalledVersion(source = 'install') {
  const meta = getAppMeta();
  const history = readVersionHistory();
  const installedAt = new Date().toISOString();
  const entry = {
    version: meta.displayVersion,
    baseVersion: meta.baseVersion,
    buildNumber: meta.buildNumber,
    branch: meta.branch,
    commit: meta.currentCommit,
    shortCommit: meta.shortCommit,
    latestChange: meta.latestChange,
    source,
    installedAt,
  };

  const existingIndex = history.findIndex((item) => item.commit && item.commit === entry.commit);

  if (existingIndex >= 0) {
    history[existingIndex] = {
      ...history[existingIndex],
      ...entry,
    };
  } else {
    history.push(entry);
  }

  writeVersionHistory(history);
  return entry;
}

module.exports = {
  ensureSafeDirectory,
  getAppMeta,
  readVersionHistory,
  recordInstalledVersion,
};