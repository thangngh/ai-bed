# Phase 1 MVP Spec — Bedtime Story Companion

> **Date:** 2026-07-27  
> **Status:** Draft  
> **Scope:** BE (NestJS) + Engine (Python FastAPI) integration with existing FE shell

---

## 1. Overview

Connect the existing FE shell (React 19) to a full BE (NestJS) + Engine (Python FastAPI) backend for real LLM-powered Vietnamese bedtime story generation.

**Key decisions:**
- Monorepo: `FE/` + `BE/` + `Engine/` within `AI-BEDTIME/`
- Sync HTTP flow, but request goes through Bottleneck queue for concurrency control
- Dual SQLite: `core.db` (private schema) + `local.db` (user-visible)
- No login — tenant = device UUID auto-generated
- All prompt instructions in English, story output in Vietnamese
- Multi-LLM with round-robin key rotation + fallback across providers

---

## 2. Project Structure

```
AI-BEDTIME/
├── FE/                          # React 19 (existing, modified)
│   ├── src/
│   │   ├── components/          # Giữ nguyên
│   │   ├── types.ts
│   │   ├── data/sampleStories.ts
│   │   └── utils/
│   │       └── storyGenerator.ts  # Sửa: gọi BE thay vì Gemini
│   ├── server.ts                # Sửa: bỏ Gemini, chỉ proxy
│   ├── package.json
│   └── vite.config.ts
│
├── BE/                          # NestJS 11 (new)
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── common/
│   │   │   ├── decorators/
│   │   │   │   └── tenant.decorator.ts
│   │   │   ├── guards/
│   │   │   │   └── tenant.guard.ts
│   │   │   ├── interceptors/
│   │   │   │   ├── logging.interceptor.ts
│   │   │   │   └── tenant.interceptor.ts
│   │   │   ├── filters/
│   │   │   │   └── http-exception.filter.ts
│   │   │   ├── middleware/
│   │   │   │   ├── rate-limiter.middleware.ts
│   │   │   │   └── tenant.middleware.ts
│   │   │   ├── pipes/
│   │   │   │   └── validation.pipe.ts
│   │   │   └── dto/
│   │   │       ├── api-response.dto.ts
│   │   │       └── pagination.dto.ts
│   │   ├── modules/
│   │   │   ├── tenant/
│   │   │   │   ├── tenant.module.ts
│   │   │   │   ├── tenant.service.ts
│   │   │   │   └── tenant.controller.ts
│   │   │   ├── child/
│   │   │   │   ├── child.module.ts
│   │   │   │   ├── child.service.ts
│   │   │   │   └── child.controller.ts
│   │   │   ├── story/
│   │   │   │   ├── story.module.ts
│   │   │   │   ├── story.service.ts
│   │   │   │   ├── story.controller.ts
│   │   │   │   ├── dto/
│   │   │   │   │   ├── create-story.dto.ts
│   │   │   │   │   └── story-response.dto.ts
│   │   │   │   └── entities/
│   │   │   │       ├── story.entity.ts
│   │   │   │       └── story-section.entity.ts
│   │   │   ├── feedback/
│   │   │   │   ├── feedback.module.ts
│   │   │   │   ├── feedback.service.ts
│   │   │   │   ├── feedback.controller.ts
│   │   │   │   └── entities/
│   │   │   │       └── feedback.entity.ts
│   │   │   ├── memory/
│   │   │   │   ├── memory.module.ts
│   │   │   │   ├── memory.service.ts
│   │   │   │   ├── memory.controller.ts
│   │   │   │   └── entities/
│   │   │   │       └── memory-item.entity.ts
│   │   │   └── engine-gateway/
│   │   │       ├── engine-gateway.module.ts
│   │   │       ├── engine-gateway.service.ts
│   │   │       ├── dto/
│   │   │       │   ├── generate-story.dto.ts
│   │   │       │   └── engine-response.dto.ts
│   │   │       └── engine.config.ts
│   │   └── config/
│   │       ├── app.config.ts
│   │       ├── engine.config.ts
│   │       └── rate-limit.config.ts
│   ├── data/                    # SQLite files (runtime)
│   │   ├── core.db
│   │   └── local.db
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
│
├── Engine/                      # Python FastAPI (new)
│   ├── main.py                  # FastAPI app
│   ├── core/
│   │   ├── orchestrator.py      # Queue consumer + pipeline
│   │   ├── pipeline.py          # Planner → Writer → Reviewer
│   │   ├── memory_extractor.py
│   │   ├── validator.py         # Schema check + safety
│   │   ├── llm/
│   │   │   ├── client.py        # Abstract LLM client
│   │   │   ├── openai_client.py # Round-robin multi-key
│   │   │   ├── gemini_client.py
│   │   │   └── custom_client.py # URL + API key
│   │   └── prompts/
│   │       └── templates/
│   │           ├── system/
│   │           │   └── default.txt
│   │           ├── developer/
│   │           │   ├── 3-4.txt
│   │           │   └── 5-6.txt
│   │           └── user/
│   │               └── default.txt
│   ├── requirements.txt
│   ├── .env.example
│   └── Dockerfile
│
├── docs/
│   ├── superpowers/specs/
│   └── ... (existing docs)
│
└── README.md
```

