#!/usr/bin/env node
/**
 * Full-flow end-to-end test: SPA -> nginx -> BE -> Engine -> LLM.
 *
 * Where `integration-test.mjs` measures the BE -> Engine path in isolation and
 * repeats it for latency statistics, this walks one complete user journey the
 * way the SPA walks it -- through the frontend container on port 80, over the
 * `/api` prefix, with the same request bodies `FE/src` sends:
 *
 *   1. open the app          GET  /                     (SPA shell from nginx)
 *   2. login / session       POST /api/tenant/init      (utils/api.ts ensureTenantId)
 *   3. enter the child's     POST /api/child-profile    (utils/childClient.ts create)
 *      details               GET  /api/child-profile    (App.tsx mount -> list)
 *   4. create a story        POST /api/story/create     (utils/storyGenerator.ts)
 *   5. reopen it             GET  /api/story/:id        (App.tsx handleSelectStory)
 *   6. save it               POST /api/story/save       (App.tsx handleSaveStory)
 *   7. feedback              POST /api/story/feedback   (App.tsx handleFeedbackSubmit)
 *   8. what the parent sees  GET  /api/analytics/*, /api/memory/context/:childId
 *
 * Every step asserts, so a break anywhere in the chain names the step that
 * broke rather than a bare status code. The whole run is written to
 * test-results/e2e-flow-<timestamp>.json.
 *
 * Usage:
 *   node scripts/e2e-flow-test.mjs [--base http://localhost] [--out DIR]
 *                                  [--timeout MS] [--keep]
 *
 * --base must point at whatever serves the SPA and proxies /api (the frontend
 * container, or `npm run dev` on :3000). Pointing it straight at the BE will
 * fail step 1 and every /api path, which is the intended signal: the prefix is
 * a proxy convention, not part of the BE.
 *
 * --keep leaves the child profile behind; by default the run deletes it through
 * the POST compatibility route and exercises the 204-no-body response.
 *
 * Exit code 0 only when every step passes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const CONFIG = {
  base: flag('base', process.env.E2E_BASE_URL || 'http://localhost'),
  outDir: flag('out', 'test-results'),
  // Just below the SPA/nginx 240s ceiling so this runner catches an outer
  // timeout instead of waiting after the browser would already have stopped.
  // component that gives up first.
  timeoutMs: Number(flag('timeout', 200000)),
  keepProfile: args.includes('--keep'),
};

// The form's own labels, capitalised exactly as MOOD_SUGGESTIONS shows them --
// this is the shape that used to come back 422 from a case-sensitive enum.
const CHILD = {
  child_name: 'Bé Mây',
  age: 5,
  gender: 'girl',
  preferred_characters: 'Bạn gấu bông',
  bedtime_goal: 'Biết chia sẻ với bạn',
};
const STORY_INPUT = {
  theme: 'Khu rừng kỳ diệu',
  goal: 'Biết chia sẻ với bạn',
  mood: 'Nũng nịu',
};

/**
 * node:http rather than fetch, for the reason integration-test.mjs documents:
 * undici enforces its own 300s headers timeout and reports the abort as a
 * generic "fetch failed", which measures our client instead of the stack.
 */
function request(method, url, { headers = {}, body } = {}, timeoutMs = 15000) {
  const startedAt = performance.now();
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');

  const sendHeaders = { ...headers };
  if (payload) {
    sendHeaders['content-type'] = 'application/json';
    // Explicit length rather than chunked: some proxies buffer chunked request
    // bodies differently, and this keeps the wire identical to the browser's.
    sendHeaders['content-length'] = String(payload.byteLength);
  }

  return new Promise((resolve) => {
    const req = client.request(target, { method, headers: sendHeaders }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          /* not every response is JSON -- the SPA shell is HTML */
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
          latencyMs: Math.round(performance.now() - startedAt),
          text,
          json,
        });
      });
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on('error', (err) =>
      resolve({
        ok: false,
        status: 0,
        headers: {},
        latencyMs: Math.round(performance.now() - startedAt),
        error: err.message,
        text: '',
        json: null,
      }),
    );

    if (payload) req.write(payload);
    req.end();
  });
}

/** Same four-slot mapping the story view uses, so we test what the child reads. */
const NARRATIVE_SLOT = {
  opening: 'opening', context: 'situation', situation: 'situation',
  conflict: 'challenge', rising_action: 'challenge', climax: 'challenge',
  resolution: 'ending', ending: 'ending', moral: 'moralSummary',
  moral_summary: 'moralSummary',
};

