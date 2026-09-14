'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const { scriptPath } = require('./resources');
const { startOpenAI } = require('./openai');

// Claude's status line reports used_percentage on a 0-100 scale; Antigravity
// reports remaining as a 0-1 fraction. Everything below this line is 0-100, so
// the orb can rank the two against each other.
const CLAUDE_STATUSLINE_FILE = path.join(os.homedir(), '.usage-monitor', 'claude-statusline.json');

// How long a reading stays trustworthy, per source. Claude only refreshes when a
// new assistant message arrives, so a working session can legitimately go quiet
// for a while; Antigravity is polled on a timer and should never lag far behind.
const STALE_MS = {
  claude: 15 * 60 * 1000,
  antigravity: 3 * 60 * 1000,
  openai: 3 * 60 * 1000,
};

const ANTIGRAVITY_POLL_MS = 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 15 * 1000;
const RPC_TIMEOUT_MS = 5 * 1000;
const RPC_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';

// `accent` drives the colour a metric is drawn in, independent of severity.
function metric(key, label, source, usedPct, resetsAt, updatedAt, text = null, accent = 'default') {
  return { key, label, source, usedPct, resetsAt, updatedAt, text, accent };
}

/* ---------- Claude ---------- */

function readClaudeFile() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(CLAUDE_STATUSLINE_FILE, 'utf8'));
  } catch {
    return [];
  }

  const updatedAt = Date.parse(parsed.writtenAt);
  if (!Number.isFinite(updatedAt)) return [];

  return [
    ['claude:5h', 'Claude 5 小時', parsed.rate_limits?.five_hour],
    ['claude:7d', 'Claude 7 天', parsed.rate_limits?.seven_day],
  ]
    .filter(([, , w]) => w && typeof w.used_percentage === 'number')
    .map(([key, label, w]) =>
      metric(key, label, 'claude', w.used_percentage, w.resets_at ? w.resets_at * 1000 : null, updatedAt, null, 'claude')
    );
}

function watchClaude(onChange) {
  const dir = path.dirname(CLAUDE_STATUSLINE_FILE);
  fs.mkdirSync(dir, { recursive: true });

  // Watch the directory, not the file, so the very first write is seen too.
  fs.watch(dir, (_event, filename) => {
    if (filename === path.basename(CLAUDE_STATUSLINE_FILE)) onChange(readClaudeFile());
  });

  onChange(readClaudeFile());
}

/* ---------- Antigravity ---------- */

// Each running language server exposes a Connect RPC endpoint on localhost and
// carries its own CSRF token on its command line.
function discoverServers() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath('discover-antigravity.ps1'),
      ],
      { timeout: DISCOVERY_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([]);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve([]);
        }
      }
    );
  });
}

function getUserStatus(port, csrf) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port,
        path: RPC_PATH,
        method: 'POST',
        timeout: RPC_TIMEOUT_MS,
        rejectUnauthorized: false, // The language server uses a self-signed cert.
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          'X-Codeium-Csrf-Token': csrf,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(body).userStatus ?? null);
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(JSON.stringify({ metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' } }));
    req.end();
  });
}

async function fetchAntigravity() {
  for (const server of await discoverServers()) {
    for (const port of server.ports) {
      const status = await getUserStatus(port, server.csrf);
      if (status) return parseUserStatus(status);
    }
  }
  return [];
}

function isClaudeModel(label) {
  return /claude/i.test(label ?? '');
}

function parseUserStatus(status, now = Date.now()) {
  const out = [];

  // Most models draw on a shared pool, so the raw list repeats the same figure
  // many times over. Collapse identical quotas into the buckets they actually are.
  const buckets = new Map();
  for (const model of status.cascadeModelConfigData?.clientModelConfigs ?? []) {
    const quota = model.quotaInfo;
    if (typeof quota?.remainingFraction !== 'number') continue;
    const key = `${quota.remainingFraction}|${quota.resetTime ?? ''}`;
    if (!buckets.has(key)) buckets.set(key, { quota, labels: [] });
    buckets.get(key).labels.push(model.label);
  }

  for (const { quota, labels } of buckets.values()) {
    const resetsAt = quota.resetTime ? Date.parse(quota.resetTime) : null;

    // Antigravity's Claude models share their pool with other vendors', so the
    // bucket cannot be split without inventing separate quotas. Name it after a
    // Claude model when one is in there, and colour the whole pool accordingly.
    const named = [...labels].sort((a, b) => isClaudeModel(b) - isClaudeModel(a));
    const label = named.length > 1 ? `${named[0]} 等 ${named.length} 個模型` : named[0];
    const accent = labels.some(isClaudeModel) ? 'antigravity-claude' : 'default';

    // The key identifies the pool, so it has to be the one thing about the pool
    // that does not move: which models draw on it. Keying by the reading instead
    // would hand every poll a key it had never seen on precisely the poll where
    // the figure rose, and consumption is only ever visible as a rise.
    const poolKey = [...labels].sort().join(',');

    out.push(
      metric(
        `ag:${poolKey}`,
        label,
        'antigravity',
        (1 - quota.remainingFraction) * 100,
        Number.isFinite(resetsAt) ? resetsAt : null,
        now,
        null,
        accent
      )
    );
  }

  // planInfo.monthly*Credits are the plan's nominal ceilings, not this account's
  // actual allowance — on a Google AI Pro tier they disagree with the available
  // balance by two orders of magnitude. Report the balance as a plain number and
  // keep it out of the ranking rather than publish a percentage we cannot stand behind.
  const plan = status.planStatus;
  if (typeof plan?.availablePromptCredits === 'number') {
    out.push(metric('ag:prompt-credits', 'Prompt Credits', 'antigravity', null, null, now, `剩 ${plan.availablePromptCredits}`));
  }
  if (typeof plan?.availableFlowCredits === 'number') {
    out.push(metric('ag:flow-credits', 'Flow Credits', 'antigravity', null, null, now, `剩 ${plan.availableFlowCredits}`));
  }

  return out;
}

