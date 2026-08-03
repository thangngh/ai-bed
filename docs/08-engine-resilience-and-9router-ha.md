# Engine resilience & 9router HA

Status: measured 2026-08-03 against the local 9router proxy on `localhost:20128`.

## 1. Does the Engine stay up for MVP?

Yes — the Engine degrades, it does not crash. Verified by driving real
generations through `BE -> Engine -> 9router -> opencode zen`:

- `StoryPipeline.run` wraps the whole pipeline in a `try/except` and returns
  `FALLBACK_STORY` on any exception, so a bad LLM response becomes a poor
  story rather than a 500.
- `POST /generate` therefore answers 200 even when every LLM call fails. The
  observed failure mode was `safety_status=FALLBACK`, `is_fallback=true`,
  title "Câu chuyện bất ngờ" — never a stack trace to the client.
- The process survived repeated empty/garbage LLM bodies without restarting.

**The real MVP risk is not a crash, it is latency — and BE gives up first.**
A measured 4-run batch (`test-results/integration-2026-08-03T15-01-33-950Z.json`):

| run | result | latency |
|---|---|---|
| 1 | `502 ENGINE_ERROR` | 329.9s |
| 2 | `502 ENGINE_ERROR` | 329.9s |
| 3 | `201` fallback story | 284.7s |
| 4 | `502 ENGINE_ERROR` | 301.9s |

0/4 usable stories. The Engine itself never crashed and kept serving — every
failure was BE abandoning the call.

### `ENGINE_TIMEOUT_MS` above 300s cannot work

`EngineGatewayService.generate` uses `fetch` with an `AbortController` set to
`engine.timeoutMs`. But Node's `fetch` (undici) has its **own 300s
`headersTimeout`**, which fires first and throws a plain `TypeError: fetch
failed` — not an `AbortError`. So the handler misses its `ENGINE_TIMEOUT`
branch and falls through to the generic `ENGINE_ERROR` 502, which is exactly
what the runs above show: `ENGINE_ERROR` at ~330s despite
`ENGINE_TIMEOUT_MS=420000`.

Two consequences: any configured timeout above 300s is silently ignored, and
genuine timeouts are misreported as generic errors. The hardcoded message
`'Engine timeout after 120s'` (`engine-gateway.service.ts:53`) is wrong for
every configured value too.

Fix by giving the request a dispatcher with the timeouts disabled, or by
dropping to `node:http` — `scripts/integration-test.mjs` does the latter and
documents why.

Per-call breakdown of one generation (5 LLM calls, all time spent waiting on
the proxy):

| # | Stage | Time | Content |
|---|---|---|---|
| 1 | planner | 1.98s | 217 chars, failed validation |
| 2 | planner | 47.13s | 1139 chars, OK |
| 3 | writer | 46.03s | **empty** |
| 4 | writer | 1.34s | 217 chars, failed validation |
| 5 | writer | 294.12s | **empty** |

Run `node scripts/integration-test.mjs` to reproduce; every run is written to
`test-results/integration-<timestamp>.json` with per-request latency, fallback
flags and an MVP pass/fail verdict, plus a rolling `test-results/history.json`.

### What to fix before calling the MVP shippable

1. **Cap the pipeline.** Give the whole generation a deadline shorter than
   BE's `ENGINE_TIMEOUT_MS` and return the fallback when it expires, so the
   user gets *a* story instead of a 502.
2. **Fail fast on empty content.** `CustomClient.complete` currently treats an
   empty body as success, so the pipeline burns a 294s call and then fails
   `json.loads`. Raise instead, and let the router fall through to the next
   provider.
3. **Pin a model.** See below — `opencode` is not one model.

## 2. Why latency swings from 2s to 294s

`opencode` on 9router is not a model, it is an alias that load-balances across
heterogeneous free models. Three identical requests landed on three different
backends:

| Backend | Latency |
|---|---|
| `deepseek-v4-flash-free` | 5.9s |
| `nemotron-3-ultra-free` | 7.2s |
| `north-mini-code-free` | 40.7s |

`north-mini-code-free` also ignored the Vietnamese-only instruction and
returned an English story with the child renamed "Lily". Quality is not
reproducible across backends, which is what drives the validator retry storm.

Pin `CUSTOM_LLM_MODEL` to a specific backend that reliably returns Vietnamese
JSON before tuning anything else.

## 3. HA for 9router

`docker-compose.9router-ha.yml` + `deploy/9router-lb.conf` run two 9router
replicas behind an nginx round-robin balancer and repoint the Engine at it:

```bash
docker compose -f docker-compose.yml -f docker-compose.9router-ha.yml up -d
```

Verified: both replicas come up healthy, and the balancer starts once they
are. The balancer publishes on host port **20127**, not 20128 — a locally
installed 9router owns 20128, and binding it in Docker silently displaces it
(this happened during testing; the local proxy came back as soon as the
balancer was stopped). Override with `NINEROUTER_LB_PORT`.

**Onboarding is required before the replicas serve traffic**, in two steps —
both were hit during testing and neither is optional.

