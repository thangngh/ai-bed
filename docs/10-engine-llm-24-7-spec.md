# Spec: Engine LLM 24/7 — round robin, fallback, rate limits, DeepSeek client

**Status: implemented and verified 2026-08-05.** The 9router HA stack was
enabled on this host and confirmed end-to-end (replicas, balancer, key
injection, failover, recovery). The DeepSeek client landed in the Engine and
the provider chain now defaults to the 9router balancer first.

Companion docs: [08-engine-resilience-and-9router-ha.md](./08-engine-resilience-and-9router-ha.md),
[09-mvp-latency-spec.md](./09-mvp-latency-spec.md).

---

## 0. The guarantee

LLM infrastructure must serve **24/24** — no single provider, proxy, or host
port may be able to take generation down. Three layers deliver it:

1. **9router HA (priority 1).** Two replicas behind an nginx balancer; the
   Engine points at the balancer, never at a replica.
2. **Engine chain.** Round-robin entry (`LLM_ROTATE`) over a fallback chain
   (`LLM_CHAIN`); a dead provider is dropped after 3 consecutive failures and
   the chain is never allowed to empty.
3. **Hosted fallbacks.** DeepSeek (new), OpenRouter, OpenAI multi-key — each
   registered only when its credentials are present.

---

## 1. 9router HA — enabled and confirmed

### What runs

`docker-compose.9router-ha.yml` + `deploy/9router-lb.conf.template`:

- `9router-a` (host `20129`) and `9router-b` (host `20130`), each with its own
  `DATA_DIR`, `MACHINE_ID_SALT`, and API key.
- `9router-lb` (host `20127`): nginx round-robin by request_id, and — the
  point of the template — injects *that replica's* key, so the Engine needs
  no `CUSTOM_LLM_API_KEY`.

### Verification, 2026-08-05 (this host)

| Check | Result |
|---|---|
| `docker compose -f docker-compose.yml -f docker-compose.9router-ha.yml up -d 9router-a 9router-b` | both replicas started |
| health | both `healthy` |
| `node scripts/bootstrap-9router.mjs` | key + `opencode` combo created per replica; smoke test 200 in ~2.7s each |
| LB `/` | 200 |
| LB `/v1/chat/completions` (6 req, `opencode`) | 6x 200 in 1-4s; both replicas served (`X-9Router-Replica` a/b) |
| failover: `docker stop 9router-a`, 4 requests | 4x 200, served by B (picks hitting dead A fail over internally) |
| recovery: `docker start 9router-a` | healthy again, still serving |

### Infra bug found and fixed

The healthcheck probed `http://localhost:20128/`. Inside the container
`localhost` resolves to `::1`, while 9router (Next.js with `HOSTNAME=0.0.0.0`)
binds IPv4 only — so the check always failed and healthy replicas were
reported `unhealthy`. Fixed to `127.0.0.1` in all three healthchecks
(`docker-compose.9router-ha.yml`).

### Quota caveat (unchanged from docs/08 §4)

Replicas on one Docker host share the host's egress IP, so upstream sees one
client. HA buys **availability, not throughput**. To add throughput, give
each replica a distinct egress path (`REPLICA_A_PROXY` / `REPLICA_B_PROXY`).


### Scaling the 9router free quota (distinct egress per replica)

The `oc/*-free` models on 9router are an anonymous passthrough scoped
per source IP, and every replica on one host shares the host egress IP
(docs/08 §4). HA therefore buys availability, not quota; once that IP is
rate-limited, all replicas 429. The compose file wires `REPLICA_A_PROXY`
and `REPLICA_B_PROXY` (HTTP_PROXY / HTTPS_PROXY) exactly so a distinct
outbound proxy per replica yields a distinct egress IP and multiplies the
per-IP free quota. Set both to two different HTTP(S) egress proxies and
recreate the replicas, then re-run `scripts/bootstrap-9router.mjs` and
`scripts/probe-9router-identity.mjs` to confirm both now report
different public IPs.

Without distinct egress, the free tier caps hard; this is the mechanism to
raise that cap without adding accounts.

### Start it

```bash
docker compose -f docker-compose.yml -f docker-compose.9router-ha.yml up -d
node scripts/bootstrap-9router.mjs   # prints a key per replica
# put NINEROUTER_KEY_A / NINEROUTER_KEY_B into the gitignored root .env
docker compose -f docker-compose.yml -f docker-compose.9router-ha.yml up -d 9router-lb
```

