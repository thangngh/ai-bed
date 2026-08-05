# Spec: Cloudflare Tunnel + egress/quota analysis

**Status: analyzed 2026-08-05.** The quoted command exposes the 9router HA
stack behind a Cloudflare domain (ingress). It improves availability and
obscures the origin IP, but it does **not** rotate the egress IP the
replicas use when calling DeepSeek/opencode -- so it does not by itself
multiply a free-tier per-IP quota. That requires distinct egress per replica
(`REPLICA_A/B_PROXY`) or a Cloudflare egress solution.

## The command, decoded

```
docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <JWT>
```

The token payload decodes to:

```json
{"u":"e5d52717374c43d1ef8bcc613693403e",
 "t":"a55bd88f-bfa6-4b76-aa2c-31e1538afcff",
 "s":"YjI4ZjQzODktNDNjMi00NTBlLTg5MjQtYzdkOGFmMzdkMjFj"}
```

- `t` = the named Tunnel UUID on a Cloudflare team.
- `s` = that tunnel's registration secret (decodes to `b28f4389-43c2-450e-8924-c7d8af37d21c`).

With no `---url`/`---hostname`, this authenticates a named Tunnel whose
**ingress rules live in the Cloudflare dashboard**. The tunnel connects
outbound from inside your network (egress through Cloudflare), which is how a
NAT/restricted router can still serve an edge URL.

## Docker wiring (added)

`docker-compose.9router-ha.yml`:

```yaml
cloudflared:
  image: cloudflare/cloudflared:latest
  profiles: ["cloudflared"]          # opt-in
  restart: unless-stopped
  command: tunnel --no-autoupdate run --token CLOUDFLARE_TUNNEL_TOKEN
  depends_on:
    9router-lb:
      condition: service_healthy
```

Start it with:

```bash
docker compose -f docker-compose.yml -f docker-compose.9router-ha.yml   --profile cloudflared up -d cloudflared
```

The token is read from `CLOUDFLARE_TUNNEL_TOKEN` in the gitignored root
`.env`; the JWT is never committed. The Tunnel's dashboard ingress points the
edge at a service in the compose network (e.g. `9router-lb:20128`).

## What it actually achieves

1. **External exposure without router port-forward.** `cloudflared` dials
   Cloudflare outbound, so a NAT/restricted router serves a public domain.
2. **Origin IP obscured.** Cloudflare's edge terminates TLS; the public sees
   Cloudflare IPs, not `1.55.45.166`.
3. **Availability layer.** WAF, Rate Limiting, caching, and (with a paid
   zone) DDoS + Argo Smart Merge can sit in front of the proxy without
   touching the Engine.
4. **No DDNS/static-DHCP needed** for external access -- the tunnel keeps a
   persistent edge connection, so the host can move behind a dynamic WAN.

## What it does NOT achieve (the rotating-proxy goal)

A Cloudflare **Tunnel is ingress** (edge -> origin). It does **not** pick the
egress IP the origin uses when it calls out. The 9router replicas' requests
to `opencode.ai/zen` (and the Engine's calls to DeepSeek) still leave from the
host egress IP, so they still share one per-IP free quota (docs/08 ?4,
measured: both replicas report the same public IP).

To actually multiply a per-IP quota you need one of:

- **Distinct egress per replica** (already wired): set `REPLICA_A_PROXY` and
  `REPLICA_B_PROXY` to two different outbound proxies and recreate the
  replicas. Then the identity probe (`scripts/probe-9router-identity.mjs`)
  will show two different source IPs.
- **Cloudflare Egress (Argo) / a rotating egress proxy** in front of the
  calls, not a bare Tunnel.
- **A Cloudflare Worker reverse proxy** in front of DeepSeek/OpenRouter with
  multiple Worker instances (anycast) -- possible but adds latency and the
  Workers still share egress unless routed over distinct NATs.

## Zero Trust vs Quick (measured 2026-08-05)

`--token <JWT>` (`t=a55bd88f...`) is a team Zero-Trust credential; if you **do
not use Zero Trust**, the named tunnel has no ingress rule -> edge accepts auth
(precheck PASS) but the data stream fails with `control stream encountered a
failure while serving` because no origin is bound. That is the root cause
measured in 2026-08-05, not an egress/network block -- the same host, engine
container, and 9router-lb container all dial edge `198.41.200.53:7844` OK
(return 0 / REACHABLE).

**Fix used (no Zero Trust): a quick tunnel, no token.** Verified:
`Registered tunnel connection connIndex=0` (log 05:44). `cloudflared` self-issues
`https://<rand>.trycloudflare.net`:

```bash
docker compose -f docker-compose.yml -f docker-compose.9router-ha.yml --profile cloudflared-quick up -d cloudflared-quick
```

Quick tunnels are ephemeral (~24h) and need no account; read the container log
for the URL. For a stable domain / WAF / long-lived use, create a free
Cloudflare account (its Tunnel UI is the Free-tier dashboard; not billed as a
paid Zero-Trust add-on) and bind ingress `http://9router-lb:20128`.

## Recommendation

The tunnel exposes/protection the HA edge and hides origin IP, and pairs
naturally with 2 outbound egress proxies to multiply quota. In production In production the cleanest path is simply to put
`DEEPSEEK_API_KEY` first in the chain (paid), which removes the free-tier
rate-limit concern entirely; use the Tunnel + egress proxies only if you want
to run the anonymous free tier as capacity. Keep the `cloudflared` service
profile-gated (it is off by default; the core HA stack needs no token).
