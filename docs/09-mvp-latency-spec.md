# Spec: make the MVP return a story

Status: draft, 2026-08-03. Written against measurements in
[08-engine-resilience-and-9router-ha.md](./08-engine-resilience-and-9router-ha.md)
and `test-results/history.json`.

## The problem, stated precisely

Three integration runs, twelve requests, **zero usable stories**. The latest:

| run | result | latency |
|---|---|---|
| 1 | FALLBACK | 285.8s |
| 2 | 502 | 301.4s |
| 3 | FALLBACK | 161.2s |
| 4 | 502 | 301.3s |

The Engine never crashed. It is not a stability problem — it is a *latency*
problem, and every failure is a consequence of one generation taking longer
than anyone downstream is willing to wait.

Note the two 502s at 301.3s and 301.4s. That is not the configured timeout;
it is a hard ceiling described in §1.

The goal of this spec is one number: **p95 under 60s, with a real story at
the end.** Everything below serves that.

---

## 1. Fix the timeout ceiling (BE)

**What's wrong.** `EngineGatewayService.generate` aborts via
`AbortController` set to `engine.timeoutMs`. But Node's `fetch` (undici)
enforces its own 300s `headersTimeout` first, and it throws a plain
`TypeError`, not an `AbortError`. So:

- any `ENGINE_TIMEOUT_MS` above 300000 is **silently ignored**;
- a genuine timeout is misreported as `ENGINE_ERROR` instead of
  `ENGINE_TIMEOUT`, so the failure mode is invisible in logs;
- `engine-gateway.service.ts:53` hardcodes `'Engine timeout after 120s'`,
  which is wrong for every configured value.

**Change.** Give the request an explicit undici `Agent` with
`headersTimeout: 0` and `bodyTimeout: 0`, leaving `AbortController` as the
only deadline. Then interpolate the real value into the message. The pattern
is already proven in `scripts/integration-test.mjs`, which dropped to
`node:http` for exactly this reason and documents it.

**Acceptance.** Set `ENGINE_TIMEOUT_MS=310000`, make the Engine sleep 305s,
and assert the response is `ENGINE_TIMEOUT` at ~310s — not `ENGINE_ERROR` at
~300s.

> This is a correctness fix, not a performance fix. It stops the system from
> lying about why it failed. It does **not** make anything faster, and raising
> the timeout is not a fix — §2–§4 are.

---

## 2. Give the pipeline a deadline (Engine)

**What's wrong.** `StoryPipeline.run` has no time budget. Worst case it makes
planner ×3 + writer ×3 + reviewer + writer-retry ×2 + reviewer = **up to 10
LLM calls**, each allowed 300s by `custom_client.DEFAULT_TIMEOUT_SECONDS`.
The theoretical ceiling is ~50 minutes. Worse, `_call_retry` catches *every*
exception (`pipeline.py:120`) — including timeouts — so a stage that times out
is retried at full cost rather than abandoned.

**Change.**

- Add `PIPELINE_BUDGET_SECONDS` (default **45**). Record a deadline at the
  start of `run()`; before each `_call_llm`, if the remaining budget is under
  the per-stage minimum, stop and return the fallback.
- Pass the remaining budget down as the per-call timeout, so no single call
  can outlive the whole budget.
- In `_call_retry`, do not retry on timeout — only on validation failure.
  A stage that timed out will time out again; retrying only burns the budget.

**Acceptance.** With an LLM stub that sleeps 30s per call, `run()` returns a
fallback in ≤50s having made ≤2 calls. Add to `Engine/tests/test_pipeline.py`.

**Why 45s.** It must sit safely under BE's `ENGINE_TIMEOUT_MS` so the user
gets *a* story rather than a 502. Set `ENGINE_TIMEOUT_MS=60000` alongside.

---

## 3. Fail fast on empty content (Engine)

**What's wrong.** `parse_sse_response` returns `""` when it cannot find
content, and `CustomClient.complete` returns that as success. The measured
consequence: a **294s** writer call returned an empty body, the pipeline
treated it as a valid response, `extract_json_block` failed, and the stage was
retried. The router never got the chance to try another provider, because from
its point of view nothing failed.

**Change.** Raise an explicit `EmptyCompletionError` from
`CustomClient.complete` when the parsed content is empty or whitespace. The
router already catches `Exception` per provider (`router.py:69`) and falls
through, so this is all that is needed to activate the fallback chain.

Apply the same rule to the other clients — this is a client contract
("`complete` returns non-empty text or raises"), not a custom-proxy quirk.

**Acceptance.** `test_custom_client.py`: a `200` response whose body yields no
content raises rather than returning `""`.