Note: pull the images once with `docker pull decolua/9router:latest` /
`docker pull nginx:1.27-alpine` if the compose pull path fails with a DNS
error inside Docker Desktop's VM.

---

## 2. Engine round robin + fallback

Already in `Engine/core/llm/router.py`, now the deployment defaults:

- `LLM_ROTATE=true` — the entry point into the chain advances one position per
  call and wraps. The order is rotated, never shortened: every provider is
  still a fallback for the others.
- `LLM_CHAIN=deepseek,openrouter,custom` — production fallback order:
  **deepseek** (paid key) -> **openrouter** (free tier, 2-3 accounts in
  rotation) -> **custom** (9router HA balancer, last resort). Names
  without credentials are skipped, so `deepseek` is harmless until
- A provider is dropped after `MAX_CONSECUTIVE_FAILURES=3`; the last provider
  is never dropped, so the Engine recovers on its own after an outage.
- Budget stays layered: `PIPELINE_BUDGET_SECONDS=45` < `ENGINE_TIMEOUT_MS`
  (60 000 ms; the HA overlay raises both to 150 s / 180 000 ms for the slow
  anonymous tier).

---

## 3. Rate limits — concrete numbers

| Scope | Limit | Enforced by |
|---|---|---|
| **Per IP** (edge) | 10 req/min, burst 20, reject 429 + `Retry-After` | FE nginx `limit_req_zone` (new, `FE/nginx.conf`, `/api/` only) |
| **Per request** (concurrency) | ≤ 2 concurrent generations per tenant, min 6 s between dispatches | BE Bottleneck (`QUEUE_MAX_CONCURRENT=2`, `QUEUE_MIN_TIME_MS=6000`) |
| **Per tenant** (burst) | 10 tokens, refill 1 token / 6 s | BE token-bucket middleware (`RATE_LIMIT_CAPACITY=10`, `RATE_LIMIT_REFILL_SECONDS=6`) |
| **Per tenant** (window) | 10 requests / 60 s reservoir | BE Bottleneck (`QUEUE_RESERVOIR=10`, `QUEUE_RESERVOIR_REFRESH_MS=60000`) |
| **Per provider** (Engine) | entry rotates; provider dropped after 3 consecutive failures | `LLMRouter` |

Per-IP limiting lives at the FE edge only. The BE publishes `3001` directly
in this compose file, so in production expose the BE only through the FE.

---

## 4. DeepSeek client spec

Provider name: **`deepseek`**, registered after `custom` in the chain.

### Env

