# Phase 2 Spec — Complete Data Flow, History UX & Infrastructure

> **Date:** 2026-07-27  
> **Status:** Draft  
> **Scope:** Hoàn thiện data flow từ FE → Engine, Story History UX, Docker infrastructure

---

## 1. Overview

Phase 2 giải quyết tất cả gaps từ Phase 1 để sản phẩm hoạt động end-to-end thực sự. 3 sub-phases:

**2A — Complete Data Flow:** Gender, favoriteCharacter, customTopic, customLesson từ FormScreen đến Engine prompt. Section mapping chuẩn hóa. Feedback gọi BE API. Saved stories đồng bộ BE.

**2B — Story History UX:** Lịch sử truyện từ BE, đọc lại truyện cũ, "Tủ truyện" modal fetch từ API, gửi feedback lên BE.

**2C — Infrastructure:** Docker compose, integration tests, README, error handling.

---

## 2. Architecture Changes

```
FE (React 19)                              BE (NestJS 11)                    Engine (FastAPI)
─────────────────                          ──────────────                    ────────────────
FormScreen                                   StoryController                   main.py
  ├─ gender ─────────┐                       ├─ dto: gender                  GenerateRequest
  ├─ favoriteChar ───┤                       ├─ dto: favorite_character          ├─ gender
  └─ customTopic ────┤  /story/create ──────►│  StoryService                     ├─ favoriteCharacter
                     │                       │    ├─ ChildService                 └─ ... ──► PromptRegistry
SavedStoriesModal    │                       │    ├─ EngineGateway                    ├─ gender → template
  └─ fetch /story    │                       │    └─ MemoryService                    └─ favoriteCharacter → template
     GET /story/latest│                      │
     GET /story/:id   │◄─ response ──────────│  EngineGateway → POST /generate ──►  Orchestrator
                      │                      │                                      ├─ Pipeline (planner→writer→reviewer)
FeedbackScreen        │                      │                                      └─ MemoryExtractor
  └─ POST /story/feedback ──────────────►  │  FeedbackService
                     │                      │    └─ update memory
LoadingScreen         │                     │
  └─ loading state     │                     │
```

**No new DB schemas.** All additions use existing tables with nullable columns.

---

## 3. 2A — Complete Data Flow

### 3.1 Gender & FavoriteCharacter Pipeline

**Current gap:** `FormScreen` collects `gender` (`'boy'|'girl'|'unspecified'`) and `favoriteCharacter` (free text) but these never reach Engine. Prompt templates don't know child's gender or favorite character.

**Full pipeline fix (6 layers):**

**Layer 1 — FE `storyGenerator.ts`:**
```typescript
// Bổ sung vào POST body
const data = await apiClient<any>('/story/create', {
  method: 'POST',
  body: JSON.stringify({
    child_name: input.childName,
    age: input.childAge,
    theme: input.favoriteTopic,
    goal: input.lesson || '',
    mood: input.mood || 'vui vẻ',
    language: 'vi',
    gender: input.gender || 'unspecified',
    favorite_character: input.favoriteCharacter || '',
  }),
});
```

**Layer 2 — FE section mapping fix:**
```typescript
// Chuẩn hóa section type → segment mapping, không fallback chain
const SECTION_MAP: Record<string, string> = {
  opening: 'opening',
  context: 'situation',
  conflict: 'challenge',
  resolution: 'ending',
  interaction_1: 'interaction1',
  interaction_2: 'interaction2',
  interaction_3: 'interaction3',
  moral: 'moralSummary',
};

// Nếu thiếu section → empty string (không dùng section khác làm fallback)
const segments: any = {};
for (const [sectionType, segmentKey] of Object.entries(SECTION_MAP)) {
  const section = sections.find((s: any) => s.type === sectionType);
  segments[segmentKey] = section?.text || section?.prompt || '';
}
```

**Layer 3 — BE `CreateStoryDto`:**
```typescript
@IsOptional()
@IsString()
gender?: string;

@IsOptional()
@IsString()
favorite_character?: string;
```

**Layer 4 — BE `GenerateDto` (engine-gateway):**
```typescript
gender?: string;
favoriteCharacter?: string;
```

**Layer 5 — Engine `main.py` `GenerateRequest`:**
```python
gender: Optional[str] = ""
favorite_character: Optional[str] = ""
```