/* ---------- Staleness and ranking ---------- */

// "Last used" cannot be read from updatedAt: Antigravity is polled on a timer,
// so its reading is always the freshest even when nothing was consumed. Actual
// use is visible only as a rise in the figure, so that is what gets timestamped.
const consumption = new Map();

function trackConsumption(metrics, now) {
  for (const m of metrics) {
    if (typeof m.usedPct !== 'number') continue;
    const prev = consumption.get(m.key);
    if (!prev) {
      consumption.set(m.key, { value: m.usedPct, at: null });
      continue;
    }
    if (m.usedPct > prev.value + 0.01) prev.at = now;
    prev.value = m.usedPct;
  }
}

function lastUsedAt(key) {
  return consumption.get(key)?.at ?? null;
}

function isStale(m, now) {
  return now - m.updatedAt > STALE_MS[m.source];
}

// A rolling window past its reset time is empty again. That much is certain;
// anything between the last reading and the reset would be a guess.
function decorate(m, now) {
  // An elapsed OpenAI reset is not evidence of zero usage: refresh it first.
  if (m.source === 'openai' && m.resetsAt && now >= m.resetsAt) return { ...m, stale: true };
  if (m.usedPct !== null && m.resetsAt && now >= m.resetsAt) return { ...m, usedPct: 0, stale: false };
  return { ...m, stale: isStale(m, now) };
}

function summarize(metrics, now = Date.now()) {
  trackConsumption(metrics, now);
  const decorated = metrics.map((m) => ({ ...decorate(m, now), lastUsedAt: lastUsedAt(m.key) }));

  // Only metrics with a percentage we trust can claim to be "the most dangerous".
  const rankable = decorated.filter((m) => typeof m.usedPct === 'number');
  const fresh = rankable.filter((m) => !m.stale);
  const pool = fresh.length ? fresh : rankable;
  const highest = pool.length ? pool.reduce((a, b) => (b.usedPct > a.usedPct ? b : a)) : null;

  // Determine the most recently consumed metric
  const used = pool.filter((m) => m.lastUsedAt);
  let recent = used.length ? used.reduce((a, b) => (b.lastUsedAt > a.lastUsedAt ? b : a)) : highest;

  // Special rule: When Claude is the active tool in use, if Claude 7-day quota >= 90%,
  // force the display to Claude 7-day (weekly danger override).
  // If Antigravity is being used, keep displaying Antigravity.
  const claude7d = pool.find((m) => m.key === 'claude:7d');
  if (recent?.source === 'claude' && claude7d && typeof claude7d.usedPct === 'number' && claude7d.usedPct >= 90) {
    recent = claude7d;
  }

  // Synchronize orb and nub to display the same active target
  const target = recent ?? highest;

  return { metrics: decorated, highest: target, recent: target };
}

function start(onUpdate) {
  let claude = [];
  let antigravity = [];
  let openai = [];

  const emit = () => onUpdate(summarize([...claude, ...antigravity, ...openai]));

  const stopOpenAI = startOpenAI((next) => {
    openai = next;
    emit();
  });

  watchClaude((next) => {
    claude = next;
    emit();
  });

  const poll = async () => {
    antigravity = await fetchAntigravity();
    emit();
  };
  poll();
  setInterval(poll, ANTIGRAVITY_POLL_MS);
  return stopOpenAI;
}

module.exports = { start, summarize, parseUserStatus, CLAUDE_STATUSLINE_FILE };
