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

**Onboarding is required before the replicas serve traffic.** A fresh
container has no provider configured and answers `401` on `/v1/models`. Open
each replica's dashboard (`http://localhost:20129`, `http://localhost:20130`),
log in with `INITIAL_PASSWORD` (default `123456`), and add the OpenCode Free
provider. Until then the balancer will return 401 for everything.

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

**But per-IP may not be the scope that matters.** The quota could equally be
per account or per machine fingerprint — 9router hashes a machine ID with
`MACHINE_ID_SALT`, and each replica in the compose file gets its own salt and
its own `DATA_DIR` (separate SQLite, separate accounts). If the upstream keys
on that instead, replicas *are* distinct and HA does add capacity.

**Which one applies is not documented and cannot be settled from the docs.**
opencode's Zen page states no rate limits at all, and when users asked
directly how limits are scoped per IP, the issue was closed as not planned
with no answer ([issue #16844](https://github.com/anomalyco/opencode/issues/16844)).
Treating it as per-replica without evidence risks silently building capacity
planning on an assumption the upstream can change at will.

So measure it:

```bash
# point at the replicas directly, bypassing the balancer
node scripts/probe-9router-identity.mjs \
  --replicas http://localhost:20129,http://localhost:20130
```

It drives replica A until the upstream reports the free quota is spent, then
immediately calls replica B:

- **B also exhausted** → quota is shared; adding replicas on this host buys
  resilience only, not throughput. Scale out to separate egress IPs.
- **B still works** → quota follows the replica; HA adds real capacity.

The verdict and the full request log are saved to
`test-results/9router-identity-<timestamp>.json`. The replicas are already
published on `20129` and `20130` for exactly this purpose.

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