**Layer 6 — Engine `PromptRegistry`:**
- `assemble(data)` nhận thêm `gender`, `favoriteCharacter`
- `user/default.txt` template mới:
```
Child information:
- Name: {childName}
- Age: {age}
- Gender: {gender}
- Theme: {theme}
- Lesson goal: {goal}
- Mood: {mood}
- Favorite character: {favoriteCharacter}
- Memory context: {memories}
```

**Prompt templates update:**
- `developer/3-4.txt` và `developer/5-6.txt`: thêm hướng dẫn về gender và favorite character

### 3.2 Section Contract Standardization

**Current problem:** Engine writer generates sections with inconsistent types. Pipeline only validates JSON parseable, not section completeness.

**Fix:**
1. Engine `OutputValidator` — add `validate_sections(sections)`:
   - Must have at least: `opening`, `context`, `conflict`, `resolution`
   - Should have: `interaction_1`, `interaction_2`, `interaction_3`, `moral`
   - Each section has `type: str`, `text: str`, `order: int`, `prompt: str` (for interactions)
2. Writer prompt template — specify exact section schema in system prompt
3. Pipeline retry: if sections incomplete → retry writer (counts as retry)

### 3.3 Feedback → BE API

**Current:** `App.tsx handleFeedbackSubmit` only saves to localStorage.

**Fix:**
```typescript
// App.tsx
const handleFeedbackSubmit = async (feedback: FeedbackData) => {
  try {
    await apiClient('/story/feedback', {
      method: 'POST',
      body: JSON.stringify({
        story_id: feedback.storyId,
        child_name: activeStory?.childName || '',
        listened_complete: feedback.listenedUntilEnd ? 1 : 0,
        wants_more: feedback.wantsMoreStories === 'yes' ? 1 : feedback.wantsMoreStories === 'no' ? 0 : null,
        suitable: feedback.suitabilityRating >= 4 ? 1 : 0,
        rating: feedback.suitabilityRating,
        note: feedback.comment || '',
      }),
    });
  } catch (err) {
    // Fallback: lưu localStorage nếu BE offline
    const existing = JSON.parse(localStorage.getItem('bedtime_feedbacks') || '[]');
    existing.push({ ...feedback, createdAt: new Date().toISOString() });
    localStorage.setItem('bedtime_feedbacks', JSON.stringify(existing));
  }
};
```

### 3.4 Saved Stories Sync

**BE changes:**
- `Story.entity.ts` — thêm `isSaved` column (default 1)
- `POST /story/save` — toggle isSaved flag
- `DELETE /story/:id` — hard delete (or isActive = 0)

**FE changes:**
- `SavedStoriesModal` mount → fetch `GET /story/latest?limit=50`
- Merge BE data với localStorage stories
- "Save" button → gọi `POST /story/save`

### 3.5 Child Profile Update

```typescript
// BE child.service.ts
async update(childId: string, tenantId: string, dto: UpdateChildProfileDto): Promise<ChildProfile>

// BE child.controller.ts
@Put(':childId')
async update(
  @Param('childId') childId: string,
  @Body() dto: UpdateChildProfileDto,
  @Req() req: Request,
)
```

---

## 4. 2B — Story History UX

### 4.1 GET /story/:id — Full Story Detail

```typescript
// BE story.controller.ts
@Get(':id')
async getById(@Param('id') id: string, @Req() req: Request) {
  const tenantId = (req as any).tenantId;
  const story = await this.storyService.findById(id, tenantId);
  if (!story) throw new NotFoundException('Story not found');
  return StoryResponse.detail(story);
}

// BE story.service.ts
async findById(storyId: string, tenantId: string): Promise<Story | null> {
  const story = await this.storyRepo.findOne({
    where: { storyId, tenantId },
    relations: ['sections'],
  });
  return story;
}
```

### 4.2 SavedStoriesModal → BE-backed

**Modal behavior:**
1. On mount: `GET /story/latest?limit=50` → populate list
2. User clicks story → `GET /story/:id` → show full story
3. Delete → `DELETE /story/:id` → optimistic remove from list
4. Fallback to localStorage stories (sample stories) khi BE offline

### 4.3 StoryFormInput → Engine: Missing Fields in create-story.dto

Add to `CreateStoryDto`:
```typescript
@IsOptional()
@IsString()
gender?: string;

@IsOptional()
@IsString()
favorite_character?: string;

@IsOptional()
@IsString()
custom_lesson?: string;
```

---

## 5. 2C — Infrastructure

### 5.1 Docker Compose