---

## 3. FE Changes (Minimal)

### 3.1 Remove Gemini Integration

**Files to modify:**
- `FE/server.ts` — remove all Gemini AI code (`GoogleGenAI`, `Type`, Gemini prompt, system instruction). Server becomes pure Vite dev proxy.
- `FE/src/utils/storyGenerator.ts` — remove fallback `buildLocalStory()` if BE returns 503. FE chỉ gọi `/api/story/create` (proxy → BE).
- `FE/.env.example` — remove `GEMINI_API_KEY`. Add only `VITE_BE_URL=http://localhost:3001`

### 3.2 Tenant ID Management

FE tự quản lý tenant-id:

```
On app boot:
  1. Check localStorage for 'bsc_tenant_id'
  2. If found → attach to every request as X-Tenant-Id header
  3. If not found:
     a. POST /api/tenant/init → receive tenant_id
     b. Store in localStorage
     c. Attach to subsequent requests
```

### 3.3 API Calls Refactor

Tất cả API calls đi qua `fetch` với common headers:

```typescript
// FE/src/utils/api.ts (new)
const API_BASE = import.meta.env.VITE_BE_URL || '/api';

async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  let tenantId = localStorage.getItem('bsc_tenant_id');
  
  // Auto-init tenant if missing
  if (!tenantId) {
    const res = await fetch(`${API_BASE}/tenant/init`, { method: 'POST' });
    const data = await res.json();
    tenantId = data.tenant_id;
    localStorage.setItem('bsc_tenant_id', tenantId);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.code || 'API_ERROR');
  }

  return response.json();
}
```

### 3.4 Backward Compatibility

- `SAMPLE_STORIES` giữ nguyên trong `sampleStories.ts` — cho trải nghiệm offline ngay cả khi BE chưa chạy
- HomeScreen vẫn hiển thị preset stories + "Tạo truyện mới" button
- Khi BE không reachable → `storyGenerator.ts` trả về sample story (không fallback LLM ở FE)

### 3.5 Env Safety

FE không giữ bất kỳ API key nào. Config tối thiểu:

```env
# FE/.env
VITE_BE_URL=http://localhost:3001
```

---

## 4. BE Architecture (NestJS 11)

### 4.1 Bootstrapping

- NestJS 11 with Express platform
- Port 3001 (default)
- TypeScript strict mode
- TypeORM with dual SQLite datasources

### 4.2 Dual Database Setup

```typescript
// BE/src/app.module.ts
@Module({
  imports: [
    TypeOrmModule.forRoot({
      name: 'core',
      type: 'sqlite',
      database: 'data/core.db',
      entities: [Tenant, ChildProfile, Feedback],
      synchronize: process.env.NODE_ENV === 'development',
    }),
    TypeOrmModule.forRoot({
      name: 'local',
      type: 'sqlite',
      database: 'data/local.db',
      entities: [Story, StorySection, MemoryItem],
      synchronize: process.env.NODE_ENV === 'development',
    }),
  ],
})
```

### 4.3 Module Structure

| Module | Entities (DB) | Purpose |
|---|---|---|
| TenantModule | Tenant (core.db) | CRUD, lazy init, validate tenant |
| ChildModule | ChildProfile (core.db) | Get/Create profile |
| StoryModule | Story, StorySection (local.db) | Create, read stories |
| FeedbackModule | Feedback (core.db) | Submit feedback → analytics |
| MemoryModule | MemoryItem (local.db) | CRUD, context builder |
| EngineGatewayModule | — | HTTP client → Python Engine |

