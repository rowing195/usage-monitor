'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const POLL_MS = 60_000;
const TIMEOUT_MS = 20_000;

function findCodex(env = process.env) {
  if (env.CODEX_EXECUTABLE) return env.CODEX_EXECUTABLE;
  const candidates = (env.PATH || env.Path || '').split(path.delimiter)
    .filter(Boolean).map((dir) => path.join(dir.replace(/^"|"$/g, ''), 'codex.exe'));
  // npm's Windows shim is a .cmd file. Resolve its native package binary so
  // polling needs neither a shell nor an extra system Node installation.
  const npmRoots = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)
    .map((dir) => path.join(dir.replace(/^"|"$/g, ''), 'node_modules', '@openai'));
  for (const root of npmRoots) {
    for (const platform of ['x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc']) {
      for (const pkg of ['codex', 'codex-win32-x64', 'codex-win32-arm64']) {
        candidates.push(path.join(root, pkg, 'vendor', platform, 'codex', 'codex.exe'));
      }
    }
  }
  const desktopBin = path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
  try {
    const versions = fs.readdirSync(desktopBin, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(desktopBin, entry.name, 'codex.exe'))
      .filter((file) => fs.existsSync(file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    candidates.push(...versions);
  } catch { /* Codex desktop is optional. */ }
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function windowLabel(minutes, slot) {
  if (!Number.isFinite(minutes) || minutes <= 0) return slot === 'primary' ? '主要額度' : '次要額度';
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes % 60 === 0) return `${minutes / 60} 小時`;
  return `${minutes} 分鐘`;
}

function parseRateLimits(result, now = Date.now()) {
  const buckets = result?.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === 'object'
    ? Object.entries(result.rateLimitsByLimitId)
    : result?.rateLimits ? [[result.rateLimits.limitId || 'codex', result.rateLimits]] : [];
  const metrics = [];
  for (const [id, bucket] of buckets) {
    for (const slot of ['primary', 'secondary']) {
      const window = bucket?.[slot];
      if (!Number.isFinite(window?.usedPercent)) continue;
      const name = id === 'codex' ? 'OpenAI Codex' : `OpenAI ${bucket.limitName || id}`;
      metrics.push({
        key: `openai:${id}:${slot}`,
        label: `${name} ${windowLabel(window.windowDurationMins, slot)}`,
        source: 'openai',
        usedPct: Math.max(0, Math.min(100, window.usedPercent)),
        resetsAt: Number.isFinite(window.resetsAt) && window.resetsAt > 0 ? window.resetsAt * 1000 : null,
        updatedAt: now,
        text: null,
        accent: 'openai',
      });
    }
  }
  return metrics;
}

// Use Codex's documented stdio API and its own login handling. No conversation
// or model turn is created; the monitor never reads or copies OAuth credentials.
function readRateLimits(executable, { spawnProcess = spawn, timeoutMs = TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let lines;
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      lines?.close();
      child?.stdin.destroy();
      child?.kill();
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new Error('Codex read cancelled'));
    if (signal?.aborted) return abort();
    try {
      child = spawnProcess(executable, ['app-server'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        cwd: os.homedir(),
      });
    } catch (error) { finish(error); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('Codex read timed out')), timeoutMs);
    child.on('error', (error) => finish(error));
    child.on('exit', () => finish(new Error('Codex app server exited')));
    child.stdin.on('error', (error) => finish(error));
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    let initialized = false;
    lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (settled) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === 0 && !initialized) {
        if (message.error) return finish(new Error('Codex initialization failed'));
        initialized = true;
        send({ method: 'initialized', params: {} });
        send({ id: 1, method: 'account/rateLimits/read' });
      } else if (message.id === 1) {
        if (message.error || !message.result) return finish(new Error('Codex usage unavailable; check Codex login'));
        finish(null, message.result);
      }
    });
    send({ id: 0, method: 'initialize', params: {
      clientInfo: { name: 'usage_monitor', title: 'Usage Monitor', version: require('../../package.json').version },
    } });
  });
}

function startOpenAI(onChange) {
  let latest = [];
  let timer;
  let stopped = false;
  const controller = new AbortController();
  const poll = async () => {
    const executable = findCodex();
    try {
      if (!executable) throw new Error('Codex not installed');
      latest = parseRateLimits(await readRateLimits(executable, { signal: controller.signal }));
    } catch {
      // Preserve the original timestamp so a failed poll cannot freshen a value.
    }
    if (stopped) return;
    onChange(latest.length ? latest : [{
      key: 'openai:status', label: 'OpenAI Codex', source: 'openai',
      usedPct: null, resetsAt: null, updatedAt: Date.now(), accent: 'openai',
      text: executable ? '請確認 Codex 登入／連線' : '請安裝 Codex',
    }]);
    timer = setTimeout(poll, POLL_MS);
  };
  poll();
  return () => { stopped = true; clearTimeout(timer); controller.abort(); };
}

module.exports = { findCodex, parseRateLimits, readRateLimits, startOpenAI };
