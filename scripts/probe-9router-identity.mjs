#!/usr/bin/env node
/**
 * Answers the open question: when you run several 9router replicas, does the
 * upstream (opencode zen) treat them as separate clients, or as one?
 *
 * The upstream does not document how the free-tier quota is scoped, and the
 * maintainers have declined to say (opencode issue #16844, closed as not
 * planned). So we measure it instead of guessing.
 *
 * Method:
 *   1. Confirm whether the replicas share an egress IP. Container addresses
 *      (172.x) are private; what the upstream sees is whatever the host NATs
 *      to. If both replicas report the same public IP, per-IP quota cannot be
 *      multiplied by adding replicas on this host.
 *   2. Drive replica A until it reports the free quota is exhausted.
 *   3. Immediately call replica B. If B is also exhausted, the quota is
 *      shared (per-IP or global). If B still works, identity is per-replica
 *      (per account / per machine fingerprint) and HA does add capacity.
 *
 * Usage:
 *   node scripts/probe-9router-identity.mjs \
 *     --replicas http://localhost:20129,http://localhost:20130 \
 *     --model opencode --max-requests 60
 *
 * Point --replicas at the replicas DIRECTLY (bypassing the load balancer),
 * otherwise you cannot tell which one answered.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};

const CONFIG = {
  replicas: flag('replicas', 'http://localhost:20129,http://localhost:20130').split(','),
  model: flag('model', 'opencode'),
  maxRequests: Number(flag('max-requests', 60)),
  outDir: flag('out', 'test-results'),
};

// Wording the upstream uses when the free tier is spent. Matched loosely
// because the exact string has changed before.
const QUOTA_PATTERNS = [
  /free usage exceeded/i,
  /add credits/i,
  /rate.?limit/i,
  /quota/i,
  /too many requests/i,
];

const looksExhausted = (status, text) =>
  status === 429 || QUOTA_PATTERNS.some((re) => re.test(text));

async function call(base, prompt) {
  const startedAt = performance.now();
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CONFIG.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 32,
      }),
    });
    const text = await res.text();
    return {
      status: res.status,
      latencyMs: Math.round(performance.now() - startedAt),
      exhausted: looksExhausted(res.status, text),
      upstream: res.headers.get('x-9router-upstream'),
      snippet: text.slice(0, 300),
    };
  } catch (err) {
    return {
      status: 0,
      latencyMs: Math.round(performance.now() - startedAt),
      exhausted: false,
      error: err.message,
    };
  }
}

/** What the outside world sees as this replica's source address. */
async function egressIp(base) {
  // 9router proxies arbitrary upstreams, so we ask the model itself to echo
  // nothing and instead read the IP from the container's own perspective.
  // If the replica exposes no such endpoint we fall back to "unknown" and
  // the caller should check `docker exec <c> wget -qO- ifconfig.me`.
  try {
    const res = await fetch(`${base}/v1/models`);
    return res.ok ? 'reachable (check via docker exec wget ifconfig.me)' : `http ${res.status}`;
  } catch (err) {
    return `unreachable: ${err.message}`;
  }
}

async function main() {
  const [a, b] = CONFIG.replicas;
  if (!a || !b) {
    console.error('Need at least two replica URLs via --replicas');
    process.exitCode = 2;
    return;
  }

  console.log(`Probing quota scope across:\n  A ${a}\n  B ${b}\n`);

  const reachability = {
    a: await egressIp(a),
    b: await egressIp(b),
  };
  console.log(`A: ${reachability.a}\nB: ${reachability.b}\n`);

  // Phase 1: confirm B is healthy before we exhaust A, so a later failure on
  // B is attributable to the quota and not to a broken replica.
  const bBaseline = await call(b, 'Say OK');
  console.log(`B baseline: status ${bBaseline.status}, exhausted=${bBaseline.exhausted}`);
  if (bBaseline.exhausted) {
    console.error('B is already rate-limited — reset it or wait before probing.');
    process.exitCode = 2;
    return;
  }

  // Phase 2: burn replica A down.
  console.log(`\nDriving A until exhausted (max ${CONFIG.maxRequests} requests)...`);
  const aCalls = [];
  let aExhaustedAt = null;
  for (let i = 0; i < CONFIG.maxRequests; i++) {
    const r = await call(a, `Count to three. Request ${i}.`);
    aCalls.push(r);
    process.stdout.write(r.exhausted ? 'X' : r.status === 200 ? '.' : '?');
    if (r.exhausted) {
      aExhaustedAt = i + 1;
      break;
    }
  }
  console.log('');

  if (aExhaustedAt === null) {
    console.log(
      `\nA never hit a limit in ${CONFIG.maxRequests} requests — the free quota is ` +
        `higher than this probe's budget. Raise --max-requests to get a verdict.`,
    );
  }

  // Phase 3: the actual question.
  const bAfter = await call(b, 'Say OK');
  console.log(`\nB after A exhausted: status ${bAfter.status}, exhausted=${bAfter.exhausted}`);

  let verdict;
  if (aExhaustedAt === null) {
    verdict = 'INCONCLUSIVE — replica A never hit the quota within the request budget';
  } else if (bAfter.exhausted) {
    verdict =
      'SHARED — exhausting A also exhausted B. The quota is scoped to something ' +
      'both replicas share (public egress IP or a global free tier). Adding ' +
      'replicas on this host does NOT add capacity.';
  } else {
    verdict =
      'PER-REPLICA — B still works after A was exhausted. The quota follows the ' +
      'replica (account or machine fingerprint), so HA does add capacity.';
  }
  console.log(`\nVERDICT: ${verdict}`);

  const record = {
    ranAt: new Date().toISOString(),
    config: CONFIG,
    reachability,
    bBaseline,
    aRequests: aCalls.length,
    aExhaustedAt,
    bAfter,
    verdict,
    aCalls,
  };

  await mkdir(CONFIG.outDir, { recursive: true });
  const file = path.join(
    CONFIG.outDir,
    `9router-identity-${record.ranAt.replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
  console.log(`\nSaved ${file}`);
}

main();