*Step 1 — credentials.* A fresh container answers `401` on `/v1/*`. The
compose file sets `INITIAL_PASSWORD` (default `aibedtime123`, override with
`NINEROUTER_PASSWORD`) because without it the container serves nothing at all.
Note the healthcheck probes `/`, not `/v1/models`, so **`healthy` means the
process is up — not that the replica can answer a request.** Judge readiness
by a real completion, never by `docker ps`. Then mint a key per replica:

```bash
# log in, then POST /api/keys {"name":"ai-bedtime-engine"}
# -> {"key":"sk-...","machineId":"..."}
```

Pass that key to the Engine as `CUSTOM_LLM_API_KEY`. Do **not** disable
`requireApiKey` to skip this; it opens the proxy to anything that can reach
the port.

*Step 2 — providers and combos.* A fresh replica has
`GET /api/providers -> {"connections":[]}` and no combos, so
`model: "opencode"` returns **404** even with a valid key. The `opencode`
alias is a combo defined on the local instance, backed by that instance's own
provider connections; it does not exist until you recreate both on the
replica. This is a dashboard step (`http://localhost:20129`,
`http://localhost:20130`) — it means registering real accounts, so it is left
to a human rather than scripted.

Until step 2 is done the replicas serve their model catalog but cannot
complete a request, and the balancer is not a usable Engine backend.

The balancer uses `proxy_next_upstream error timeout http_429 http_502
http_503`, so a replica that is down *or* rate-limited is skipped. Read
timeout is 420s to match the slowest observed generation; `proxy_buffering` is
off so SSE streams through.

This removes 9router as a single point of failure. Whether it also raises
throughput is a separate question — see below.

## 4. Does HA by Docker internal IP count as separate connections?

**No, not on a single host — measured, not assumed.** Both replicas were
started and asked what the outside world sees as their source address:

```
$ docker exec ai-bedtime-9router-a-1 wget -qO- https://ifconfig.me   -> 1.55.45.166
$ docker exec ai-bedtime-9router-b-1 wget -qO- https://ifconfig.me   -> 1.55.45.166
```

Identical. Containers on a bridge network have private addresses (`172.x.x.x`)
that are **never visible to the upstream**; all egress is NATed through the
host's single public IP. `opencode.ai/zen` sees one source address no matter
how many replicas run. So **if the quota is scoped per IP, three replicas on
one Docker host count as one client, not three.**

To actually present distinct IPs you need distinct egress paths, not distinct
containers:

- separate hosts / VMs / regions, or
- a per-replica outbound proxy — 9router honours `HTTP_PROXY` / `HTTPS_PROXY`,
  which is why those are wired into the compose file as
  `REPLICA_A_PROXY` / `REPLICA_B_PROXY`, or
- distinct routable IPv6 addresses per container.

**And the per-IP question turned out not to be the one that matters.**
Inspecting the working local instance settles it:

- `GET /api/combos` on `localhost:20128` shows `opencode` is a **user-defined
  combo**, not a built-in anonymous passthrough. So is `gpt`, `claude`,
  `tier-1`.
- `GET /api/providers` shows what backs it: the user's own credentials —
  an OpenRouter API key, several Gemini API keys, DeepSeek keys, and
  Antigravity / gemini-cli OAuth accounts.
- The `:free` models the combo routes to (`openrouter/...:free`) are
  OpenRouter's free tier, which is rate-limited **per OpenRouter account**.

So the quota follows the *account*, not the source IP and not the container.
Two consequences:

1. Replicas that share the same accounts add **no capacity**, regardless of
   how their networking is arranged. This is the same conclusion the IP
   measurement reached, but for a stronger reason — it holds even if you give
   each replica its own egress IP.
2. Capacity comes from adding **distinct upstream accounts**, which needs no
   Docker replicas at all: 9router already fans out across multiple
   connections of the same provider (the local instance has 6 Antigravity
   accounts and 6 Gemini keys registered).

Replicas *are* distinct at the fingerprint level — each gets its own
`MACHINE_ID_SALT` and `DATA_DIR`, and the machine IDs confirm it
(`b60c14fe96dfe493` for A, `ad626d90b002c756` for B). That distinctness just
does not buy anything when the upstream keys on the account.

**Therefore: run HA for availability, scale accounts for throughput.**

`scripts/probe-9router-identity.mjs` remains available to re-test empirically
if the provider mix changes, but it is no longer the deciding evidence.

Confirm the shared-egress claim yourself with:

```bash
docker exec 9router-a wget -qO- ifconfig.me
docker exec 9router-b wget -qO- ifconfig.me   # expect the same address
```

## 5. Load testing

```bash
node scripts/integration-test.mjs --runs 20 --concurrency 4
```

Note the two limiters in front of the Engine when interpreting results: BE's
Bottleneck queue (`QUEUE_MAX_CONCURRENT`, default 2) and the token-bucket rate
limiter (`RATE_LIMIT_CAPACITY`, default 10). Raise both when the goal is to
saturate the proxy rather than to measure BE's own throttling.
