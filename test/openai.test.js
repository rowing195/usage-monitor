'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { parseRateLimits, readRateLimits } = require('../src/main/openai');

const primary = { usedPercent: 46, windowDurationMins: 300, resetsAt: 2_000_000_000 };
const secondary = { usedPercent: 7, windowDurationMins: 10080, resetsAt: 2_000_010_000 };

test('multi-bucket view takes precedence without duplicating legacy quota', () => {
  const metrics = parseRateLimits({
    rateLimits: { primary: { ...primary, usedPercent: 99 } },
    rateLimitsByLimitId: {
      codex: { primary, secondary },
      other: { limitName: 'Other', primary: { ...primary, windowDurationMins: 15 }, secondary: null },
    },
  }, 123);
  assert.deepEqual(metrics.map((m) => m.usedPct), [46, 7, 46]);
  assert.deepEqual(metrics.map((m) => m.label), ['OpenAI Codex 5 小時', 'OpenAI Codex 7 天', 'OpenAI Other 15 分鐘']);
  assert.equal(metrics[0].resetsAt, 2_000_000_000_000);
  assert.equal(metrics[0].updatedAt, 123);
  assert.equal(new Set(metrics.map((m) => m.key)).size, 3);
});

test('legacy snapshots work; missing and invalid values never become zero', () => {
  assert.equal(parseRateLimits({ rateLimits: { primary } })[0].usedPct, 46);
  for (const result of [null, {}, { rateLimits: null }, { rateLimitsByLimitId: {} },
    { rateLimits: { primary: { usedPercent: null }, secondary: { usedPercent: '7' } } },
    { rateLimits: { primary: { usedPercent: NaN }, secondary: { usedPercent: Infinity } } }]) {
    assert.deepEqual(parseRateLimits(result), []);
  }
  assert.equal(parseRateLimits({ rateLimits: { primary: { usedPercent: 0 } } })[0].usedPct, 0);
});

function fakeServer(reply) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; child.stdout.end(); };
  const requests = [];
  child.stdin.on('data', (chunk) => {
    const request = JSON.parse(String(chunk));
    requests.push(request);
    queueMicrotask(() => reply(request, child));
  });
  return { child, requests, spawnProcess: () => child };
}

test('stdio handshake only reads limits and cleans up the server', async () => {
  const server = fakeServer((request, child) => {
    if (request.method === 'initialize') child.stdout.write('{"id":0,"result":{}}\n');
    if (request.method === 'account/rateLimits/read') {
      child.stdout.write('non-JSON diagnostic\n');
      child.stdout.write('{"method":"account/updated","params":{}}\n');
      child.stdout.write(JSON.stringify({ id: 1, result: { rateLimits: { primary } } }) + '\n');
    }
  });
  const result = await readRateLimits('fake', server);
  assert.equal(result.rateLimits.primary.usedPercent, 46);
  assert.deepEqual(server.requests.map((r) => r.method), ['initialize', 'initialized', 'account/rateLimits/read']);
  assert.equal(server.child.killed, true);
});

test('unauthenticated server rejects instead of supplying an empty quota', async () => {
  const server = fakeServer((request, child) => {
    if (request.id === undefined) return;
    child.stdout.write(JSON.stringify(request.id === 0
      ? { id: 0, result: {} } : { id: 1, error: { message: 'unauthorized' } }) + '\n');
  });
  await assert.rejects(readRateLimits('fake', server), /unavailable/);
  assert.equal(server.child.killed, true);
});

test('timeout and cancellation both terminate the child', async () => {
  const server = fakeServer(() => {});
  await assert.rejects(readRateLimits('fake', { ...server, timeoutMs: 10 }), /timed out/);
  assert.equal(server.child.killed, true);
  const other = fakeServer(() => {});
  const controller = new AbortController();
  const pending = readRateLimits('fake', { ...other, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(other.child.killed, true);
});

test('missing executable rejects cleanly', async () => {
  await assert.rejects(readRateLimits('C:/nonexistent-usage-monitor/codex.exe'));
});

test('OpenAI participates in ranking and expired readings remain stale, not zero', () => {
  // providers only needs scriptPath; isolate Electron from this Node unit test.
  const resourcesPath = require.resolve('../src/main/resources');
  require.cache[resourcesPath] = { id: resourcesPath, filename: resourcesPath, loaded: true, exports: { scriptPath: (p) => p } };
  const { summarize } = require('../src/main/providers');
  const now = 1_900_000_000_000;
  const metrics = parseRateLimits({ rateLimits: { primary, secondary } }, now);
  assert.equal(summarize(metrics, now).highest.source, 'openai');
  const stale = summarize(metrics, now + 181_000).metrics;
  assert.ok(stale.every((m) => m.stale));
  const expired = summarize(metrics, primary.resetsAt * 1000 + 1).metrics[0];
  assert.equal(expired.stale, true);
  assert.equal(expired.usedPct, 46);
});
