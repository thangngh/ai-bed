# Design — Full TDD Tích Hợp BE → FE → Engine

> **Ngày:** 2026-07-31
> **Trạng thái:** Approved
> **Phương pháp:** Approach A — contract-first, tăng dần từng tầng (red → green → refactor)

---

## 1. Mục tiêu

Xây dựng full TDD tích hợp cho cả 3 tầng của Bedtime Story Companion:

- **BE** (NestJS): fix 3 suite đang fail, thêm contract test BE↔Engine, thêm integration test với Engine thật.
- **Engine** (FastAPI): thêm integration test chạy pipeline thật qua LLM proxy.
- **FE** (React 19): dựng test infrastructure mới (Vitest + RTL) và viết unit/component test.
- **E2E**: script riêng tự spawn Engine + BE, test flow xuyên suốt qua HTTP.

## 2. Hiện trạng

| Tầng | Trạng thái test |
|---|---|
| BE | 15 suite / 52 test, **3 suite fail**: thiếu `supertest` (chưa cài), `datasource.spec.ts` lỗi shutdown |
| Engine | 50 test pass (toàn mock / fallback) |
| FE | **Không có** test infrastructure (không vitest/jest/playwright) |
| E2E | Không có |

### Bug contract phát hiện khi khám phá

BE gửi payload camelCase (`childName`, `recentStories`, `favoriteCharacter`) lên Engine, nhưng Engine (`GenerateRequest`) nhận snake_case (`child_name`, `recent_stories`, `favorite_character`) → flow thật FE→BE→Engine sẽ fail 422. **Quyết định: fix phía BE** bằng hàm mapping.

### LLM proxy đã xác minh

- Endpoint: `http://localhost:20128/` — OpenAI-compatible proxy (`combo`).
- `GET /v1/models` → danh sách model.
- Model hoạt động ổn định: **`open-code`** (deepseek-v4-flash), trả `choices[0].message.content` chuẩn.
- Các model khác không dùng: gemma-4-26b (504), gemma-4-31b (429), mimi (400), ollama-local (503).
- CustomClient cần `CUSTOM_LLM_URL` = full endpoint `/v1/chat/completions` + `CUSTOM_LLM_MODEL=open-code`.

---

## 3. Kiến trúc test stack

```
┌───────────────────────────────────────────────────────────────┐
│  E2E script (scripts/e2e.mjs) — spawn Engine + BE thật          │
│  → test flow xuyên suốt qua HTTP                                │
├───────────────────────────────────────────────────────────────┤
│  FE (Vitest + RTL)    │  BE (jest)          │  Engine (pytest) │
│  - apiClient          │  - unit test        │  - pipeline thật  │
│  - storyGenerator     │  - integration test │  - LLM qua proxy  │
│  - component test     │    (Engine thật)    │                  │
│                       │  - contract test    │                  │
├───────────────────────────────────────────────────────────────┤
│  LLM proxy: http://localhost:20128/v1/chat/completions (open-code)│
└───────────────────────────────────────────────────────────────┘
```

Luồng dữ liệu test: **FE apiClient → BE `/api/*` → Engine `/generate` → LLM proxy → story**

Target sau khi hoàn thành:

| Tầng | Trước | Sau |
|---|---|---|
| FE | 0 test | ~10 test (unit + component) |
| BE | 52 test (3 fail) | ~65 test (0 fail) |
| Engine | 50 test | ~55 test |
| E2E | 0 | 1 script, 2-3 flow |

---

## 4. Hạng mục chi tiết

### 4.1 Fix nền tảng BE

| Suite | Nguyên nhân | Fix |
|---|---|---|
| `tenant.controller.spec.ts` | `supertest` khai báo trong package.json nhưng chưa cài | `npm install supertest @types/supertest` |
| `story.integration.spec.ts` | Cùng lý do | Cài xong là chạy |
| `datasource.spec.ts` | `module.close()` gọi TypeORM shutdown nhưng override DataSource không đúng | Override **cả 2** datasource (`core` + `local`) bằng SQLite `:memory:`; hoặc destroy DataSource trước khi close |

### 4.2 Fix bug contract camelCase → snake_case

Trong `EngineGatewayService.generate()` — thêm hàm mapping trước khi `JSON.stringify`:

```ts
private toEnginePayload(dto: GenerateDto) {
  return {
    child_name: dto.childName,
    age: dto.age,
    theme: dto.theme,
    goal: dto.goal ?? '',
    mood: dto.mood ?? 'vui vẻ',
    language: dto.language ?? 'vi',
    memories: dto.memories ?? [],
    recent_stories: dto.recentStories ?? [],
    gender: dto.gender ?? '',
    favorite_character: dto.favoriteCharacter ?? '',
  };
}
```

`tenantId` không nằm trong body Engine — chỉ gửi qua header `X-Tenant-Id`.

### 4.3 Contract test BE↔Engine (mới)

Tạo `src/modules/engine-gateway/__tests__/engine-gateway.service.spec.ts` (hiện chưa có):
- Mock global `fetch`.
- Assert payload gửi đi đúng snake_case.
- Assert map response snake_case → camelCase (`request_id`→`requestId`, `llm_calls`→`llmCalls`, `latency_ms`→`latencyMs`, `word_count`→`wordCount`, `is_fallback`→`isFallback`).
- Assert error mapping: timeout → `ENGINE_TIMEOUT`/502, non-2xx → `ENGINE_ERROR`, ECONNREFUSED → `ENGINE_UNAVAILABLE`.

### 4.4 BE integration test với Engine thật (mới)