```yaml
# docker-compose.yml
version: '3.8'
services:
  engine:
    build:
      context: ./Engine
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    env_file:
      - ./Engine/.env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  backend:
    build:
      context: ./BE
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    env_file:
      - ./BE/.env
    depends_on:
      engine:
        condition: service_healthy
    restart: unless-stopped
    volumes:
      - ./BE/data:/app/data  # persist SQLite

  frontend:
    build:
      context: ./FE
      dockerfile: Dockerfile
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped
```

**BE/Dockerfile:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist/ ./dist/
COPY data/ ./data/
EXPOSE 3001
CMD ["node", "dist/main"]
```

**FE/Dockerfile (production — Nginx):**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 5.2 BE Dockerfile — Multi-stage build

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist/
COPY --from=build /app/node_modules ./node_modules/
COPY --from=build /app/package.json ./
COPY data/ ./data/
EXPOSE 3001
CMD ["node", "dist/main"]
```

### 5.3 Integration Tests

**Engine → BE smoke test:**
```python
# Engine/tests/test_integration.py
import pytest
from httpx import AsyncClient, ASGITransport
from main import app


@pytest.mark.asyncio
async def test_health():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_generate_returns_fallback():
    """Without API keys, should return fallback story."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/generate", json={
            "child_name": "Test",
            "age": 4,
            "theme": "Động vật",
        })
        data = resp.json()
        assert "title" in data
        assert resp.status_code == 200
```

**BE integration test:**
```typescript
// BE/src/modules/story/__tests__/story.integration.spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../app.module';

describe('Story API (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  it('POST /story/create with valid dto returns 201', async () => {
    const tenantId = 'test-tenant-uuid';
    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', tenantId)
      .send({
        child_name: 'Test',
        age: 4,
        theme: 'Động vật',
      });
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });
});
```

### 5.4 Error Handling Improvements

**BE:**
- EngineGateway timeout (15s default) → clear error message
- Db constraints violation → 400, not 500
- Queue full → 429 with Retry-After header (existing rate limiter)

**Engine:**
- `POST /generate` → validate required fields (`child_name`, `age`, `theme`)
- Return 422 for invalid input, 503 for provider failure

**FE:**
- `ErrorScreen` shows specific error type:
  - Network error: "Mạng không ổn định"
  - Timeout: "Máy kể chuyện hơi chậm, vui lòng thử lại"
  - Server error: "Máy chủ đang bảo trì"
  - Unknown: "Có lỗi xảy ra"
- Retry button increments attempt counter

### 5.5 README

```markdown
# Bedtime Story Companion

Tạo câu chuyện trước giờ ngủ cho bé 3-6 tuổi bằng AI.

## Architecture

FE (React 19) → BE (NestJS 11) → Engine (Python FastAPI + LLM)

## Quick Start (Docker)

cp BE/.env.example BE/.env
cp Engine/.env.example Engine/.env
# Add API keys to both .env files
docker compose up -d
http://localhost

## Local Development

### BE
cd BE
npm install
npm run start:dev

### Engine
cd Engine
pip install -r requirements.txt
python main.py

### FE
cd FE
npm install
npm run dev
```

---

## 6. Config Changes

**BE .env** — no new vars (existing config covers)

**Engine .env** — no new vars

**FE .env** — existing `VITE_BE_URL`

---

## 7. Security

- Gender field: only `'boy' | 'girl' | 'unspecified'` — validate at DTO layer
- favorite_character: free text, sanitized by OutputValidator (safety blocklist)
- DELETE /story/:id: tenant-scoped, cannot delete other tenant's stories

---

## 8. Testing Strategy

| Layer | Test Type | Coverage |
|---|---|---|
| FE unit | Component test | Gender select, form submit payload |
| BE unit | Service + Controller | DTO validation, section mapping, feedback API |
| Engine unit | Pipeline test | GenerateRequest parsing, section validation |
| Integration | BE ↔ Engine | HTTP smoke test, fallback flow |
| E2E | Full stack | Form → loading → story → feedback → saved |

---

## 9. Implementation Order

1. **2A (Data Flow)** — 6 tasks: DTO chain → Prompt templates → Section contract → Feedback API → Saved stories → Child update  
2. **2B (History UX)** — 4 tasks: GET /story/:id → SavedStoriesModal BE → Feedback BE integration → ReadAgain from BE  
3. **2C (Infra)** — 5 tasks: Dockerfiles → Docker compose → Integration tests → Error handling → README  

Total: ~15 tasks
