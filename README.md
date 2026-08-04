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
cp BE/.env.example BE/.env
cp Engine/.env.example Engine/.env

# 2. Add your API keys to Engine/.env
#    OPENAI_API_KEYS=sk-xxx,sk-yyy (round-robin multi-key)
#    GEMINI_API_KEY=...

# 3. Start all services
docker compose up -d

# 4. Open http://localhost
```

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
| ENGINE_TIMEOUT_MS | 60000 | Must stay above the Engine's `PIPELINE_BUDGET_SECONDS` (45s) so a slow run returns a fallback story, not a 502 |
| DB_PATH | ./data | SQLite files directory |
| QUEUE_MAX_CONCURRENT | 2 | Bottleneck per-tenant limit |
| QUEUE_MIN_TIME_MS | 6000 | Minimum time between jobs |
| RATE_LIMIT_CAPACITY | 10 | Token bucket capacity |
| RATE_LIMIT_REFILL_RATE | 10 | Tokens per minute |

### Engine (.env)
| Variable | Default | Description |
|---|---|---|
| ENGINE_PORT | 8000 | Engine server port |
| OPENAI_API_KEYS | - | Comma-separated keys (round-robin) |
| GEMINI_API_KEY | - | Gemini fallback key |
| CUSTOM_LLM_URL | - | Custom OpenAI-compatible URL |
| CUSTOM_LLM_API_KEY | - | Custom LLM API key |
| CUSTOM_LLM_MODEL | - | Custom LLM model name |

### Engine (.env), continued
| Variable | Default | Description |
|---|---|---|
| PIPELINE_BUDGET_SECONDS | 45 | Whole-generation deadline; a run that exceeds it returns the fallback story |

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

# FE -> BE -> Engine against running services
node scripts/integration-test.mjs
```

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide icons
- **Backend**: NestJS 11, TypeORM, Bottleneck, class-validator
- **Engine**: Python 3.11, FastAPI, OpenAI SDK, google-genai SDK
- **Database**: SQLite (dual: core.db + local.db)
- **LLM Providers**: OpenAI (multi-key round-robin) → Gemini → Custom