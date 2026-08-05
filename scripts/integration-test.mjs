#!/usr/bin/env node
/**
 * BE <-> Engine <-> LLM integration test.
 *
 * Drives real story generation through the running stack and records every
 * run as JSON under test-results/, so latency and fallback rates can be
 * compared across runs and across LLM/proxy configurations.
 *
 * Usage:
 *   node scripts/integration-test.mjs [--runs N] [--concurrency N]
 *                                     [--be URL] [--engine URL]
 *                                     [--out DIR] [--timeout MS]
 *
 * Exit code is 0 only when the MVP resilience criteria hold (see
 * evaluateMvp): the Engine must answer every request, never 5xx, and always
 * return a usable story even when the LLM misbehaves.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

const args = process.argv.slice(2);

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
}

const CONFIG = {
  be: flag('be', process.env.BE_URL || 'http://localhost:3001'),
  engine: flag('engine', process.env.ENGINE_URL || 'http://localhost:8000'),
  runs: Number(flag('runs', 5)),
  concurrency: Number(flag('concurrency', 1)),
  timeoutMs: Number(flag('timeout', 420000)),
  outDir: flag('out', 'test-results'),
  tenantId: flag('tenant', '11111111-1111-4111-8111-111111111111'),
};

// Varied inputs so we do not measure a single cached/lucky prompt.
const CASES = [
  { child_name: 'An', age: 4, theme: 'Động vật', goal: 'Dũng cảm', mood: 'vui vẻ' },
  { child_name: 'Bống', age: 3, theme: 'Khu vườn', goal: 'Chia sẻ', mood: 'dịu dàng' },
  { child_name: 'Minh', age: 5, theme: 'Vũ trụ', goal: 'Tò mò', mood: 'phiêu lưu' },
  { child_name: 'Na', age: 6, theme: 'Biển cả', goal: 'Kiên nhẫn', mood: 'hài hước' },
];

/**
 * Deliberately built on node:http rather than fetch. Node's fetch aborts at
 * undici's default 300s headers/body timeout, and a single generation has
 * been measured at 390s — with fetch every slow run is reported as
 * "fetch failed" at ~301s, which measures our own client instead of the
 * Engine. Here the only deadline is the one we pass in.
 */