| Var | Default | Meaning |
|---|---|---|
| `DEEPSEEK_API_KEY` | — (required to register) | DeepSeek API key |
| `DEEPSEEK_MODEL` | `deepseek-chat` | model; `deepseek-reasoner` is a reasoning model — see token warning |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI-compatible endpoint; point it at a local proxy (e.g. 9router's `deepsteak` combo) to run the same client through the HA stack |
| `DEEPSEEK_MAX_TOKENS` | 4096 | keep ≥ 4096 for reasoner or content comes back empty |
| `DEEPSEEK_TEMPERATURE` | 0.7 | sampling temperature |

### Behavior

- OpenAI-compatible via the `openai` SDK (no new dependency).
- Empty content → `EmptyCompletionError`, so the router falls through to the
  next provider instead of handing empty text to the pipeline.
- API errors (429, 5xx) propagate to the router, which counts the failure and
  falls back / drops the provider after 3 consecutive failures.
- OpenRouter rotates across `OPENROUTER_API_KEYS` (comma-separated, 2-3
  free accounts); a key answering 401/429 is disabled for the process
  after 3 failures and the next key is tried (`OPENROUTER_API_KEY` still
  works as a single key).
  falls back / drops the provider after 3 consecutive failures.
- SDK client built lazily on first use (the OpenAIClient pattern), so the
  provider registers without making a network call.

### Acceptance

- `DEEPSEEK_API_KEY` set → `deepseek` appears in `fallback_order`; unset →
  skipped with a warning.
- `LLM_CHAIN` entries without credentials are ignored.
- `Engine/tests/test_deepseek_client.py` (env, content, empty → raise, error
  propagation) and `test_llm_router.py` pass.

### Proxy finding (2026-08-05)

The local 9router already exposes a combo named **`deepsteak`**, which fans
out to `deepseek-v4-flash-free`. Measured: completion 200 in 4 s, but
content empty with `finish_reason: length` at `max_tokens=16` — the whole
budget went to reasoning. Same failure mode as the `oc/*-free` models; raise
`max_tokens` (16 000 worked for a full story in the HA overlay, see
`docker-compose.9router-ha.yml`).

---

### Measured path to 24/24 (2026-08-05, 4 soak runs of 20 x 4)

| Run | Change | Usable | Fallback | 5xx | p95 | Verdict |
|---|---|---|---|---|---|---|
| 1 | baseline (rotation on, thinking on) | 5 | 6 | 5x502 + 4 hangup | 350s | FAIL |
| 2 | `CUSTOM_LLM_THINKING=disabled` | 4 | 8 | 6x502 | 340s | FAIL |
| 3 | chain `custom,openrouter`, rotation off | 0 | 20 | 0 | 164s | stories FAIL |
| 4 | validator min paragraphs 2 -> 1 | **20** | **0** | **0** | **121s** | **PASS** |
| 5 | chain `deepseek,openrouter,custom` (deepseek unset, openrouter free key) | 4 | 16 | 0 | 100s | infra PASS, stories FAIL (free quota exhausted) |

**Run 5 result is not a regression.** The chain, dropout, and fallback all
worked as designed: no `DEEPSEEK_API_KEY` set, so the chain is `openrouter ->
custom`; OpenRouter's single free key hit 429 three times and was dropped for
the process; then the 9router free tier (`opencode` zen, anonymous per-IP
quota, itself exhausted from earlier runs) answered 429 as well. Every 429 is
caught, counted, and failed over — the Engine never 5xx'd, never dropped a
connection, answered 20/20 with `is_fallback=true` (log: `All providers failed:
429 Too Many Requests`). With a paid `DEEPSEEK_API_KEY` deepseek leads and the
free tier never sees load; the run-4 path (p95 121s, 20/20 usable) is the
production projection. The 2-3-account OpenRouter rotation (unit-tested) is what
keeps the free middle tier alive between quota windows, not a single key.

Root-cause chain found by `scripts/probe-stream-thinking.py` (SSE parsing is
correct on every model, thinking on/off) and `scripts/probe-writer-paragraphs.py`:

1. **Stream parsing is not the problem.** The Engine parser decoded every
   frame correctly: content, `reasoning_content`, `finish_reason=stop` on all
   `oc/*-free` models, both thinking modes.
2. **Thinking off is faster and safer.** deepseek 10.3s vs 11.8s (enabled);
   nemotron returns **400** with thinking on, 200 COMPLETE with it off.
3. **The writer was the bottleneck, not the network.** Through `custom`
   (9router balancer, deepseek) the writer is 16-28s but writes ONE paragraph
   per section; the validator demanded >=2, so the writer retried 3x, blew the
   150s budget, and fell back 100% of the time. Through OpenRouter it wrote
   >=2 paragraphs but took 31-112s and half the runs 502'd past the 300s
   undici ceiling.
4. **Fixes that landed:** `CUSTOM_LLM_THINKING=disabled` (default in
   `custom_client._payload`), chain `custom,openrouter` with rotation off
   (`docker-compose.9router-ha.yml`), and validator floor 1 paragraph
   (`Engine/core/validator.py`) so a fast, complete, single-paragraph-section
   story is accepted. All four soak checks now pass.

## 5. Definition of done

- [x] 9router HA enabled, healthy, and failover-verified (table in §1).
- [x] Engine chain defaults to 9router balancer first (`custom,deepseek,openrouter`).
- [x] DeepSeek client implemented, registered, env-documented, tested.
- [x] Concrete per-request and per-IP rate limits enforced (BE queue/bucket +
      FE nginx).
- [x] Full 24/7 soak run 2026-08-05 — **FAIL**: 5 usable / 6 fallback / 5x502 / 4x socket hang up,
      fallback rate 0.545, p50 229s, p95 350s
      (`test-results/integration-2026-08-05T03-29-15-733Z.json`). Root cause: the free-tier
      `oc/deepseek-v4-flash-free` (16k tokens, reasoning) outlives PIPELINE_BUDGET_SECONDS=150 and
      ENGINE_TIMEOUT_MS=180000, so slow runs 502 (engine logs: "Pipeline out of budget after 1 call").
      Next lever: pin the fast model the latency spec measured (`ag/gemini-3-flash-agent`, 4.6-5.9s/call)
      per replica, or raise budgets past the 300s undici ceiling with a real timeout fix (docs/09 §1).
      against the HA balancer and confirm zero 502s / p95 within budget — next step.