### 4.4 Middleware Chain

```
Request
  │
  ├─ 1. TenantMiddleware
  │    Parse X-Tenant-Id header
  │    If missing → auto-create tenant (lazy init)
  │    If invalid UUID → 400 INVALID_TENANT
  │    Inject req.tenantId
  │
  ├─ 2. RateLimiterMiddleware
  │    Token bucket per tenant
  │    Capacity: 10 tokens
  │    Refill: 1 token / 6s
  │    If empty → 429 RATE_LIMIT_EXCEEDED + Retry-After header
  │
  ├─ 3. Bottleneck Queue (in StoryService)
  │    Max concurrent: 2 / tenant
  │    Min time: 6s between requests
  │    Nếu queue full → 429 ngay (không đẩy vào Engine)
  │
  ├─ 4. TenantGuard (on protected routes)
  │    Check req.tenantId exists
  │
  └─ 5. Controller → Service
```

### 4.5 Bottleneck Queue Implementation

```typescript
// BE/src/modules/engine-gateway/queue.service.ts
import Bottleneck from 'bottleneck';

@Injectable()
export class QueueService {
  private tenantQueues = new Map<string, Bottleneck>();

  getLimiter(tenantId: string): Bottleneck {
    if (!this.tenantQueues.has(tenantId)) {
      this.tenantQueues.set(tenantId, new Bottleneck({
        maxConcurrent: 2,
        minTime: 6000,   // 6s between requests → ~10 req/min
        reservoir: 10,    // max 10 requests
        reservoirRefreshAmount: 10,
        reservoirRefreshInterval: 60 * 1000, // refresh every 60s
      }));
    }
    return this.tenantQueues.get(tenantId)!;
  }

  async schedule<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const limiter = this.getLimiter(tenantId);
    return limiter.schedule(fn);
  }
}
```

### 4.6 API Endpoints

| Method | Path | Body | Response | Note |
|---|---|---|---|---|
| POST | `/tenant/init` | — | `{ tenant_id }` | Lazy init |
| POST | `/child-profile` | `{ child_name, age, ... }` | `{ child_id }` | Create/Lookup |
| GET | `/child-profile` | `?child_name=` | `{ child_id, ... }` | Get profile |
| POST | `/story/create` | `{ child_name, age, ... }` | `{ story_id, title, sections }` | Main flow |
| GET | `/story/latest` | `?child_name=&limit=` | `{ stories: [...] }` | List stories |
| POST | `/story/feedback` | `{ story_id, rating, ... }` | `{ feedback_id }` | Submit feedback |
| GET | `/memory` | `?child_name=&type=` | `{ memories: [...] }` | Get memories |

### 4.7 StoryService Core Flow

```typescript
async createStory(dto: CreateStoryDto, tenantId: string): Promise<StoryResponse> {
  // 1. Validate + get/create child profile → core.db
  const child = await this.childService.getOrCreate(tenantId, dto);

  // 2. Build context (memories from local.db)
  const memories = await this.memoryService.getRelevant(tenantId, child.childId);
  
  // 3. Schedule through queue → call Engine
  const engineResult = await this.queueService.schedule(tenantId, () =>
    this.engineGateway.generate({
      childName: child.childName,
      age: child.age,
      theme: dto.theme,
      goal: dto.goal,
      mood: dto.mood,
      memories,
      tenantId,
    })
  );

  // 4. Save story → local.db
  const story = await this.localDb.story.create({
    data: {
      tenantId,
      childId: child.childId,
      title: engineResult.title,
      content: JSON.stringify(engineResult.content),
      safetyStatus: engineResult.safetyStatus,
      wordCount: engineResult.wordCount,
      isFallback: engineResult.isFallback,
    }
  });

  return StoryResponse.from(story, engineResult);
}
```

---

## 5. Engine Architecture (Python FastAPI)

### 5.1 Bootstrapping

- Python 3.11+
- FastAPI + uvicorn
- Port 8000
- No database access — stateless

### 5.2 Endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/generate` | `{ childName, age, theme, ... }` | `{ title, content, safetyStatus, ... }` |
| GET | `/health` | — | `{ status: "ok" }` |

