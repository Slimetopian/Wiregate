const fs = require('fs');
const path = require('path');

const backendEnvPath = path.resolve(__dirname, '../.env');
const rootEnvPath = path.resolve(__dirname, '../../.env');

function getEnvFilePath() {
  if (fs.existsSync(backendEnvPath)) {
    return backendEnvPath;
  }

  if (fs.existsSync(rootEnvPath)) {
    return rootEnvPath;
  }

  return rootEnvPath;
}

function ensureEnvFile() {
  const envPath = getEnvFilePath();
  const envDir = path.dirname(envPath);

  if (!fs.existsSync(envDir)) {
    fs.mkdirSync(envDir, { recursive: true });
  }

  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, '', 'utf8');
  }

  return envPath;
}

function readEnvLines() {
  const envPath = ensureEnvFile();
  return fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
}

function updateEnvValues(entries) {
  const envPath = ensureEnvFile();
  const lines = readEnvLines();
  const nextLines = [...lines];

  Object.entries(entries).forEach(([key, value]) => {
    const lineIndex = nextLines.findIndex((line) => line.startsWith(`${key}=`));
    const serialized = `${key}=${value}`;

    if (lineIndex >= 0) {
      nextLines[lineIndex] = serialized;
    } else {
      nextLines.push(serialized);
    }

    process.env[key] = `${value}`;
  });

  fs.writeFileSync(envPath, nextLines.filter((line, index, array) => index < array.length - 1 || line !== '').join('\n'), 'utf8');
  return envPath;
}

function currentMode() {
  const demo = `${process.env.DEMO_MODE ?? 'true'}`.toLowerCase() !== 'false';
  return {
    demo,
    mode: demo ? 'test' : 'production',
    envFilePath: getEnvFilePath(),
  };
}

module.exports = {
  getEnvFilePath,
  updateEnvValues,
  currentMode,
};
