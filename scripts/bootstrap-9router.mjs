#!/usr/bin/env node
/**
 * Bring a fresh 9router replica from "container started" to "can serve the
 * Engine", without touching the dashboard.
 *
 * A fresh 9router is not usable even though Docker reports it healthy:
 *   - every /v1/* call is 401 until a password is persisted and an API key
 *     minted (POST /api/keys),
 *   - and `model: "opencode"` is 404 because that alias is not built in --
 *     it is a *combo* the operator defines, mapping one name onto several
 *     backends.
 *
 * Both steps are plain JSON APIs, so both are scriptable. The combo members
 * default to the OpenCode Free models, which are an anonymous passthrough to
 * opencode.ai/zen and need no provider connection at all -- verified by
 * completing a request on a replica whose /api/providers was `{"connections":[]}`.
 *
 * Usage:
 *   node scripts/bootstrap-9router.mjs \
 *     --replicas http://localhost:20129,http://localhost:20130
 *
 * Prints a CUSTOM_LLM_API_KEY per replica and writes the whole result to
 * test-results/9router-bootstrap-<timestamp>.json.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_COMBO_MODELS = [
  'oc/deepseek-v4-flash-free',
  'oc/nemotron-3-ultra-free',
  'oc/north-mini-code-free',
];

function parseArgs(argv) {
  const args = {
    replicas: ['http://localhost:20129', 'http://localhost:20130'],
    // No fallback. This script onboards a replica *and* mints its API key, so
    // a hardcoded default here is the same committed password the compose file
    // used to carry -- see the note on INITIAL_PASSWORD in
    // docker-compose.9router-ha.yml. Missing is checked after parsing, so
    // --password still works.
    password: process.env.NINEROUTER_PASSWORD || '',
    combo: 'opencode',
    models: DEFAULT_COMBO_MODELS,
    keyName: 'ai-bedtime-engine',
  };
  for (let i = 2; i < argv.length; i += 2) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case '--replicas': args.replicas = value.split(',').map((s) => s.trim()); break;
      case '--password': args.password = value; break;
      case '--combo': args.combo = value; break;
      case '--models': args.models = value.split(',').map((s) => s.trim()); break;
      case '--key-name': args.keyName = value; break;
      default: throw new Error(`unknown flag ${argv[i]}`);
    }
  }
  return args;
}

/**
 * 9router authenticates the dashboard API with a session cookie, so every
 * call after the login has to carry it back.
 */
async function api(base, path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not every response is JSON */ }

  return { status: res.status, ok: res.ok, json, text, setCookie: res.headers.getSetCookie?.() ?? [] };
}

async function bootstrapReplica(base, args) {
  const step = { replica: base };

  const login = await api(base, '/api/auth/login', {
    method: 'POST',
    body: { password: args.password },
  });
  if (!login.ok) {
    // The usual cause is a volume created before INITIAL_PASSWORD was set:
    // the env var only applies on first init, so an old volume keeps the old
    // (or absent) password and every login fails.
    throw new Error(
      `login failed (${login.status}). If the volume predates INITIAL_PASSWORD, ` +
      `recreate it: docker compose ... rm -sf <replica> && docker volume rm <volume>`,
    );
  }
  const cookie = login.setCookie.map((c) => c.split(';')[0]).join('; ');
  step.loggedIn = true;

  // Reuse an existing key rather than minting a duplicate on every run --
  // 9router only reveals the secret at creation time, so a fresh key would
  // orphan whatever the Engine is currently configured with.
  const keys = await api(base, '/api/keys', { cookie });
  const existing = (keys.json?.keys ?? []).find((k) => k.name === args.keyName);
  if (existing) {
    step.apiKey = null;
    step.apiKeyNote = `a key named "${args.keyName}" already exists; its secret is not retrievable — delete it in the dashboard to mint a new one`;
  } else {
    const created = await api(base, '/api/keys', {
      method: 'POST', cookie, body: { name: args.keyName },
    });
    if (!created.ok) throw new Error(`could not create API key (${created.status}): ${created.text}`);
    step.apiKey = created.json.key;
    step.machineId = created.json.machineId;
  }

  const combos = await api(base, '/api/combos', { cookie });
  const already = (combos.json?.combos ?? []).find((c) => c.name === args.combo);
  if (already) {
    step.combo = { name: args.combo, created: false, models: already.models };
  } else {
    const made = await api(base, '/api/combos', {
      method: 'POST', cookie, body: { name: args.combo, models: args.models },
    });
    if (!made.ok) throw new Error(`could not create combo (${made.status}): ${made.text}`);
    step.combo = { name: args.combo, created: true, models: made.json.models };
  }

  return step;
}

/** Proves the replica can actually complete, which `docker ps` does not. */
async function smokeTest(base, apiKey, model) {
  if (!apiKey) return { skipped: 'no API key available this run' };
  const startedAt = Date.now();
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 20,
      }),
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, ms: Date.now() - startedAt, sample: text.slice(0, 200) };
  } catch (err) {
    return { ok: false, ms: Date.now() - startedAt, error: err.message };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.password) {
    // Fail closed. The alternative -- carry on with an empty password -- ends
    // in a confusing 401 from the login below, which reads like a broken
    // replica rather than a missing variable.
    console.error(
      'No password. Set NINEROUTER_PASSWORD (see .env.example) or pass --password.\n' +
      'It must match the INITIAL_PASSWORD the replica volume was created with.',
    );
    process.exit(1);
  }
  console.log(`Bootstrapping ${args.replicas.length} 9router replica(s)\n`);

  const results = [];
  for (const base of args.replicas) {
    try {
      const step = await bootstrapReplica(base, args);
      step.smoke = await smokeTest(base, step.apiKey, args.combo);
      results.push(step);

      console.log(`  ${base}`);
      console.log(`    combo "${step.combo.name}" ${step.combo.created ? 'created' : 'already present'}`);
      if (step.apiKey) console.log(`    CUSTOM_LLM_API_KEY=${step.apiKey}`);
      else console.log(`    ${step.apiKeyNote}`);
      if (step.smoke.skipped) console.log(`    smoke test skipped: ${step.smoke.skipped}`);
      else console.log(`    smoke test ${step.smoke.ok ? 'OK' : 'FAILED'} in ${step.smoke.ms}ms`);
      console.log('');
    } catch (err) {
      results.push({ replica: base, error: err.message });
      console.log(`  ${base}\n    FAILED: ${err.message}\n`);
    }
  }

  const outDir = join(process.cwd(), 'test-results');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `9router-bootstrap-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ startedAt: new Date().toISOString(), args: { ...args, password: '<redacted>' }, results }, null, 2));
  console.log(`Saved ${file}`);

  if (results.some((r) => r.error || r.smoke?.ok === false)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