### 5.3 Pipeline Flow

```
POST /generate
  │
  ├─ 1. Assemble Prompts
  │    Load system + developer (age-appropriate) + user templates
  │    Inject dynamic data
  │
  ├─ 2. Planner (LLM call)
  │    Input: system + developer + user prompts
  │    Output: story outline JSON
  │    Retry: max 2 times
  │    Validate: JSON schema match
  │
  ├─ 3. Writer (LLM call)
  │    Input: system prompt + outline + user data
  │    Output: full story JSON (Vietnamese)
  │    Retry: max 2 times
  │    Validate: word_count ≥ 100, section order correct
  │
  ├─ 4. Reviewer (LLM call)
  │    Input: system (reviewer variant) + story content
  │    Output: verdict in English (APPROVED/REJECTED/FLAGGED)
  │    If REJECTED → retry Writer 1 time, then review again
  │    If still REJECTED → fallback story
  │
  ├─ 5. Memory Extraction (LLM call, optional)
  │    Input: final story content
  │    Output: extracted memories
  │    Skip if is_fallback=true
  │
  └─ 6. Validate & Return
      Schema check + safety filter
      Return response to BE
```

### 5.4 Retry & Fallback Logic

```
Pipeline retry policy:
  Planner:    max 2 retries → fail → fallback_story()
  Writer:     max 2 retries → fail → fallback_story()
  Reviewer:   max 1 retry (if REJECTED, retry Writer once)
  MemoryExt:  max 1 retry → fail → skip memory (non-critical)

Fallback story:
  - Static JSON response in Vietnamese
  - "Câu chuyện bất ngờ" — ngắn, ấm áp
  - No LLM call needed
  - is_fallback = true flag
```

### 5.5 Prompt Language Policy

```
System prompt:     English instructions + Vietnamese language rules
Developer prompt:  English strategy (age-specific)
User prompt:       English headers + Vietnamese data values
Planner output:    JSON with Vietnamese field values
Writer output:     Vietnamese (thuần Việt)
Reviewer verdict:  English
Memory values:     Vietnamese
```

---

## 6. Multi-LLM with Round-Robin + Fallback

### 6.1 Architecture

```
                    ┌──────────────────────┐
                    │     LLM Router        │
                    │  (Engine/llm/client)  │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
      ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
      │  OpenAI      │ │  Gemini      │ │  Custom      │
      │  Multi-key   │ │  Single-key  │ │  URL + Key   │
      │  Round-robin │ │  Fallback    │ │  Fallback    │
      └──────────────┘ └──────────────┘ └──────────────┘
```

### 6.2 Round-Robin Key Rotation (OpenAI)

Engine duy trì vòng tròn các OpenAI key:

```python
class OpenAIClient(BaseLLMClient):
    def __init__(self):
        self.keys = self.load_keys()  # load from env
        self.index = 0
        self.key_failures = {k: 0 for k in self.keys}
        self.max_failures = 3  # disable key after 3 consecutive failures
    
    def get_next_key(self) -> tuple[str, str]:
        """Round-robin rotation with failure tracking"""
        for _ in range(len(self.keys)):
            key = self.keys[self.index]
            self.index = (self.index + 1) % len(self.keys)
            
            if self.key_failures.get(key, 0) < self.max_failures:
                return key
            
            # Skip temporarily disabled keys
            continue
        
        # All keys disabled → raise (triggers fallback to next provider)
        raise AllKeysExhausted("All OpenAI keys failed")
    
    async def complete(self, prompt: str) -> str:
        key = self.get_next_key()
        try:
            response = await self._call_openai(key, prompt)
            self.key_failures[key] = 0  # reset on success
            return response
        except (RateLimitError, AuthenticationError) as e:
            self.key_failures[key] += 1
            # Retry with next key (recursive with new index)
            return await self.complete(prompt)
```

### 6.3 LLM Provider Fallback Chain

Engine routing config:

```
PRIMARY_LLM = openai
FALLBACK_LLM = gemini
CUSTOM_LLM = (optional)
```

Fallback logic:

