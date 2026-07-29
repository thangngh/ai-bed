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

- **FE**: React 19 + Vite + Tailwind CSS (thin client, no API keys)
- **BE**: NestJS 11 + TypeORM + Bottleneck queue (orchestration layer)
- **Engine**: Python FastAPI + OpenAI/Gemini/Custom LLM (story generation pipeline)

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

### Frontend (React 19)
```bash
cd FE
npm install
npm run dev         # http://localhost:5173
```

## Environment Variables

### BE (.env)
| Variable | Default | Description |
|---|---|---|
| PORT | 3001 | BE server port |
| ENGINE_URL | http://localhost:8000 | Engine base URL |
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

### FE (.env)
| Variable | Default | Description |
|---|---|---|
| VITE_BE_URL | /api | BE URL (proxy in dev) |

## Project Structure

```
AI-BEDTIME/
├── FE/          # React 19 frontend
├── BE/          # NestJS 11 backend
│   ├── src/
│   │   ├── common/     # Middleware, guards, filters, pipes
│   │   ├── modules/    # Tenant, Child, Story, Feedback, Memory, EngineGateway
│   │   └── config/     # App, engine, rate-limit configs
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
# BE
cd BE && npx jest

# Engine
cd Engine && python -m pytest tests/ -v
```

## Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide icons
- **Backend**: NestJS 11, TypeORM, Bottleneck, class-validator
- **Engine**: Python 3.11, FastAPI, OpenAI SDK, google-genai SDK
- **Database**: SQLite (dual: core.db + local.db)
- **LLM Providers**: OpenAI (multi-key round-robin) → Gemini → Custom