---

## 4. Pin the model (config)

**What's wrong.** `CUSTOM_LLM_MODEL` defaults to `opencode`, which is not a
model — `GET /api/combos` shows it is a combo over
`oc/deepseek-v4-flash-free`, `oc/nemotron-3-ultra-free`,
`oc/north-mini-code-free`. Measured on identical prompts:

| Backend | Latency | Note |
|---|---|---|
| `deepseek-v4-flash-free` | 5.9s | |
| `nemotron-3-ultra-free` | 7.2s | |
| `north-mini-code-free` | 40.7s | ignored the Vietnamese-only instruction, renamed the child "Lily" |

A 7× latency spread and non-reproducible quality, from one model name. This
is the single largest source of the variance in §0, and no amount of timeout
tuning compensates for it.

**Change.** Pin `CUSTOM_LLM_MODEL=oc/deepseek-v4-flash-free`. Keep the combo
only as a manual fallback.

**Acceptance.** Ten consecutive generations all report the same backend in
`model`, and none contain a non-Vietnamese child name.

---

## 5. Make configuration reproducible (Engine)

**What's wrong.** Nothing in `Engine/` calls `load_dotenv` — verified, zero
matches. `Engine/.env` is therefore honoured **only** under Docker, via
compose's `env_file:`. Run the Engine directly and the file is silently
ignored; the process inherits whatever the launching shell happened to export.

This is not theoretical. The currently-running Engine is serving requests
through a `CUSTOM_LLM_URL` that **does not appear in `Engine/.env` at all** —
it came from a shell. Nobody can reproduce the measurements in §0 from the
repo alone, which undermines every number in this document.

Related, in the same area: `custom_client.py:137-138` reads
`OPENAI_MAX_TOKENS` and `OPENAI_TEMPERATURE` — the *OpenAI* provider's
settings. `Engine/.env` sets `OPENAI_MAX_TOKENS=1024`, and the comment at
`custom_client.py:9-13` states that 1024 is precisely the value that yields
empty content for reasoning models. Under Docker the custom client is
truncated to 1024 by a variable named for a different provider.

**Change.**

- Call `load_dotenv()` at Engine startup so local and Docker runs agree.
- Introduce `CUSTOM_LLM_MAX_TOKENS` / `CUSTOM_LLM_TEMPERATURE`, falling back
  to the `OPENAI_*` names for compatibility.
- Commit a complete `Engine/.env.example` including `CUSTOM_LLM_URL`,
  `CUSTOM_LLM_MODEL`, `CUSTOM_LLM_API_KEY`.

**Acceptance.** `python -m Engine.main` with only `Engine/.env` present routes
to the custom provider — no shell exports.

---

## 6. Drop dead providers from the chain (Engine)

**What's wrong.** `LLMRouter` builds its order from env: `PRIMARY_LLM=openai`
registers the OpenAI client whether or not the key is usable, so **every**
LLM call pays a failed OpenAI attempt before reaching a working provider. With
up to 10 calls per generation that is 10 wasted round trips. `GEMINI_API_KEY`
is empty, so Gemini is skipped with a warning — correct behaviour, and the
model to copy.

**Change.** Health-check each provider once at startup and drop the ones that
fail from `fallback_order`, logging the resulting chain. Optionally re-probe a
dropped provider on a timer.

**Acceptance.** With an invalid `OPENAI_API_KEYS`, the startup log shows a
chain without `openai`, and a generation makes zero OpenAI requests.

---

## Sequencing

§5 first — without reproducible config, no measurement means anything. Then
§4 and §3 (largest latency wins, smallest diffs), then §2, then §6. §1 is
independent and can land any time; do it before §2 so the failure mode is
legible while tuning the budget.

## Definition of done

Run `node scripts/integration-test.mjs --runs 10 --concurrency 2` and require:

- `mvpPass: true` — all four existing criteria green;
- **p95 < 60s** (currently 301s);
- **≥8/10 usable stories**, i.e. fallback rate ≤ 0.2 (currently 1.0);
- zero `502`s.

The runner already records every one of these to
`test-results/integration-<timestamp>.json` and appends to `history.json`, so
progress is comparable run over run.

## Explicitly out of scope

**9router HA.** It is set up and scripted
(`scripts/bootstrap-9router.mjs`, `docker-compose.9router-ha.yml`) and it
removes the proxy as a single point of failure — but it does not address any
item above. It also cannot add throughput: the `opencode` backends are an
anonymous passthrough with no account to key a quota on, and all replicas on
one host share a single egress IP (measured: both report `1.55.45.166`). HA is
an availability measure here, nothing more.