```python
class LLMRouter:
    def __init__(self):
        self.providers = {
            'openai': OpenAIClient(),
            'gemini': GeminiClient(),
            'custom': CustomClient(),
        }
        self.fallback_order = self._load_fallback_order()
    
    async def complete(self, prompt: str, stage: str) -> str:
        last_error = None
        for provider_name in self.fallback_order:
            try:
                provider = self.providers[provider_name]
                return await provider.complete(prompt, stage)
            except AllKeysExhausted:
                # No usable keys in this provider → try next
                last_error = "All keys exhausted"
                continue
            except ProviderFailure as e:
                last_error = str(e)
                continue
        
        raise FallbackTriggered(f"All providers failed: {last_error}")
```

### 6.4 Configuration

```env
# Engine/.env

# Primary provider: OpenAI with round-robin keys
PRIMARY_LLM=openai
OPENAI_API_KEYS=sk-key1,sk-key2,sk-key3,sk-key4
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_RETRIES=3

# Fallback provider: Gemini
FALLBACK_LLM=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash

# Optional custom LLM (3rd fallback)
# CUSTOM_LLM_NAME=custom
# CUSTOM_LLM_URL=https://...
# CUSTOM_LLM_API_KEY=...
# CUSTOM_LLM_MODEL=...
```

### 6.5 Key Health Tracking

- Mỗi key có counter `consecutive_failures`
- Reset counter về 0 khi call thành công
- Key bị disable tạm thời khi `consecutive_failures >= max_failures` (default: 3)
- Background health check mỗi 5 phút: thử gọi 1 key đang disabled → enable lại nếu OK
- Export metrics: `total_calls_per_key`, `failure_rate`, `active_keys_count`

---

## 7. API Contracts

### 7.1 POST /story/create

```
Request (to BE):
POST /story/create
X-Tenant-Id: <uuid>

{
  "child_name": "An",
  "age": 4,
  "theme": "công chúa và rồng",
  "goal": "học cách dũng cảm",
  "mood": "vui vẻ",
  "language": "vi"
}

Response (200):
{
  "request_id": "uuid",
  "story_id": "uuid",
  "data": {
    "title": "Công chúa An và chú rồng hiền",
    "sections": [
      { "type": "opening", "text": "...", "order": 0 },
      { "type": "context", "text": "...", "order": 1 },
      { "type": "interaction", "text": "...", "prompt": "...", "order": 2 },
      { "type": "resolution", "text": "...", "order": 3 }
    ],
    "interaction_count": 2,
    "word_count": 350,
    "safety_status": "APPROVED"
  },
  "meta": {
    "latency_ms": 4500,
    "llm_calls": 3,
    "is_fallback": false
  }
}

Error (422) — Validation:
{
  "error": { "code": "VALIDATION_ERROR", "message": "Tuổi không hợp lệ", "details": { "field": "age", "value": 2 } },
  "request_id": "uuid"
}

Error (429) — Rate limited:
{
  "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "Quá nhiều yêu cầu", "retry_after": 3000 },
  "request_id": "uuid"
}
```

### 7.2 POST /generate (BE → Engine)

```
POST http://localhost:8000/generate
X-Tenant-Id: <uuid>

{
  "child_name": "An",
  "age": 4,
  "theme": "công chúa và rồng",
  "goal": "học cách dũng cảm",
  "mood": "vui vẻ",
  "language": "vi",
  "memories": [
    { "type": "interest", "key": "favorite_theme", "value": "công chúa", "confidence": 0.9 }
  ],
  "recent_stories": [
    { "title": "...", "theme": "..." }
  ]
}

Response (200):
{
  "request_id": "uuid",
  "title": "Công chúa An và chú rồng hiền",
  "content": [
    { "type": "opening", "text": "...", "order": 0 },
    { "type": "interaction", "text": "...", "prompt": "...", "order": 2 }
  ],
  "safety_status": "APPROVED",
  "memories": [
    { "type": "interest", "key": "liked_theme", "value": "rồng", "confidence": 0.7 }
  ],
  "llm_calls": 3,
  "word_count": 350,
  "is_fallback": false,
  "latency_ms": 4500
}
```

### 7.3 POST /tenant/init

```
Request:
POST /tenant/init

Response (200):
{
  "tenant_id": "a1b2c3d4-...",
  "message": "Tenant initialized"
}
```

### 7.4 GET /story/latest

