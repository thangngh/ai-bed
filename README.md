# Bedtime Story Companion 🌙✨

Tạo câu chuyện trước giờ ngủ cho bé 3-6 tuổi bằng AI, hoàn toàn bằng tiếng Việt.

## Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  FE      │ →   │  BE      │ →   │  Engine  │
│  React 19│     │  NestJS  │     │  FastAPI │
│  Vite    │ ←   │  SQLite  │ ←   │  LLM     │
└──────────┘     └──────────┘     └──────────┘
```

- **FE**: React 19 + Vite + Tailwind CSS — a pure SPA with no server of its own
  and no API keys
- **BE**: NestJS 11 + TypeORM + Bottleneck queue (orchestration layer)
- **Engine**: Python FastAPI + OpenAI/Gemini/Custom LLM (story generation pipeline)

**The `/api` prefix is a proxy convention, not part of the BE.** The SPA calls
`/api/story/create`; NestJS serves `/story/create`. Stripping the prefix is the
job of whatever fronts the SPA — `vite.config.ts` in development,
`FE/nginx.conf` in production. Anything calling the BE directly (integration
scripts, `VITE_BE_URL`) uses the bare paths.

## Quick Start (Docker)

```bash
# 1. Copy environment files
cp .env.example .env
cp BE/.env.example BE/.env
cp Engine/.env.example Engine/.env

# 2. Add your API keys to Engine/.env
#    OPENAI_API_KEYS=sk-xxx,sk-yyy (round-robin multi-key)
#    GEMINI_API_KEY=...
#    OPENROUTER_API_KEY=sk-or-...

# 3. Start all services
docker compose up -d

# 4. Open http://localhost
```

Four containers: `engine` (:8000), `backend` (:3001), `frontend` (nginx on
:80, serves the SPA and proxies `/api`), and — with the HA overlay below —
the 9router replicas and their balancer. Each waits for the one below it to
be *healthy*, so `up -d` returning means the chain is actually connected.

### With 9router HA

```bash
# once: mint one API key per replica and write them into .env
docker compose -f docker-compose.yml -f docker-compose.9router-ha.yml up -d 9router-a 9router-b
node scripts/bootstrap-9router.mjs         # prints NINEROUTER_KEY_A / _B

docker compose -f docker-compose.yml -f docker-compose.9router-ha.yml up -d
```

Two 9router replicas behind an nginx balancer on :20127. Each replica mints
its own keys and rejects the other's, so the **balancer** holds the
credentials and injects the right one per replica — the Engine sends none.
See [docs/08](docs/08-engine-resilience-and-9router-ha.md) §3a.

The overlay ships `LLM_CHAIN=openrouter,custom` with `LLM_ROTATE=true`: the
HA stack is an availability layer rather than the primary provider, because a
freshly bootstrapped replica can only serve the anonymous `oc/` models and
their writer stage is too slow to finish inside the budget. Rotation still
spreads calls across both, so neither absorbs the whole load. Flip the order
once a replica has a real provider connected.

```bash
node scripts/probe-9router-models.mjs   # which models can actually complete
```

`/v1/models` lists ~500 names whether or not an account is connected behind
them, so it is not evidence — only a completed request is. See
[docs/08](docs/08-engine-resilience-and-9router-ha.md) §3c.

### End-to-end check

```bash
node scripts/e2e-flow-test.mjs          # login -> profile -> story -> feedback
```

Walks the whole SPA journey through nginx on :80 — the same paths and request
bodies `FE/src` sends — and asserts every step. Latest run: **12/12 steps,
story in 68.8s, 9 sections** (`test-results/e2e-flow-*.json`).

## Local Development

### Backend (NestJS)
```bash
cd BE
npm install
npm run start:dev   # http://localhost:3001
```

### Engine (Python FastAPI)
```bash
cd Engine
pip install -r requirements.txt
python main.py      # http://localhost:8000
```

### Frontend (React 19 SPA)
```bash
cd FE
npm install
npm run dev         # http://localhost:3000, proxies /api -> :3001
```

Start the Engine and the BE first: the SPA has no fallback story generator.

## Environment Variables

### BE (.env)
| Variable | Default | Description |
|---|---|---|
| PORT | 3001 | BE server port |
| ENGINE_URL | http://localhost:8000 | Engine base URL (compose overrides it to `http://engine:8000`) |
| ENGINE_TIMEOUT_MS | 60000 | Must stay above the Engine's `PIPELINE_BUDGET_SECONDS` so a slow run returns a fallback story, not a 502. The HA overlay raises it to 150000 |
| DB_PATH | ./data | SQLite files directory |
| QUEUE_MAX_CONCURRENT | 2 | Bottleneck per-tenant limit |
| QUEUE_MIN_TIME_MS | 6000 | Minimum time between jobs |
| RATE_LIMIT_CAPACITY | 10 | Token bucket capacity |
| RATE_LIMIT_REFILL_RATE | 10 | Tokens per minute |