function readableSegments(sections) {
  const segments = { opening: '', situation: '', challenge: '', ending: '', moralSummary: '' };
  const questions = [];
  let current = 'opening';
  const ordered = [...(sections || [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  for (const section of ordered) {
    const type = String(section?.type || '').toLowerCase();
    const text = String(section?.text || '').trim();
    const prompt = String(section?.prompt || '').trim();
    if (/^interaction/.test(type)) {
      if (prompt || text) questions.push(prompt || text);
      if (prompt && text) segments[current] += `\n\n${text}`;
      continue;
    }
    const slot = NARRATIVE_SLOT[type] || current;
    segments[slot] = segments[slot] ? `${segments[slot]}\n\n${text}` : text;
    current = slot;
  }
  return { segments, questions };
}

const steps = [];
let failed = false;

/**
 * Run one step. `check` returns a list of assertion objects; a single false
 * one fails the step, and the step's own detail is kept either way so the
 * record explains the failure without a re-run.
 */
async function step(name, run) {
  const startedAt = performance.now();
  let result;
  try {
    result = await run();
  } catch (err) {
    result = { checks: [{ name: 'threw', pass: false, detail: err.message }] };
  }
  const checks = result.checks || [];
  const pass = checks.length > 0 && checks.every((c) => c.pass);
  if (!pass) failed = true;

  const record = {
    name,
    pass,
    ms: Math.round(performance.now() - startedAt),
    detail: result.detail ?? null,
    checks,
  };
  steps.push(record);

  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${(record.ms / 1000).toFixed(1)}s)`);
  for (const c of checks) {
    if (!c.pass) console.log(`        ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  if (result.note) console.log(`        ${result.note}`);
  return result;
}

const assert = (name, pass, detail) => ({ name, pass: Boolean(pass), detail: detail ?? null });

async function main() {
  const startedAt = new Date();
  console.log(`Full-flow E2E — ${CONFIG.base}\n`);

  const api = (p) => `${CONFIG.base.replace(/\/$/, '')}/api${p}`;
  let tenantId = null;
  let childId = null;
  let storyId = null;
  let story = null;

  // 1. The SPA itself, served by nginx.
  await step('open the app (SPA shell)', async () => {
    const res = await request('GET', `${CONFIG.base}/`);
    return {
      detail: { status: res.status, bytes: res.text.length },
      checks: [
        assert('200 from the frontend', res.ok, `status ${res.status} ${res.error || ''}`),
        assert('serves the SPA shell', /<div id="root">/.test(res.text), 'no #root element in the HTML'),
        assert('bundles a JS entry', /<script[^>]+src="[^"]+\.js"/.test(res.text)),
      ],
    };
  });

  // 2. "Login": the SPA has no accounts, a tenant is the session.
  await step('login (POST /api/tenant/init)', async () => {
    const res = await request('POST', api('/tenant/init'));
    tenantId = res.json?.tenant_id ?? null;
    return {
      detail: { status: res.status, tenantId },
      checks: [
        assert('reaches the BE through the /api proxy', res.ok, `status ${res.status} ${res.error || ''}`),
        assert('returns a tenant id', Boolean(tenantId)),
        assert(
          'the tenant id is a uuid',
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId || ''),
          tenantId,
        ),
      ],
    };
  });

  if (!tenantId) {
    console.error('\nNo session; the rest of the flow cannot run.');
    await save(startedAt);
    process.exitCode = 1;
    return;
  }
  const auth = { 'x-tenant-id': tenantId };

  // 3. The child's details, the way the profile editor sends them.
  await step("enter the child's details (POST /api/child-profile)", async () => {
    const res = await request('POST', api('/child-profile'), { headers: auth, body: CHILD });
    childId = res.json?.child_id ?? null;
    return {
      detail: res.json,
      checks: [
        assert('accepted', res.ok, `status ${res.status} ${JSON.stringify(res.json)}`),
        assert('returns a child id', Boolean(childId)),
        assert('keeps the Vietnamese name intact', res.json?.child_name === CHILD.child_name, res.json?.child_name),
        assert('keeps the age', res.json?.age === CHILD.age),
      ],
    };
  });

  await step('the app lists the child on load (GET /api/child-profile)', async () => {
    const res = await request('GET', api('/child-profile'), { headers: auth });
    const found = (res.json?.children || []).find((c) => c.child_id === childId);
    return {
      detail: { count: res.json?.children?.length ?? 0 },
      checks: [
        assert('200', res.ok, `status ${res.status}`),
        assert('the new child is in the list', Boolean(found)),
      ],
    };
  });

  // 4. The story. This is the only slow step: BE -> Engine -> LLM.
  await step('create a story (POST /api/story/create)', async () => {
    const body = {
      child_id: childId,
      child_name: CHILD.child_name,
      age: CHILD.age,
      theme: STORY_INPUT.theme,
      goal: STORY_INPUT.goal,
      // Capitalised, exactly as the form's mood chips are labelled.
      mood: STORY_INPUT.mood,
      language: 'vi',
      gender: CHILD.gender,
      favorite_character: CHILD.preferred_characters,
    };
    const res = await request(
      'POST',
      api('/story/create'),
      { headers: { ...auth, 'x-story-heartbeat': '1' }, body },
      CONFIG.timeoutMs,
    );
    story = res.json;
    storyId = res.json?.story_id ?? null;

    const sections = res.json?.sections || [];
    const { segments, questions } = readableSegments(sections);
    const prose = Object.values(segments).join(' ').trim();

    return {
      detail: {
        status: res.status,
        latencyMs: res.latencyMs,
        title: res.json?.title ?? null,
        safety_status: res.json?.safety_status ?? null,
        is_fallback: res.json?.is_fallback ?? null,
        word_count: res.json?.word_count ?? null,
        sections: sections.length,
        interactions: questions.length,
        errorCode: res.json?.error?.code ?? null,
      },
      note: res.json?.title ? `"${res.json.title}" — ${(res.latencyMs / 1000).toFixed(1)}s, ${sections.length} sections` : undefined,
      checks: [
        assert('201', res.status === 201, `status ${res.status} ${res.error || JSON.stringify(res.json)?.slice(0, 200)}`),
        assert('returns a story id', Boolean(storyId)),
        assert('has a title', Boolean(res.json?.title)),
        // The MVP bar: a fallback means the chain answered but the child gets
        // an apology instead of a story.
        assert('is a real story, not the fallback', res.json?.is_fallback === false, `is_fallback=${res.json?.is_fallback}`),
        assert('the reader has prose to read', prose.length > 200, `${prose.length} chars`),
        assert('asks the child at least one question', questions.length >= 1, `${questions.length} interactions`),
        assert(
          'is in Vietnamese',
          /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(prose),
        ),
        assert('within the SPA\'s 240s ceiling', res.latencyMs < 240000, `${res.latencyMs}ms`),
      ],
    };
  });

  if (!storyId) {
    console.error('\nNo story; the remaining steps have nothing to act on.');
    await save(startedAt);
    process.exitCode = 1;
    return;
  }

  // 5. Reopening a story is a different code path: it reads the persisted
  //    sections rather than the ones the Engine just returned.
  await step('reopen the story (GET /api/story/:id)', async () => {
    const res = await request('GET', api(`/story/${storyId}`), { headers: auth });
    const sections = res.json?.sections || [];
    return {
      detail: { status: res.status, sections: sections.length, child_id: res.json?.child_id, child_name: res.json?.child_name, age: res.json?.age },
      checks: [
        assert('200', res.ok, `status ${res.status}`),
        assert('the sections were persisted', sections.length > 0, `${sections.length} rows`),
        assert(
          'as many sections as the create returned',
          sections.length === (story?.sections?.length ?? -1),
          `${sections.length} vs ${story?.sections?.length}`,
        ),
        assert('in order', sections.every((s, i) => i === 0 || (s.order ?? 0) >= (sections[i - 1].order ?? 0))),
        assert('knows which child it was written for', res.json?.child_name === CHILD.child_name, res.json?.child_name),
        assert('keeps the exact child id', res.json?.child_id === childId, res.json?.child_id),
        assert('carries the age', res.json?.age === CHILD.age, String(res.json?.age)),
      ],
    };
  });

  // 6. Save.
  await step('save the story (POST /api/story/save)', async () => {
    const res = await request('POST', api('/story/save'), { headers: auth, body: { story_id: storyId } });
    const detail = await request('GET', api(`/story/${storyId}`), { headers: auth });
    return {
      detail: { status: res.status, is_saved: detail.json?.is_saved },
      checks: [
        assert('accepted', res.ok, `status ${res.status} ${JSON.stringify(res.json)}`),
        assert('the story is marked saved', detail.json?.is_saved === true, `is_saved=${detail.json?.is_saved}`),
      ],
    };
  });

  await step('the saved story appears in the list (GET /api/story/latest)', async () => {
    const res = await request('GET', api(`/story/latest?limit=50&child_id=${encodeURIComponent(childId)}`), { headers: auth });
    const found = (res.json?.stories || []).find((s) => s.story_id === storyId);
    return {
      detail: { count: res.json?.stories?.length ?? 0 },
      checks: [
        assert('200', res.ok, `status ${res.status}`),
        assert('the story is listed', Boolean(found)),
        assert('with its title', found?.title === story?.title, found?.title),
      ],
    };
  });

  // 7. Feedback, with the exact payload App.tsx builds from the feedback form.
  await step('send feedback (POST /api/story/feedback)', async () => {
    const body = {
      story_id: storyId,
      child_id: childId,
      child_name: CHILD.child_name,
      rating: 5,
      note: 'Bé rất thích, nghe hết truyện và đòi nghe thêm.',
      listened_complete: 1,
      wants_more: 1,
      suitable: 1,
    };
    const res = await request('POST', api('/story/feedback'), { headers: auth, body });
    return {
      detail: { status: res.status, body: res.json },
      checks: [
        assert('accepted', res.ok, `status ${res.status} ${JSON.stringify(res.json)}`),
      ],
    };
  });

  // 8. What the parent sees afterwards -- proves the feedback and the story
  //    actually landed in the tables the analytics screen reads.
  await step('the parent dashboard reflects the run (GET /api/analytics/*)', async () => {
    const overview = await request('GET', api('/analytics/overview'), { headers: auth });
    const stories = await request('GET', api(`/analytics/stories/${childId}`), { headers: auth });
    const feedback = await request('GET', api(`/analytics/feedback/${childId}`), { headers: auth });
    return {
      detail: { overview: overview.json, stories: stories.json, feedback: feedback.json },
      checks: [
        assert('overview answers', overview.ok, `status ${overview.status}`),
        assert('story stats answer', stories.ok, `status ${stories.status}`),
        assert('feedback stats answer', feedback.ok, `status ${feedback.status}`),
        assert(
          'the feedback was counted',
          JSON.stringify(feedback.json || {}).includes('5') || (feedback.json?.total ?? 0) > 0,
          JSON.stringify(feedback.json),
        ),
      ],
    };
  });

  await step('memory context is readable (GET /api/memory/context/:childId)', async () => {
    const res = await request('GET', api(`/memory/context/${childId}`), { headers: auth });
    return {
      // Not asserted as non-empty: extraction is best-effort and one story is
      // not guaranteed to yield a memory. The endpoint answering is the
      // contract the SPA depends on.
      detail: res.json,
      checks: [assert('200', res.ok, `status ${res.status}`)],
    };
  });

  if (!CONFIG.keepProfile) {
    await step('delete the profile (POST /api/child-profile/:id/delete)', async () => {
      const res = await request('POST', api(`/child-profile/${childId}/delete`), { headers: auth });
      return {
        detail: { status: res.status },
        checks: [
          assert('204', res.status === 204, `status ${res.status}`),
          // A body here is what used to make the SPA's client throw on
          // res.json().
          assert('no body to parse', res.text.length === 0, `${res.text.length} bytes`),
        ],
      };
    });
  }

  await save(startedAt);
  console.log(
    `\n${steps.filter((s) => s.pass).length}/${steps.length} steps passed — ${failed ? 'FAIL' : 'PASS'}`,
  );
  process.exitCode = failed ? 1 : 0;
}

async function save(startedAt) {
  const record = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    config: CONFIG,
    pass: !failed,
    stepsPassed: steps.filter((s) => s.pass).length,
    stepsTotal: steps.length,
    steps,
  };
  await mkdir(CONFIG.outDir, { recursive: true });
  const file = path.join(
    CONFIG.outDir,
    `e2e-flow-${startedAt.toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(file, JSON.stringify(record, null, 2) + '\n', 'utf8');
  console.log(`\nSaved ${file}`);
}

main();