```
GET /story/latest?child_name=An&limit=5
X-Tenant-Id: <uuid>

Response (200):
{
  "stories": [
    {
      "story_id": "uuid",
      "title": "Công chúa An dũng cảm",
      "theme": "công chúa",
      "created_at": "2026-07-27T...",
      "safety_status": "APPROVED",
      "word_count": 350,
      "interaction_count": 2
    }
  ]
}
```

---

## 8. Data Flow (Complete)

```
                ┌──────────┐
                │  Browser  │
                │ (FE SPA)  │
                └─────┬────┘
                      │ POST /story/create
                      │ X-Tenant-Id: uuid
                      ▼
                ┌──────────────┐
                │  BE (NestJS) │  Port 3001
                │              │
                │  1. TenantMiddleware
                │     → inject tenantId
                │
                │  2. RateLimiterMiddleware
                │     → token bucket check
                │
                │  3. StoryService
                │     → get/create child (core.db)
                │     → get memories (local.db)
                │     → schedule via Bottleneck queue
                │
                │  4. EngineGatewayService
                │     → HTTP POST /generate
                └──────┬────────┘
                       │ HTTP (sync)
                       ▼
                ┌──────────────────┐
                │ Engine (FastAPI) │  Port 8000
                │                  │
                │  LLMRouter        │
                │  ├─ OpenAI (round-robin keys)
                │  ├─ Gemini (fallback)
                │  └─ Custom (3rd fallback)
                │                  │
                │  Pipeline:        │
                │  Planner → Writer → Reviewer → MemoryExt
                │                  │
                └──────┬───────────┘
                       │ Response JSON
                       ▼
                ┌──────────────┐
                │  BE (NestJS) │
                │              │
                │  5. Save story (local.db)
                │  6. Save memories (local.db)
                │  7. Return → FE
                └──────┬────────┘
                       │ Story JSON
                       ▼
                ┌──────────┐
                │  Browser  │
                │ StoryView │
                └──────────┘
```

---

## 9. Rate Limiting & DDoS Protection

### 9.1 Three-Layer Defense

```
Layer 1: Token Bucket (BE Middleware)
  ├─ Rejects excess requests before they reach logic
  ├─ 10 tokens/tenant, refill 1 token/6s
  ├─ Returns 429 + Retry-After header
  └─ In-memory Map<tenantId, TokenBucket>

Layer 2: Bottleneck Queue (BE Service)
  ├─ Controls concurrency per tenant
  ├─ maxConcurrent: 2
  ├─ minTime: 6000ms
  ├─ Reservoir: 10 req/60s
  ├─ Queue backlog max length: 20
  └─ If queue full → 429 immediately

Layer 3: LLM Key Rotation (Engine)
  ├─ OpenAI multi-key round-robin
  ├─ Key auto-disable after consecutive failures
  └─ Provider fallback if all keys failed
```

### 9.2 Request Timeouts

| Layer | Timeout |
|---|---|
| FE → BE | 30s |
| BE → Engine | 25s |
| Engine → LLM | 20s per call (max 3 calls = 60s) |
| Total request timeout | 120s |

---

## 10. Configuration

### 10.1 BE `.env`

```env
# Server
PORT=3001
NODE_ENV=development

# Engine connection
ENGINE_URL=http://localhost:8000
ENGINE_TIMEOUT_MS=25000
ENGINE_RETRY_COUNT=2

# Rate limiting
RATE_LIMIT_CAPACITY=10
RATE_LIMIT_REFILL_SECONDS=6

# Queue
QUEUE_MAX_CONCURRENT=2
QUEUE_MIN_TIME_MS=6000
QUEUE_RESERVOIR=10
QUEUE_RESERVOIR_REFRESH_MS=60000
```

### 10.2 Engine `.env`

```env
# Primary provider: OpenAI (multi-key round-robin)
PRIMARY_LLM=openai
OPENAI_API_KEYS=sk-key1,sk-key2,sk-key3,sk-key4
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOKENS=1024
OPENAI_TEMPERATURE=0.7

# Fallback provider: Gemini
FALLBACK_LLM=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash

# Custom LLM (optional 3rd fallback)
# CUSTOM_LLM_URL=
# CUSTOM_LLM_API_KEY=
# CUSTOM_LLM_MODEL=

# Server
ENGINE_PORT=8000
ENGINE_MAX_CONCURRENT=4
```

### 10.3 FE `.env`

```env
VITE_BE_URL=http://localhost:3001
```

---

## 11. Security