### Engine (.env)
| Variable | Default | Description |
|---|---|---|
| ENGINE_PORT | 8000 | Engine server port |
| LOG_LEVEL | INFO | Root log level; INFO prints the provider chain and per-stage LLM timings |
| LLM_CHAIN | - | Provider order, e.g. `openrouter,custom`. Unset keeps the registration order (openai, gemini, custom, openrouter) |
| LLM_ROTATE | false | Round-robin the *entry point* into that chain, so N providers each take ~1/N of the calls instead of the head taking all of them. The order is rotated, never shortened — every provider stays a fallback for the others |
| OPENAI_API_KEYS | - | Comma-separated keys (round-robin) |
| GEMINI_API_KEY | - | Gemini fallback key |
| OPENROUTER_API_KEY | - | OpenRouter key |
| OPENROUTER_MODEL | google/gemma-4-26b-a4b-it:free | The free model whose output the writer validator accepts |
| CUSTOM_LLM_URL | - | Custom OpenAI-compatible URL (the 9router balancer, under the HA overlay) |
| CUSTOM_LLM_API_KEY | - | Leave empty under the HA overlay: the balancer injects the per-replica key |
| CUSTOM_LLM_MODEL | ag/gemini-3-flash-agent | Needs an Antigravity account connected in 9router; the overlay defaults to `oc/deepseek-v4-flash-free`, the fastest of the anonymous models |
| CUSTOM_LLM_MAX_TOKENS | 4096 | Reasoning models spend this budget *before* emitting content: at 4096 the writer came back `finish_reason: length` with an empty body. The 9router overlay sets 16000 |

### Engine (.env), continued
| Variable | Default | Description |
|---|---|---|
| PIPELINE_BUDGET_SECONDS | 45 | Whole-generation deadline; a run that exceeds it returns the fallback story. The HA overlay raises it to 120 for the free OpenRouter tier |
| MEMORY_EXTRACT_TIMEOUT_SECONDS | 20 | Memory extraction runs *after* the pipeline, outside its budget; this bounds it so a finished story is not delayed |

### Timeouts, outermost last

Each layer must allow more time than the one inside it, or a slow-but-working
generation is reported as a failure by whichever layer gives up first:

```
PIPELINE_BUDGET_SECONDS (150) + MEMORY_EXTRACT_TIMEOUT_SECONDS (15)
  < ENGINE_TIMEOUT_MS (180s, BE)
  < proxy_read_timeout (240s, FE/nginx and vite)
  ≤ STORY_TIMEOUT_MS (240s, the SPA's fetch)
```

The gap between the first two lines is not slack to be trimmed: memory
extraction runs after the pipeline finishes, so the Engine's worst case is
the sum, plus HTTP overhead. At `120 + 20` against a 150s BE deadline a run
came back **502 at 150.4s** — the failure the budget exists to prevent.

The whole ladder is sized by the LLM at the bottom of it. With the `ag/`
model of [docs/09](docs/09-mvp-latency-spec.md) (4.6–5.9s per call) the
original `45 / 60s / 180s` is correct and a story arrives in ~34s. These
numbers are what the **free OpenRouter tier** needs.

### FE (.env)
| Variable | Default | Description |
|---|---|---|
| BE_PROXY_TARGET | http://localhost:3001 | Where `vite dev`/`preview` forward `/api/*` (build-time, not `VITE_*`) |
| VITE_BE_URL | /api | Override only to call a separately hosted BE directly — set it to the BE root *without* `/api` |

## Project Structure

```
AI-BEDTIME/
├── FE/          # React 19 frontend
├── BE/          # NestJS 11 backend
│   ├── src/
│   │   ├── common/     # Middleware, guards, filters, pipes
│   │   ├── modules/    # Tenant, Child, Story, Feedback, Memory, EngineGateway
│   │   └── config/     # App, memory, rate-limit configs (engine config lives with its module)
│   └── data/           # SQLite runtime files
├── Engine/      # Python FastAPI engine
│   ├── core/
│   │   ├── llm/        # Multi-LLM clients (OpenAI/Gemini/Custom)
│   │   ├── prompts/    # Prompt templates (system/developer/user)
│   │   └── pipeline.py # Planner → Writer → Reviewer
├── docs/        # Documentation
└── docker-compose.yml  # Multi-service orchestration
```

## Testing

```bash
# FE
cd FE && npm test

# BE
cd BE && npx jest

# Engine
cd Engine && python -m pytest tests/ -v

# The whole SPA journey through nginx: login -> profile -> story -> feedback
node scripts/e2e-flow-test.mjs

# BE -> Engine latency and fallback rate, recorded to test-results/
node scripts/integration-test.mjs --runs 5 --concurrency 2

# Which 9router models actually complete, via the balancer and each replica
node scripts/probe-9router-models.mjs
```

`e2e-flow-test.mjs` answers "does the product work end to end", one journey
with an assertion per step. `integration-test.mjs` answers "how often and how
fast does generation succeed", the same request repeated for statistics.

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide icons
- **Backend**: NestJS 11, TypeORM, Bottleneck, class-validator
- **Engine**: Python 3.11, FastAPI, OpenAI SDK, google-genai SDK
- **Database**: SQLite (dual: core.db + local.db)
- **LLM Providers**: OpenAI (multi-key round-robin) → Gemini → Custom