Tạo `src/modules/story/__tests__/story.flow.spec.ts`:
- Boot AppModule thật (SQLite `:memory:` cho core + local).
- Mặc định **skip** nếu Engine chưa listen (env flag `E2E=1` hoặc `describe.skipIf`).
- Test cases:
  1. `POST /story/create` payload hợp lệ → 201, có `title` + `content`, `safety_status`.
  2. Thiếu field → 422 + error code rõ ràng.
  3. Tenant A/B tạo story → không trộn lẫn.
  4. Engine down → 502 `ENGINE_UNAVAILABLE`.

### 4.5 Engine integration test với LLM thật (mới)

Tạo `Engine/tests/test_engine_real_llm.py`:
- Skip khi proxy không reachable (health check `http://localhost:20128/v1/models`).
- Config qua monkeypatch env: `CUSTOM_LLM_URL`, `CUSTOM_LLM_MODEL=open-code`.
- Test cases:
  1. Pipeline thật planner→writer→reviewer trả `title` + `content` hợp lệ (hoặc fallback — không "xanh giả").
  2. `POST /generate` (ASGI TestClient) với payload snake_case → 200, đúng schema `GenerateResponse`.
  3. `/health` → `status: ok`.

### 4.6 FE test infrastructure (mới)

Cài devDeps: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`.

`FE/package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Tạo:
- `FE/vitest.config.ts` (dùng chung alias `@`, environment `jsdom`).
- `FE/src/test/setup.ts` (jest-dom matchers).
- `FE/src/vite-env.d.ts` — fix lỗi lint `TS2339: Property 'env' does not exist on type 'ImportMeta'`.

### 4.7 FE test files

| File | Nội dung |
|---|---|
| `src/utils/__tests__/api.test.ts` | `ensureTenantId` gọi `/tenant/init` 1 lần & cache; header `X-Tenant-Id` luôn có; error code throw đúng |
| `src/utils/__tests__/storyGenerator.test.ts` | Map form → payload `/story/create` đúng, xử lý response |
| `src/components/__tests__/FormScreen.test.tsx` | Validate tuổi 3–6, bắt buộc name+theme, submit gọi đúng |
| `src/components/__tests__/StoryViewScreen.test.tsx` | Render title/content, điểm tương tác |

**Lưu ý**: FE hiện gửi field nào thì test bảo vệ đúng contract FE↔BE hiện có — không đổi contract FE.

### 4.8 E2E script (mới) — `scripts/e2e.mjs`

```
Phase 1: spawn Engine (subprocess)
  env: ENGINE_PORT=8001, CUSTOM_LLM_URL=http://localhost:20128/v1/chat/completions, CUSTOM_LLM_MODEL=open-code
  chờ /health OK (poll, timeout 30s)
Phase 2: spawn BE (subprocess)
  env: PORT=3001, ENGINE_URL=http://localhost:8001, CORE_DB_PATH/LOCAL_DB_PATH=temp
  chờ readiness: POST /tenant/init trả 201 (BE NestJS không có route /api/health;
  endpoint /api/health là của FE server.ts port 3000 — không dùng) (poll, timeout 30s)
Phase 3: test flows (node:assert)
  Flow 1 (happy path): tenant init → child-profile → story/create → story/:id → feedback
  Flow 2 (error path): story/create thiếu field → 422 + error code
  Flow 3 (tenant isolation): tenant A vs tenant B story không trộn
Phase 4: cleanup — kill subprocess, xóa DB temp
```

- Trước khi chạy: kiểm tra proxy reachable, nếu không exit với thông báo rõ.
- In PASS/FAIL từng flow, exit code 0/1.
- Không cần deps ngoài (Node built-in `fetch`, `assert`, `child_process`).

---

## 5. Lệnh chạy

```bash
# BE
cd BE && npm test -- --ci
# Engine
cd Engine && python -m pytest tests/ -v
# FE (mới)
cd FE && npm test
# E2E (mới)
node scripts/e2e.mjs
```

---

## 6. Quy trình TDD khi implement

Mỗi hạng mục theo vòng đỏ → xanh → refactor:

| # | Hạng mục | Test trước (đỏ) | Code sau (xanh) |
|---|---|---|---|
| 1 | Fix 3 suite BE | chạy jest thấy fail | cài supertest, sửa datasource.spec |
| 2 | Mapping camelCase→snake_case | viết contract test assert payload snake_case (đỏ) | thêm `toEnginePayload` (xanh) |
| 3 | BE integration | viết `story.flow.spec.ts` | chạy với Engine thật |
| 4 | Engine real-LLM test | viết `test_engine_real_llm.py` | chạy với proxy |
| 5 | FE infra + test | viết FE test (đỏ) | cài vitest, viết component |
| 6 | E2E script | script tự spawn & assert | chạy full |

---

## 7. Ngoài scope

- Không refactor FE lên strict TS (chỉ thêm `vite-env.d.ts` để hết lỗi lint).
- Không sửa FE để đổi contract FE↔BE hiện có.
- Không thêm Playwright/Cypress.
- Không đổi schema Engine (`GenerateRequest` vẫn snake_case).

---

## 8. Rủi ro & xử lý

| Rủi ro | Xử lý |
|---|---|
| LLM proxy không ổn định (timeout/429) | Test real-LLM skip khi không reachable; pipeline có fallback path |
| Story tạo ra bằng LLM thật không đạt chuẩn validator | Test không assert nội dung cụ thể, chỉ assert schema; fallback vẫn là kết quả hợp lệ |
| Port test xung đột | E2E dùng port riêng (8001/3001) + DB temp, cleanup sau khi chạy |
