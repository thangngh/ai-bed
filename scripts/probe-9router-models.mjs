#!/usr/bin/env node
/**
 * Which models can the 9router HA stack actually complete, and does the
 * balancer's failover work?
 *
 * `/v1/models` lists 9router's whole catalogue -- ~500 names across every
 * provider it knows how to speak to -- regardless of whether an account is
 * connected for them. So the model list is not evidence of availability; only
 * a completed request is. This script sends the same short prompt to every
 * candidate model against every target and records status, latency, and
 * whether any content came back at all.
 *
 * The empty-content case is the one worth naming: the anonymous `oc/`
 * reasoning models answer HTTP 200 with `content: ""` after spending the whole
 * token budget in a reasoning channel the OpenAI-compatible response drops.
 * "200 OK" therefore does not mean "usable" here, and the Engine treats such a
 * response as a provider failure.
 *
 * Usage:
 *   node scripts/probe-9router-models.mjs
 *   node scripts/probe-9router-models.mjs --models oc/deepseek-v4-flash-free,opencode
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function readEnvFile(file) {
  const out = {};
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch { /* no .env is fine when the keys come from the environment */ }
  return out;
}

const env = { ...readEnvFile(join(process.cwd(), '.env')), ...process.env };

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
}

const MODELS = flag('--models',
  // The `opencode` combo and its three members, plus the credentialed model
  // the latency spec pins -- so a single run answers both "does the anonymous
  // tier work" and "is an account connected yet".
  'opencode,oc/deepseek-v4-flash-free,oc/nemotron-3-ultra-free,oc/north-mini-code-free,ag/gemini-3-flash-agent',
).split(',').map((s) => s.trim()).filter(Boolean);

const TARGETS = [
  // The balancer injects the per-replica key itself, so it takes none.
  { name: 'lb', url: 'http://localhost:' + (env.NINEROUTER_LB_PORT || '20127'), key: null },
  { name: 'replica-a', url: 'http://localhost:20129', key: env.NINEROUTER_KEY_A },
  { name: 'replica-b', url: 'http://localhost:20130', key: env.NINEROUTER_KEY_B },
];

const TIMEOUT_MS = Number(flag('--timeout', '150000'));

// Match CustomClient.DEFAULT_MAX_TOKENS. The `oc/` models are reasoning
// models: they spend the budget on an internal chain of thought first and only
// then emit content, so a small cap returns `content: ""` with
// `finish_reason: "length"` and makes a working model look dead. Probing at
// 200 tokens reported every one of them EMPTY; at 4096 the same model wrote
// 1225 characters.
const MAX_TOKENS = Number(flag('--max-tokens', '4096'));

/**
 * 9router answers `text/event-stream` even for a non-streaming POST, so
 * `JSON.parse(body)` throws and a working model looks like it returned
 * nothing. This is the JS twin of `Engine/core/llm/custom_client.py`'s
 * `parse_sse_response` -- keep the two in step, or the probe measures the
 * parser instead of the model.
 */
function parseCompletion(body) {
  if (!body) return '';

  const frames = body
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data: ') && l.trim() !== 'data: [DONE]')
    .map((l) => l.slice(6).trim());

  if (frames.length) {
    const decoded = [];
    for (const f of frames) {
      try { decoded.push(JSON.parse(f)); } catch { /* partial frame */ }
    }
    // A frame carrying the whole message wins over reassembling deltas.
    for (let i = decoded.length - 1; i >= 0; i--) {
      const c = decoded[i]?.choices?.[0]?.message?.content;
      if (c) return c;
    }
    const streamed = decoded
      .map((d) => d?.choices?.[0]?.delta?.content ?? d?.choices?.[0]?.message?.content ?? '')
      .join('');
    if (streamed) return streamed;
  }

  // The common shape here is neither: one complete JSON object with
  // `data: [DONE]` appended on the *same line*, e.g. `...,"cost":"0"}data: [DONE]`.
  // JSON.parse throws on the trailer and the SSE split finds no frame, so scan
  // for the first balanced object and parse only that.
  let depth = 0, start = -1, inString = false, escape = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const parsed = JSON.parse(body.slice(start, i + 1));
          const c = parsed?.choices?.[0];
          return c?.message?.content ?? c?.delta?.content ?? parsed?.response ?? '';
        } catch { return ''; }
      }
    }
  }
  return '';
}