### 11.1 No API Keys in FE

- FE chứa 0 API key — không Gemini, không OpenAI
- LLM keys chỉ tồn tại trong Engine `.env`
- BE không chứa LLM keys — chỉ có Engine URL

### 11.2 Tenant Isolation

- Mọi request gắn `X-Tenant-Id`
- BE filter ALL queries bằng tenantId
- Cross-tenant access → 403 TENANT_MISMATCH
- Tenant ID là UUID v4 — không đoán được

### 11.3 Input Sanitization

- class-validator (BE) + Pydantic (Engine)
- Strip HTML tags, XSS patterns
- Max length constraints on all fields

### 11.4 Error Safety

- No stack traces in responses
- Generic error messages cho user
- Structured error codes
- Detailed logging only server-side

---

## 12. Testing Strategy

### 12.1 BE Unit Tests (Jest)

| Test | What |
|---|---|
| Validation | DTO validation rules (age range, name length, etc.) |
| Tenant service | Create, lookup, auto-init |
| Rate limiter | Token bucket consume/refill |
| Story service | Queue scheduling, DB save |
| Memory service | Priority loading, token budget |
| Engine gateway | HTTP retry, timeout handling |

### 12.2 Engine Unit Tests (pytest)

| Test | What |
|---|---|
| LLM Router | Provider fallback chain |
| OpenAI client | Round-robin key rotation, key disable/enable |
| Pipeline | Planner → Writer → Reviewer flow |
| Validator | Schema check, safety filter |
| Prompt assembly | Template loading, variable injection |

### 12.3 Integration Tests

| Test | What |
|---|---|
| BE → Engine | HTTP call with real timeout |
| DB dual source | Write to core.db, read from local.db |
| Tenant isolation | Multi-tenant data separation |

### 12.4 E2E Tests

| Test | What |
|---|---|
| Happy path | Create story → read → feedback |
| Multi-tenant | 2 tenants, verify data isolation |
| Error path | Invalid input → 422, rate limit → 429 |

---

## 13. Implementation Order

### Phase 1A: Foundation (Day 1-2)

1. **Scaffold BE** — NestJS project, TypeORM dual DB, middleware chain
2. **Scaffold Engine** — FastAPI project, health endpoint, requirements.txt
3. **Tenant flow** — BE tenant create/lookup, FE localStorage integration
4. **Dual DB** — TypeORM entities, sync + migrations in dev

### Phase 1B: Core Pipeline (Day 3-4)

5. **Multi-LLM client** — OpenAI round-robin keys, Gemini fallback
6. **Prompt templates** — system/developer/user (.txt files)
7. **Planner stage** — LLM call #1, JSON validation, retry
8. **Writer stage** — LLM call #2, content validation
9. **Reviewer stage** — LLM call #3, verdict logic, fallback

### Phase 1C: Integration (Day 5-6)

10. **EngineGateway** — BE → Engine HTTP client
11. **StoryService** — full orchestration, queue
12. **Feedback + Memory** — endpoints, context building
13. **FE refactor** — storyGenerator.ts, tenant ID, API calls
14. **Error handling** — all error codes, fallback story

### Phase 1D: Polish (Day 7)

15. **Rate limiter tuning** — token bucket + bottle queue
16. **Logging + monitoring** — structured logs
17. **Integration tests** — BE ↔ Engine
18. **E2E testing** — full flow

---

## 14. Team & Dependencies

### Team Size
- **1 developer** (full-stack)

### External Dependencies
| Dependency | Purpose | License |
|---|---|---|
| NestJS 11 | BE framework | MIT |
| TypeORM | ORM for SQLite | MIT |
| Bottleneck | Concurrency limiter | MIT |
| FastAPI | Python web framework | MIT |
| Pydantic | Python validation | MIT |
| openai | OpenAI API client | MIT |
| google-genai | Gemini API client | Apache 2.0 |

---

## 15. Risks & Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| LLM API rate limit (429) | User gets error | Round-robin keys + fallback provider |
| LLM output invalid | Story broken | Schema validation + retry + fallback story |
| SQLite concurrent writes | DB lock | Bottleneck queue ensures serialized writes |
| Tenant ID lost (clear cache) | Orphan data | User can continue, old data linkable by child_name |
| Python → LLM timeout | 30s+ latency | 20s timeout per call, retry mechanism |
