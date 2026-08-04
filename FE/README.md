# FE — Bedtime Story Companion (SPA)

A pure client-side React + Vite single-page app. It has **no server of its
own**: every request goes to the NestJS BE, which owns the Engine call and the
LLM credentials.

```
SPA (vite dev / nginx)  --/api/*-->  BE :3001  --POST /generate-->  Engine :8000  -->  LLM
```

The SPA calls `/api/...`; the BE serves those routes **without** the prefix
(`/story/create`, `/tenant/init`, ...). Stripping `/api` is the proxy's job:
`vite.config.ts` in dev/preview, `location /api/` in `nginx.conf` in production.
Adding a route to the BE needs no change here.

## Run locally

Prerequisites: Node.js 20+, and the BE running on `:3001` (which in turn needs
the Engine on `:8000` — see the root `README.md`).

```bash
npm install
npm run dev          # http://localhost:3000
```

Point the dev proxy somewhere other than `http://localhost:3001` with
`BE_PROXY_TARGET`; call a separately hosted BE directly with `VITE_BE_URL`. See
`.env.example` — no model API key belongs in this app.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on `:3000`, proxying `/api` to the BE |
| `npm run build` | Static bundle into `dist/` |
| `npm run preview` | Serve `dist/` locally with the same `/api` proxy |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | Vitest (jsdom) |

## Production

`Dockerfile` builds the bundle and serves it from nginx, which also proxies
`/api` to the `backend` service and falls back to `index.html` for client-side
routes. Bring the whole stack up from the repo root with `docker compose up`.