function timedFetch(url, options = {}, timeoutMs) {
  const startedAt = performance.now();
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  const elapsed = () => Math.round(performance.now() - startedAt);

  return new Promise((resolve) => {
    const req = client.request(
      target,
      { method: options.method || 'GET', headers: options.headers || {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            body = { _unparsed: text.slice(0, 2000) };
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            latencyMs: elapsed(),
            body,
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, latencyMs: elapsed(), error: err.message });
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

async function probeHealth() {
  const engine = await timedFetch(`${CONFIG.engine}/health`, {}, 10000);
  const be = await timedFetch(
    `${CONFIG.be}/story/latest?child_name=healthcheck`,
    { headers: { 'x-tenant-id': CONFIG.tenantId } },
    10000,
  );
  return {
    engine: { reachable: engine.ok, status: engine.status, latencyMs: engine.latencyMs },
    be: { reachable: be.ok, status: be.status, latencyMs: be.latencyMs },
  };
}

/** One story generation through the full BE -> Engine -> LLM path. */
async function runCase(index) {
  const payload = { ...CASES[index % CASES.length], language: 'vi' };
  const res = await timedFetch(
    `${CONFIG.be}/story/create`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': CONFIG.tenantId },
      body: JSON.stringify(payload),
    },
    CONFIG.timeoutMs,
  );

  const body = res.body || {};
  const sections = Array.isArray(body.content) ? body.content : [];
  const wordCount =
    body.word_count ??
    sections.reduce((n, s) => n + String(s?.text || '').split(/\s+/).filter(Boolean).length, 0);

  return {
    index,
    input: payload,
    status: res.status,
    ok: res.ok,
    latencyMs: res.latencyMs,
    transportError: res.error ?? null,
    errorCode: body?.error?.code ?? null,
    title: body.title ?? null,
    safetyStatus: body.safety_status ?? null,
    isFallback: body.is_fallback ?? null,
    llmCalls: body.llm_calls ?? null,
    sectionCount: sections.length,
    wordCount,
  };
}

async function runAll() {
  const results = [];
  const queue = Array.from({ length: CONFIG.runs }, (_, i) => i);

  async function worker() {
    for (;;) {
      const i = queue.shift();
      if (i === undefined) return;
      const r = await runCase(i);
      results.push(r);
      const label = r.ok ? (r.isFallback ? 'FALLBACK' : 'OK') : `FAIL(${r.status || r.transportError})`;
      console.log(
        `  run#${i + 1}/${CONFIG.runs} ${label} ${(r.latencyMs / 1000).toFixed(1)}s` +
          (r.title ? ` "${r.title}"` : ''),
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONFIG.concurrency, CONFIG.runs) }, worker),
  );
  return results.sort((a, b) => a.index - b.index);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i];
}

function summarise(results) {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const answered = results.filter((r) => r.ok);
  const fallbacks = answered.filter((r) => r.isFallback === true);
  const serverErrors = results.filter((r) => r.status >= 500);
  const transportErrors = results.filter((r) => r.transportError);

  return {
    total: results.length,
    answered: answered.length,
    usableStories: answered.filter((r) => r.isFallback === false).length,
    fallbacks: fallbacks.length,
    serverErrors: serverErrors.length,
    transportErrors: transportErrors.length,
    fallbackRate: answered.length ? +(fallbacks.length / answered.length).toFixed(3) : null,
    latencyMs: {
      min: latencies[0] ?? null,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies[latencies.length - 1] ?? null,
      mean: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null,
    },
  };
}

/**
 * MVP bar: the Engine may produce a poor story, but it must never take the
 * stack down. Any 5xx, dropped connection, or unanswered request is a fail.
 */
function evaluateMvp(summary) {
  const checks = [
    {
      name: 'engine_never_5xx',
      pass: summary.serverErrors === 0,
      detail: `${summary.serverErrors} response(s) with status >= 500`,
    },
    {
      name: 'no_dropped_connections',
      pass: summary.transportErrors === 0,
      detail: `${summary.transportErrors} request(s) timed out or lost the connection`,
    },
    {
      name: 'every_request_answered',
      pass: summary.answered === summary.total,
      detail: `${summary.answered}/${summary.total} answered`,
    },
    {
      name: 'fallback_rate_under_50pct',
      pass: summary.fallbackRate !== null && summary.fallbackRate < 0.5,
      detail: `fallback rate ${summary.fallbackRate}`,
    },
  ];
  return { pass: checks.every((c) => c.pass), checks };
}

async function main() {
  const startedAt = new Date();
  console.log(`Integration test — ${CONFIG.runs} run(s), concurrency ${CONFIG.concurrency}`);
  console.log(`  BE     ${CONFIG.be}`);
  console.log(`  Engine ${CONFIG.engine}\n`);

  const health = await probeHealth();
  if (!health.engine.reachable || !health.be.reachable) {
    console.error('Pre-flight failed:', JSON.stringify(health, null, 2));
    console.error('Start both services before running this test.');
    process.exitCode = 2;
    return;
  }

  const results = await runAll();
  const summary = summarise(results);
  const mvp = evaluateMvp(summary);

  const record = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    config: CONFIG,
    health,
    summary,
    mvp,
    results,
  };

  await mkdir(CONFIG.outDir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const file = path.join(CONFIG.outDir, `integration-${stamp}.json`);
  await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');

  // Append a compact row to a history file so runs are comparable over time.
  const historyFile = path.join(CONFIG.outDir, 'history.json');
  const history = existsSync(historyFile)
    ? JSON.parse(await readFile(historyFile, 'utf8'))
    : [];
  history.push({
    startedAt: record.startedAt,
    file: path.basename(file),
    runs: summary.total,
    concurrency: CONFIG.concurrency,
    fallbackRate: summary.fallbackRate,
    p50Ms: summary.latencyMs.p50,
    p95Ms: summary.latencyMs.p95,
    mvpPass: mvp.pass,
  });
  await writeFile(historyFile, JSON.stringify(history, null, 2) + '\n', 'utf8');

  console.log(`\nLatency  p50 ${summary.latencyMs.p50}ms  p95 ${summary.latencyMs.p95}ms  max ${summary.latencyMs.max}ms`);
  console.log(`Stories  ${summary.usableStories} usable, ${summary.fallbacks} fallback, ${summary.serverErrors} server error`);
  console.log('\nMVP resilience:');
  for (const c of mvp.checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
  }
  console.log(`\nSaved ${file}`);

  process.exitCode = mvp.pass ? 0 : 1;
}

main();