async function complete(target, model) {
  const headers = { 'content-type': 'application/json' };
  if (target.key) headers.authorization = `Bearer ${target.key}`;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${target.url}/v1/chat/completions`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Viết một đoạn truyện ngắn tiếng Việt cho bé 5 tuổi về một chú gấu bông biết chia sẻ. Khoảng 100 từ.' }],
        max_tokens: MAX_TOKENS,
      }),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* SSE, or an error body that is not JSON */ }
    const content = parseCompletion(text);
    return {
      status: res.status,
      ms: Date.now() - started,
      // Which replica served it -- the balancer stamps this, see
      // deploy/9router-lb.conf.template.
      replica: res.headers.get('x-9router-replica'),
      chars: content.length,
      // "length" here means the model hit the cap -- with 0 chars that is the
      // reasoning-budget failure, not a slow model.
      finish: json?.choices?.[0]?.finish_reason
        ?? /"finish_reason":"([a-z_]+)"/.exec(text)?.[1],
      // 200 with no content is a failure the Engine cannot use.
      usable: res.ok && content.trim().length > 0,
      sample: content.slice(0, 120),
      error: res.ok ? undefined : text.slice(0, 200) || '(empty body)',
    };
  } catch (err) {
    return { ms: Date.now() - started, usable: false, error: err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Does the balancer spread requests, and does every one of them land? */
async function probeSpread(target, model, n = 6) {
  const hits = [];
  for (let i = 0; i < n; i++) {
    const r = await complete(target, model);
    hits.push({ status: r.status, replica: r.replica, ms: r.ms, usable: r.usable });
  }
  const byReplica = {};
  for (const h of hits) byReplica[h.replica ?? 'unknown'] = (byReplica[h.replica ?? 'unknown'] ?? 0) + 1;
  return { requests: n, allAnswered: hits.every((h) => h.status === 200), byReplica, hits };
}

async function main() {
  const report = { startedAt: new Date().toISOString(), matrix: [], spread: null };

  console.log(`Probing ${MODELS.length} model(s) x ${TARGETS.length} target(s)\n`);
  for (const model of MODELS) {
    for (const target of TARGETS) {
      if (target.key === undefined || target.key === '') {
        console.log(`  ${model.padEnd(32)} ${target.name.padEnd(10)} SKIP (no key in .env)`);
        continue;
      }
      const r = await complete(target, model);
      report.matrix.push({ model, target: target.name, ...r });
      const verdict = r.usable ? 'USABLE' : r.status === 200 ? 'EMPTY (200, no content)' : `FAIL ${r.status ?? ''}`;
      console.log(
        `  ${model.padEnd(32)} ${target.name.padEnd(10)} ${String(verdict).padEnd(24)} ` +
        `${(r.ms / 1000).toFixed(1)}s ${r.chars ?? 0} chars` +
        (r.finish ? ` finish=${r.finish}` : '') +
        (r.replica ? ` [${r.replica}]` : '') +
        (r.error ? ` ${r.error.replace(/\s+/g, ' ').slice(0, 80)}` : ''),
      );
    }
  }

  // Pick something that answered to exercise the balancer with; a model that
  // 404s everywhere would measure nothing but the 404 path.
  const spreadModel = report.matrix.find((r) => r.target === 'lb' && r.status === 200)?.model;
  if (spreadModel) {
    console.log(`\nBalancer spread over 6 requests (${spreadModel}):`);
    report.spread = { model: spreadModel, ...(await probeSpread(TARGETS[0], spreadModel)) };
    console.log(`  answered: ${report.spread.allAnswered ? 'all 6 x 200' : 'NOT all 200'}`);
    console.log(`  split: ${JSON.stringify(report.spread.byReplica)}`);
  }

  const outDir = join(process.cwd(), 'test-results');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `9router-models-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nSaved ${file}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
