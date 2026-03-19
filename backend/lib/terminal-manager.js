const os = require('os');
const path = require('path');

let nodePty = null;

try {
  nodePty = require('node-pty');
} catch {
  nodePty = null;
}

const shellHome = process.env.HOME || os.homedir() || '/root';
const maxBufferLength = 120000;

let shellProcess = null;
let shellLabel = '';
let outputBuffer = '';
const subscribers = new Set();

function getShellDefinition() {
  const command = process.env.SHELL || '/bin/bash';
  return {
    command,
    args: ['-l'],
    label: path.basename(command),
  };
}

function ensurePtySupport() {
  if (process.platform !== 'linux') {
    throw new Error('The live VM terminal is only supported on the Ubuntu server.');
  }

  if (!nodePty) {
    throw new Error('The live VM terminal requires node-pty. Re-run the installer on Ubuntu to install the terminal dependencies.');
  }
}

function trimBuffer() {
  if (outputBuffer.length > maxBufferLength) {
    outputBuffer = outputBuffer.slice(-maxBufferLength);
  }
}

function emit(event, payload) {
  subscribers.forEach((listener) => listener(event, payload));
}

function appendOutput(text) {
  if (!text) {
    return;
  }

  outputBuffer += text;
  trimBuffer();
  emit('chunk', { chunk: text });
}

function ensureSession() {
  if (shellProcess) {
    return shellProcess;
  }

  ensurePtySupport();

  const shell = getShellDefinition();
  shellLabel = shell.label;

  shellProcess = nodePty.spawn(shell.command, shell.args, {
    cwd: shellHome,
    cols: 120,
    rows: 32,
    name: 'xterm-256color',
    env: {
      ...process.env,
      TERM: process.env.TERM || 'xterm-256color',
    },
  });

  shellProcess.onData((chunk) => appendOutput(chunk.toString()));
  shellProcess.onExit(({ exitCode }) => {
    appendOutput(`\r\n[terminal exited with code ${exitCode}]\r\n`);
    shellProcess = null;
    emit('exit', { code: exitCode });
  });

  return shellProcess;
}

function handleError(error) {
  appendOutput(`\r\n[terminal error] ${error.message}\r\n`);
  emit('error', { error: error.message });
}

function getState() {
  ensureSession();
  return {
    running: Boolean(shellProcess),
    shell: shellLabel,
    cwd: shellHome,
    output: outputBuffer,
  };
}

function writeData(data) {
  const input = `${data || ''}`;
  if (!input) {
    throw new Error('Terminal input is required.');
  }

  try {
    ensureSession().write(input);
    return { ok: true };
  } catch (error) {
    handleError(error);
    throw error;
  }
}

function writeInput(input) {
  const command = `${input || ''}`;
  if (!command.trim()) {
    throw new Error('Terminal input is required.');
  }

  return writeData(`${command}\r`);
}

function resize(cols, rows) {
  const width = Number(cols);
  const height = Number(rows);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 20 || height < 5) {
    return { ok: false };
  }

  try {
    ensureSession().resize(Math.floor(width), Math.floor(height));
    return { ok: true };
  } catch (error) {
    handleError(error);
    throw error;
  }
}

function interrupt() {
  try {
    ensureSession().write('\u0003');
    return { ok: true };
  } catch (error) {
    handleError(error);
    throw error;
  }
}

function clearOutput() {
  outputBuffer = '';
  emit('clear', {});
  return getState();
}

function subscribe(listener) {
  ensureSession();
  subscribers.add(listener);
  listener('snapshot', getState());

  return () => {
    subscribers.delete(listener);
  };
}

module.exports = {
  getState,
  writeData,
  writeInput,
  resize,
  interrupt,
  clearOutput,
  subscribe,
};
