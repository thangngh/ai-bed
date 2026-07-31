# Full-Stack Integration TDD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build full integration test coverage across BE → FE → Engine (fix failing BE tests, fix BE→Engine camelCase/snake_case contract, add BE/Engine integration tests with real LLM via proxy, add FE Vitest+RTL infrastructure, and a standalone E2E script that spawns Engine + BE).

**Architecture:** Contract-first, task-by-task (red → green → refactor). Fix BE foundation first, then fix the BE→Engine payload contract, then add integration tests at each boundary (BE↔Engine real, Engine↔LLM real via proxy at `http://localhost:20128`, FE↔BE via Vitest+RTL), and finally a standalone E2E script that spawns real services and tests the full HTTP flow.

**Tech Stack:** NestJS 11 + Jest 29 + supertest (BE), Python FastAPI + pytest (Engine), React 19 + Vite + Vitest + React Testing Library (FE), Node built-in `fetch`/`child_process` (E2E script).

## Global Constraints

- LLM proxy endpoint: `http://localhost:20128/v1/chat/completions`, model `open-code` (deepseek-v4-flash). Verified working; other models are unreliable.
- Engine `GenerateRequest` schema is snake_case and MUST NOT change: `child_name`, `recent_stories`, `favorite_character`, etc.
- FE→BE contract (snake_case body from FE, e.g. `child_name`, `favorite_character`) MUST NOT change.
- Engine `GenerateResponse` is snake_case; BE maps to camelCase internally (`requestId`, `llmCalls`, `latencyMs`, `wordCount`, `isFallback`).
- Do NOT refactor FE to strict TS. Only add `FE/src/vite-env.d.ts` to fix `import.meta.env` lint error.
- Do NOT add Playwright/Cypress.
- Every task ends with running the relevant test command and a commit.

---

### Task 1: Fix BE test foundation

**Files:**
- Modify: `BE/package.json` (via `npm install`)
- Modify: `BE/src/common/pipes/validation.pipe.ts` (throw 422 instead of 400 — user-approved contract fix)
- Create: `BE/src/common/__tests__/test-db.ts` (shared in-memory dual-DataSource helper — user-approved extraction)
- Modify: `BE/src/common/__tests__/datasource.spec.ts`
- Modify: `BE/src/modules/tenant/__tests__/tenant.controller.spec.ts`
- Modify: `BE/src/modules/story/__tests__/story.integration.spec.ts`

**Interfaces:**
- Consumes: existing `AppModule`, `TenantModule`, `EngineGatewayService` (already in codebase).
- Produces: all 15 BE suites passing. The pattern for in-memory dual SQLite DataSource override (reused in Task 3).

- [ ] **Step 1: Install missing supertest devDependency**

`supertest` and `@types/supertest` are declared in `BE/package.json` but absent from `node_modules`.

Run: `npm install supertest @types/supertest --save-dev` in `BE/`.
Expected: install completes; `node_modules/supertest` exists.

- [ ] **Step 2: Run full jest to capture current failures**

Run: `npm test -- --ci` in `BE/`.
Expected: 3 suites fail — `tenant.controller.spec.ts` (module supertest not found / DI resolve error), `story.integration.spec.ts` (same), `datasource.spec.ts` (Nest could not find DataSource element during shutdown).

- [ ] **Step 3: Create shared in-memory dual-DataSource test helper**

`TypeOrmModule.forRootAsync({ name })` drops the `name` field from resolved options (`@nestjs/typeorm` `createAsyncOptionsProvider`), so `module.close()`/`app.close()` cannot find the named datasource on shutdown and always throw. The verified working teardown is **manual `destroy()` of both DataSources** in `afterAll`. `Test.createTestingModule` + `overrideProvider(getDataSourceToken('core'|'local'))` + `.useFactory` compiles fine; the bug is only in the teardown. Extract this pattern into a shared helper reused by every integration spec:

Create `BE/src/common/__tests__/test-db.ts` (NOT matched by jest testRegex `.*\.spec\.ts$`):

```ts
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../../modules/child/entities/child-profile.entity';
import { Feedback } from '../../modules/feedback/entities/feedback.entity';
import { Story } from '../../modules/story/entities/story.entity';
import { StorySection } from '../../modules/story/entities/story-section.entity';
import { MemoryItem } from '../../modules/memory/entities/memory-item.entity';

export function makeDataSource(entities: any[]): DataSource {
  return new DataSource({
    type: 'sqlite' as const,
    database: ':memory:',
    entities,
    synchronize: true,
  });
}

export async function openTestDataSources() {
  const core = makeDataSource([Tenant, ChildProfile, Feedback]);
  const local = makeDataSource([Story, StorySection, MemoryItem]);
  await core.initialize();
  await local.initialize();
  return { core, local };
}

export async function closeTestDataSources(core: DataSource, local: DataSource) {
  await core.destroy();
  await local.destroy();
}

export const CORE_TOKEN = getDataSourceToken('core');
export const LOCAL_TOKEN = getDataSourceToken('local');
```

- [ ] **Step 4: Fix `datasource.spec.ts` using the helper**

Write `BE/src/common/__tests__/datasource.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import {
  CORE_TOKEN,
  LOCAL_TOKEN,
  openTestDataSources,
  closeTestDataSources,
} from './test-db';
import { DataSource } from 'typeorm';

describe('DualDataSource', () => {
  let module: TestingModule;

  beforeAll(async () => {
    const ds = await openTestDataSources();
    module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CORE_TOKEN)
      .useValue(ds.core)
      .overrideProvider(LOCAL_TOKEN)
      .useValue(ds.local)
      .compile();
  });

  it('should have core datasource', () => {
    const ds: DataSource = module.get(CORE_TOKEN);
    expect(ds).toBeDefined();
    expect(ds.isInitialized).toBe(true);
  });

  it('should have local datasource', () => {
    const ds: DataSource = module.get(LOCAL_TOKEN);
    expect(ds).toBeDefined();
    expect(ds.isInitialized).toBe(true);
  });

  afterAll(async () => {
    await closeTestDataSources(module.get(CORE_TOKEN), module.get(LOCAL_TOKEN));
  });
});
```

- [ ] **Step 5: Verify `datasource.spec.ts` passes**

Run: `npx jest src/common/__tests__/datasource.spec.ts --ci`
Expected: PASS (2 tests).

- [ ] **Step 6: Fix `tenant.controller.spec.ts`**

The suite failed at DI compile time: `TenantModule` imports no `TypeOrmModule`, so the `coreDataSource` provider doesn't exist in the test tree and `overrideProvider` is a silent no-op (it only merges with an existing provider). The verified fix mirrors the real app, where `TypeOrmCoreModule` is `@Global()`: a `@Global()` test module exporting the `core` token.

```ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Module, Global } from '@nestjs/common';
import { TenantModule } from '../tenant.module';
import { CORE_TOKEN, makeDataSource } from '../../../common/__tests__/test-db';
import { DataSource } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';

@Global()
@Module({
  providers: [
    {
      provide: CORE_TOKEN,
      useFactory: async () => {
        const ds = makeDataSource([Tenant]);
        await ds.initialize();
        return ds;
      },
    },
  ],
  exports: [CORE_TOKEN],
})
class TestCoreDataSourceModule {}

describe('TenantController', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TenantModule, TestCoreDataSourceModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
    dataSource = module.get(CORE_TOKEN);
  });

  afterAll(async () => {
    await app.close();
    await dataSource.destroy();
  });

  it('POST /tenant/init should return a tenant_id', async () => {
    const res = await request(app.getHttpServer())
      .post('/tenant/init')
      .expect(201);

    expect(res.body.tenant_id).toBeDefined();
    expect(res.body.tenant_id.length).toBe(36);
    expect(res.body.message).toBe('Tenant initialized');
  });
});
```

Run: `npx jest src/modules/tenant/__tests__/tenant.controller.spec.ts --ci`
Expected: PASS (1 test).

- [ ] **Step 7: Fix `validation.pipe.ts` to return 422 (user-approved contract fix)**

The approved design mandates 422 for validation errors, but the custom pipe throws `BadRequestException` (400). Change it to `UnprocessableEntityException` (422), keeping the same error body shape:

Edit `BE/src/common/pipes/validation.pipe.ts`: import `UnprocessableEntityException` instead of `BadRequestException` and throw `new UnprocessableEntityException({ error: { code: 'VALIDATION_ERROR', ... } })`.

- [ ] **Step 8: Fix `story.integration.spec.ts` expectations + mock Engine**

The current file has 3 bugs:
1. Test "without X-Tenant-Id returns 401" — WRONG: `TenantMiddleware` auto-creates a tenant when header is missing, so it returns **201**.
2. Test uses `test-integration-uuid` as tenant — NOT a valid UUID → middleware returns 400 `INVALID_TENANT`.
3. Story creation calls the real Engine (`localhost:8000`, not running) → 502.

Also: the test app has no global `ValidationPipe` (it's registered in `main.ts`, not `AppModule`), so the test app needs `app.useGlobalPipes(new ValidationPipe())` for validation to run. And the invalid-age expectation is **422** (after Step 7's pipe change), matching the design contract.

Rewrite `BE/src/modules/story/__tests__/story.integration.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { EngineGatewayService } from '../../engine-gateway/engine-gateway.service';
import {
  CORE_TOKEN,
  LOCAL_TOKEN,
  openTestDataSources,
  closeTestDataSources,
} from '../../../common/__tests__/test-db';

const VALID_TENANT = '12345678-1234-4123-8123-123456789abc';

describe('Story Module (integration)', () => {
  let app: INestApplication;
  let module: TestingModule;
  let core: DataSource;
  let local: DataSource;

  beforeAll(async () => {
    const ds = await openTestDataSources();
    core = ds.core;
    local = ds.local;
    module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CORE_TOKEN)
      .useValue(core)
      .overrideProvider(LOCAL_TOKEN)
      .useValue(local)
      .overrideProvider(EngineGatewayService)
      .useValue({
        generate: jest.fn().mockResolvedValue({
          requestId: 'req-1',
          title: 'Chú thỏ dũng cảm',
          content: [
            { type: 'opening', text: 'Ngày xửa ngày xưa...', order: 1 },
            { type: 'interaction', text: 'Bé nghĩ sao?', order: 2 },
          ],
          safetyStatus: 'APPROVED',
          memories: [],
          llmCalls: 3,
          retryCount: 0,
          latencyMs: 50,
          wordCount: 120,
          isFallback: false,
        }),
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDataSources(core, local);
  });

  it('POST /story/create without X-Tenant-Id auto-creates tenant and returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/story/create')
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(201);
    expect(res.headers['x-tenant-id']).toBeDefined();
    expect(res.body.title).toBe('Chú thỏ dũng cảm');
  });

  it('POST /story/create with valid tenant returns 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', VALID_TENANT)
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(201);
    expect(res.body.story_id).toBeDefined();
    expect(res.body.safety_status).toBe('APPROVED');
  });

  it('POST /story/create with invalid tenant returns 400 INVALID_TENANT', async () => {
    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', 'not-a-uuid')
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_TENANT');
  });

  it('POST /story/create with invalid age returns 422 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', VALID_TENANT)
      .send({ child_name: 'An', age: 10, theme: 'Động vật' })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
```

> **Note:** do NOT use `module.close()`/`app.close()` as the sole teardown — it throws for named `forRootAsync` datasources. Manual `destroy()` of both DataSources is required. `app.close()` before the destroys is fine and runs other shutdown hooks.

- [ ] **Step 8b: Fix `http-exception.filter.ts` to unwrap object-bodied errors (user-approved contract fix)**

The filter sets `body.error = res` where `res` for object-bodied exceptions is already `{ error: { code, ... } }`, producing `{ error: { error: { code } } }` in production. FE reads `err.error.code` (`FE/src/utils/api.ts:38`), so this must be `{ error: { code, ... } }`. Fix `BE/src/common/filters/http-exception.filter.ts`:

```ts
if (exception instanceof HttpException) {
  status = exception.getStatus();
  const res = exception.getResponse();
  body.error =
    typeof res === 'string'
      ? { code: 'HTTP_ERROR', message: res }
      : (res as any).error ?? (res as any);
  body.request_id = (request as any).requestId || uuidv4();
}
```

This unwraps `{ error: { code } }` object bodies while keeping string exceptions and non-error-shaped objects intact. Verify `BE/src/common/__tests__/http-exception.filter.spec.ts` still passes (it asserts the `{ error: { code } }` shape directly — check its fixture shape and adjust only if it asserts the double-nested shape).

- [ ] **Step 9: Run the full BE suite**

Run: `npm test -- --ci` in `BE/`.
Expected: 15 suites pass, 0 failures. (Count may be 15 suites / 56+ tests.)

- [ ] **Step 10: Commit**

```bash
git add BE/package.json BE/package-lock.json BE/src/common/pipes/validation.pipe.ts BE/src/common/filters/http-exception.filter.ts BE/src/common/middleware/tenant.middleware.ts BE/src/common/__tests__/test-db.ts BE/src/common/__tests__/datasource.spec.ts BE/src/modules/tenant/__tests__/tenant.controller.spec.ts BE/src/modules/story/__tests__/story.integration.spec.ts
git commit -m "test(be): fix failing test suites, add story integration tests, return 422 on validation"
```

---

### Task 2: Fix BE→Engine contract (camelCase → snake_case) + contract tests

**Files:**
- Modify: `BE/src/modules/engine-gateway/engine-gateway.service.ts`
- Create: `BE/src/modules/engine-gateway/__tests__/engine-gateway.service.spec.ts`

**Interfaces:**
- Consumes: `GenerateDto` (camelCase fields: `childName`, `age`, `theme`, `goal`, `mood`, `language`, `memories`, `recentStories`, `tenantId`, `gender`, `favoriteCharacter`), `EngineResponse` (camelCase).
- Produces: private `toEnginePayload(dto: GenerateDto): Record<string, unknown>` returning snake_case body matching Engine `GenerateRequest`. `generate(dto)` now sends this mapped body.

- [ ] **Step 1: Write the failing contract test**

Create `BE/src/modules/engine-gateway/__tests__/engine-gateway.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { EngineGatewayService } from '../engine-gateway.service';
import { GenerateDto } from '../dto/generate-story.dto';

describe('EngineGatewayService contract', () => {
  let service: EngineGatewayService;
  let fetchMock: jest.Mock;

  const dto: GenerateDto = {
    childName: 'An',
    age: 4,
    theme: 'Động vật',
    goal: 'Dũng cảm',
    mood: 'vui vẻ',
    language: 'vi',
    memories: [{ type: 'interest', key: 'animal', value: 'mèo', confidence: 0.8 }],
    recentStories: [{ title: 'Cũ', theme: 'Khác' }],
    tenantId: '12345678-1234-4123-8123-123456789abc',
    gender: 'girl',
    favoriteCharacter: 'Mèo',
  };

  const engineResponse = {
    request_id: 'req-1',
    title: 'Chú thỏ',
    content: [{ type: 'opening', text: 'Xưa...', order: 1 }],
    safety_status: 'APPROVED',
    memories: [],
    llm_calls: 3,
    latency_ms: 120,
    word_count: 150,
    is_fallback: false,
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EngineGatewayService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def: unknown) =>
              key === 'engine.baseUrl'
                ? 'http://engine:8000'
                : key === 'engine.timeoutMs'
                  ? 25000
                  : def,
          },
        },
      ],
    }).compile();
    service = moduleRef.get(EngineGatewayService);
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends snake_case payload to Engine', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => engineResponse });

    await service.generate(dto);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://engine:8000/generate');
    expect(init.headers['X-Tenant-Id']).toBe(dto.tenantId);
    const body = JSON.parse(init.body);
    expect(body.child_name).toBe('An');
    expect(body.recent_stories).toEqual([{ title: 'Cũ', theme: 'Khác' }]);
    expect(body.favorite_character).toBe('Mèo');
    expect(body.tenantId).toBeUndefined();
    expect(body.childName).toBeUndefined();
    expect(body.recentStories).toBeUndefined();
  });

  it('maps snake_case response to camelCase', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => engineResponse });

    const result = await service.generate(dto);

    expect(result.requestId).toBe('req-1');
    expect(result.safetyStatus).toBe('APPROVED');
    expect(result.llmCalls).toBe(3);
    expect(result.latencyMs).toBe(120);
    expect(result.wordCount).toBe(150);
    expect(result.isFallback).toBe(false);
  });

  it('throws ENGINE_ERROR with engine status on non-2xx', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: 'VALIDATION_ERROR', message: 'Missing required fields' } }),
    });

    await expect(service.generate(dto)).rejects.toMatchObject({
      status: 422,
      response: { error: { code: 'ENGINE_ERROR' } },
    });
  });

  it('throws ENGINE_TIMEOUT on AbortError', async () => {
    const abortErr: any = new Error('aborted');
    abortErr.name = 'AbortError';
    fetchMock.mockRejectedValue(abortErr);

    await expect(service.generate(dto)).rejects.toMatchObject({
      status: 502,
      response: { error: { code: 'ENGINE_TIMEOUT' } },
    });
  });

  it('throws ENGINE_UNAVAILABLE on ECONNREFUSED', async () => {
    const netErr: any = new Error('connect ECONNREFUSED');
    netErr.code = 'ECONNREFUSED';
    fetchMock.mockRejectedValue(netErr);

    await expect(service.generate(dto)).rejects.toMatchObject({
      status: 502,
      response: { error: { code: 'ENGINE_UNAVAILABLE' } },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/engine-gateway/__tests__/engine-gateway.service.spec.ts --ci`
Expected: FAIL — payload test asserts `child_name` but service sends `childName`.

- [ ] **Step 3: Implement `toEnginePayload` mapping**

Edit `BE/src/modules/engine-gateway/engine-gateway.service.ts`. Add a private method and use it in `generate`:

```ts
private toEnginePayload(dto: GenerateDto): Record<string, unknown> {
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

In `generate()`, replace `body: JSON.stringify(dto)` with `body: JSON.stringify(this.toEnginePayload(dto))`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/engine-gateway/__tests__/engine-gateway.service.spec.ts --ci`
Expected: PASS (5 tests).

- [ ] **Step 5: Run full BE suite to confirm no regressions**

Run: `npm test -- --ci` in `BE/`.
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add BE/src/modules/engine-gateway/engine-gateway.service.ts BE/src/modules/engine-gateway/__tests__/engine-gateway.service.spec.ts
git commit -m "fix(be): map camelCase payload to snake_case when calling Engine"
```

---

### Task 3: BE integration test with real Engine

**Files:**
- Create: `BE/src/modules/story/__tests__/story.flow.spec.ts`
- Modify: `BE/src/modules/engine-gateway/engine-gateway.service.ts` (ECONNREFUSED detection via err.cause.code — user-approved F1 fix)
- Modify: `BE/src/modules/engine-gateway/engine.config.ts` + `BE/src/config/engine.config.ts` (default timeout 25s → 120s — user-approved F3 fix)

**Interfaces:**
- Consumes: `AppModule`, `EngineGatewayService` (real, now sending snake_case), running Engine on port from env.
- Produces: `story.flow.spec.ts` — integration suite skipped unless `E2E=1`. Validates `POST /story/create`, `GET /story/:id`, tenant isolation, Engine-down → 502.

- [ ] **Step 1: Verify jest testRegex will not run the new file as a standalone suite**

`BE/package.json` jest config: `"testRegex": ".*\\.spec\\.ts$"` — so `story.flow.spec.ts` is matched and will run (or skip) as a suite. Good. No extra config needed.

- [ ] **Step 2: Write the failing integration test**

Create `BE/src/modules/story/__tests__/story.flow.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import {
  CORE_TOKEN,
  LOCAL_TOKEN,
  openTestDataSources,
  closeTestDataSources,
} from '../../../common/__tests__/test-db';

// Only runs when E2E=1 (Engine must be running on ENGINE_URL)
const describeE2E = process.env.E2E === '1' ? describe : describe.skip;

describeE2E('Story flow with real Engine', () => {
  let app: INestApplication;
  let module: TestingModule;
  let core: any;
  let local: any;

  async function buildApp(engineUrl: string) {
    process.env.ENGINE_URL = engineUrl;
    const ds = await openTestDataSources();
    core = ds.core;
    local = ds.local;
    module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CORE_TOKEN)
      .useValue(core)
      .overrideProvider(LOCAL_TOKEN)
      .useValue(local)
      .compile();
    app = module.createNestApplication();
    await app.init();
  }

  beforeAll(async () => {
    await buildApp(process.env.ENGINE_URL || 'http://localhost:8001');
  });

  afterAll(async () => {
    await closeTestDataSources(core, local);
  });

  it('POST /story/create returns 201 with story from real Engine', async () => {
    const init = await request(app.getHttpServer()).post('/tenant/init').expect(201);
    const tenantId = init.body.tenant_id;

    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', tenantId)
      .send({ child_name: 'An', age: 4, theme: 'Động vật', goal: 'Dũng cảm', mood: 'vui vẻ' })
      .expect(201);

    expect(res.body.story_id).toBeDefined();
    expect(res.body.title).toBeTruthy();
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(res.body.word_count).toBeGreaterThan(0);
  }, 60000);

  it('GET /story/:id returns saved story for the tenant', async () => {
    const init = await request(app.getHttpServer()).post('/tenant/init').expect(201);
    const tenantId = init.body.tenant_id;

    const created = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', tenantId)
      .send({ child_name: 'Bình', age: 5, theme: 'Khủng long' })
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/story/${created.body.story_id}`)
      .set('X-Tenant-Id', tenantId)
      .expect(200);
    expect(detail.body.title).toBe(created.body.title);
  }, 60000);

  it('keeps stories isolated between tenants', async () => {
    const t1 = (await request(app.getHttpServer()).post('/tenant/init').expect(201)).body.tenant_id;
    const t2 = (await request(app.getHttpServer()).post('/tenant/init').expect(201)).body.tenant_id;

    await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', t1)
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(201);

    const other = await request(app.getHttpServer())
      .get('/story/latest')
      .set('X-Tenant-Id', t2)
      .expect(200);
    expect(other.body.stories).toHaveLength(0);
  }, 60000);

  it('returns 502 ENGINE_UNAVAILABLE when Engine is down', async () => {
    await closeTestDataSources(core, local);

    const saveUrl = process.env.ENGINE_URL;
    await buildApp('http://localhost:65534');

    const init = await request(app.getHttpServer()).post('/tenant/init').expect(201);
    const tenantId = init.body.tenant_id;

    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', tenantId)
      .send({ child_name: 'An', age: 4, theme: 'Động vật' })
      .expect(502);
    expect(res.body.error.code).toBe('ENGINE_UNAVAILABLE');

    process.env.ENGINE_URL = saveUrl;
  }, 30000);
});
```

> **IMPORTANT implementation note:** `engine.config.ts` reads `engine.baseUrl` via `ConfigService` at construction; the `buildApp()` helper sets `process.env.ENGINE_URL` before compiling the module so the real Engine URL is picked up. The "Engine down" test rebuilds the app with a dead high port (65534 — port 9 is a Fetch-spec forbidden port) — restore the env var afterwards. Reuse the shared `test-db.ts` helpers (open/close) and manual `destroy()` teardown — never `module.close()` (named forRootAsync datasources throw).

- [ ] **Step 2b: Fix ECONNREFUSED detection (user-approved F1)**

`engine-gateway.service.ts:57` checks `err.code === 'ECONNREFUSED'`, but Node's global `fetch` (undici) throws `TypeError: fetch failed` with the underlying code at `err.cause.code`, so a genuinely dead Engine surfaces as `ENGINE_ERROR` instead of `ENGINE_UNAVAILABLE`. Fix:

```ts
if ((err.cause?.code === 'ECONNREFUSED') || (err.code === 'ECONNREFUSED')) {
  throw new HttpException(
    { error: { code: 'ENGINE_UNAVAILABLE', message: 'Engine not available' } },
    502,
  );
}
```

Keep the `err.code` check for mocked errors in the Task 2 contract test (which sets `err.code` directly).

- [ ] **Step 2c: Raise default Engine timeout (user-approved F3)**

The real pipeline takes 37-43s (fallback slower), but the default `ENGINE_TIMEOUT_MS` is 25000ms — production story creation would fail with `ENGINE_TIMEOUT`. In both `BE/src/modules/engine-gateway/engine.config.ts` and `BE/src/config/engine.config.ts`, change the default to `120000`. In `engine-gateway.service.ts:53`, fix the stale message "Engine timeout after 15s" → "Engine timeout after 120s".

- [ ] **Step 3: Start a real Engine on a test port**

Run from `Engine/`:
```powershell
$env:ENGINE_PORT="8001"
$env:CUSTOM_LLM_URL="http://localhost:20128/v1/chat/completions"
$env:CUSTOM_LLM_MODEL="open-code"
$env:CUSTOM_LLM_API_KEY=""
$env:OPENAI_API_KEYS=""
$env:GEMINI_API_KEY=""
python main.py
```
Expected: Engine logs startup on `http://0.0.0.0:8001`; `GET http://localhost:8001/health` returns `{"status":"ok"}`.

- [ ] **Step 4: Run the flow spec against the real Engine**

In a second shell, from `BE/`:
```powershell
$env:E2E="1"
$env:ENGINE_URL="http://localhost:8001"
npx jest src/modules/story/__tests__/story.flow.spec.ts --ci --runInBand
```
Expected: all 4 tests PASS (may take 30-90s per story due to real LLM pipeline; fallback story also counts as valid). The default timeout is now 120s after Step 2c.

- [ ] **Step 5: Confirm the spec is skipped when E2E is not set**

Run: `npx jest src/modules/story/__tests__/story.flow.spec.ts --ci` (no E2E env).
Expected: suite skipped (0 tests executed).

- [ ] **Step 6: Stop the test Engine process**

Kill the `python main.py` process started in Step 3.

- [ ] **Step 7: Commit**

```bash
git add BE/src/modules/story/__tests__/story.flow.spec.ts BE/src/modules/engine-gateway/engine-gateway.service.ts BE/src/modules/engine-gateway/engine.config.ts BE/src/config/engine.config.ts
git commit -m "test(be): add story flow integration tests against real Engine, fix engine error/timeout defaults"
```

---

### Task 4: Engine integration test with real LLM via proxy

**Files:**
- Create: `Engine/tests/test_engine_real_llm.py`

**Interfaces:**
- Consumes: `StoryOrchestrator.generate(data: dict)`, `main.app` (FastAPI), `GenerateRequest`/`GenerateResponse`.
- Produces: pytest suite that builds a fresh `StoryOrchestrator` with env pointing at the proxy; skipped automatically when the proxy is unreachable.

- [ ] **Step 1: Write the failing/skipping test**

Create `Engine/tests/test_engine_real_llm.py`:

```python
import os
import pytest
from httpx import AsyncClient, ASGITransport

from main import app
from core.orchestrator import StoryOrchestrator

PROXY_URL = os.getenv("E2E_LLM_URL", "http://localhost:20128/v1/chat/completions")
PROXY_MODEL = os.getenv("E2E_LLM_MODEL", "open-code")


def _proxy_available() -> bool:
    import httpx
    base = PROXY_URL.replace("/v1/chat/completions", "")
    try:
        r = httpx.get(f"{base}/v1/models", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _proxy_available(),
    reason="LLM proxy not reachable (start proxy on localhost:20128)",
)


@pytest.fixture(autouse=True)
def _set_llm_env(monkeypatch):
    monkeypatch.setenv("PRIMARY_LLM", "")
    monkeypatch.setenv("FALLBACK_LLM", "")
    monkeypatch.setenv("CUSTOM_LLM_URL", PROXY_URL)
    monkeypatch.setenv("CUSTOM_LLM_MODEL", PROXY_MODEL)
    monkeypatch.setenv("CUSTOM_LLM_API_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEYS", "")
    monkeypatch.setenv("GEMINI_API_KEY", "")


@pytest.mark.asyncio
async def test_orchestrator_pipeline_through_real_proxy():
    """Full planner → writer → reviewer → memory extraction through the real proxy."""
    orch = StoryOrchestrator()
    result = await orch.generate({
        "child_name": "An",
        "age": 4,
        "theme": "Động vật",
        "goal": "Dũng cảm",
        "mood": "vui vẻ",
        "language": "vi",
    })
    assert result["title"]
    assert isinstance(result["content"], list)
    assert len(result["content"]) > 0
    assert result["safety_status"] in ("APPROVED", "FLAGGED", "FALLBACK")
    assert isinstance(result["llm_calls"], int)


@pytest.mark.asyncio
async def test_generate_endpoint_via_proxy():
    """POST /generate returns a valid schema through the real LLM."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/generate", json={
            "child_name": "An",
            "age": 4,
            "theme": "Động vật",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "title" in data
        assert "content" in data
        assert "safety_status" in data
        assert "is_fallback" in data


@pytest.mark.asyncio
async def test_health_still_ok():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"
```

> **IMPORTANT implementation note:** `main.app` and the module-level `orchestrator` in `main.py` are created at import time, BEFORE monkeypatch env applies. `StoryOrchestrator()` in test 1 constructs a fresh instance after monkeypatch, so it picks up the proxy env. `POST /generate` uses the import-time orchestrator — if it falls back (no providers configured), the response is still a valid `GenerateResponse` with `is_fallback: True`, which the test accepts. If you want `POST /generate` to use the real proxy, re-import `main` after monkeypatching (e.g. `import importlib; importlib.reload(main)`) — but the fallback path is also an acceptable assertion. Implement whichever is more stable.

- [ ] **Step 2: Run with proxy available**

Run: `python -m pytest tests/test_engine_real_llm.py -v` in `Engine/`.
Expected: 3 tests PASS (proxy reachable on 20128).

- [ ] **Step 3: Verify skip behavior when proxy is down (optional)**

Stop the proxy if you control it, or temporarily set `E2E_LLM_URL=http://localhost:1`:
Run: `$env:E2E_LLM_URL="http://localhost:1/v1/chat/completions"; python -m pytest tests/test_engine_real_llm.py -v`
Expected: 3 tests SKIPPED with message "LLM proxy not reachable".

- [ ] **Step 4: Run the full Engine suite**

Run: `python -m pytest tests/ -q` in `Engine/`.
Expected: existing 50 + 3 new tests pass (or skip if proxy down).

- [ ] **Step 5: Commit**

```bash
git add Engine/tests/test_engine_real_llm.py
git commit -m "test(engine): add real-LLM integration tests via local proxy"
```

---

### Task 5: FE test infrastructure (Vitest + RTL)

**Files:**
- Modify: `FE/package.json` (add devDeps + scripts)
- Create: `FE/vitest.config.ts`
- Create: `FE/src/test/setup.ts`
- Create: `FE/src/vite-env.d.ts`

**Interfaces:**
- Consumes: existing `vite.config.ts` alias `@` → project root; `FE/tsconfig.json`.
- Produces: `npm test` → `vitest run`; `@` alias resolved; jest-dom matchers loaded; `import.meta.env` typed.

- [ ] **Step 1: Install test dependencies**

Run in `FE/`:
```powershell
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```
Expected: packages added to `package.json` devDependencies.

- [ ] **Step 2: Add test scripts to `FE/package.json`**

Edit `FE/package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `FE/vitest.config.ts`**

```ts
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

- [ ] **Step 4: Create `FE/src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Create `FE/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 6: Verify lint (tsc) passes**

Run: `npm run lint` in `FE/`.
Expected: no output (exit 0), fixing the previous `TS2339: Property 'env' does not exist on type 'ImportMeta'`.

- [ ] **Step 7: Create a trivial smoke test to verify the runner works**

Create `FE/src/test/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test` in `FE/`.
Expected: 1 test PASS.

- [ ] **Step 8: Commit**

```bash
git add FE/package.json FE/package-lock.json FE/vitest.config.ts FE/src/test/setup.ts FE/src/vite-env.d.ts FE/src/test/smoke.test.ts
git commit -m "test(fe): add vitest + react testing library infrastructure"
```

---

### Task 6: FE unit tests — apiClient and storyGenerator

**Files:**
- Create: `FE/src/utils/__tests__/api.test.ts`
- Create: `FE/src/utils/__tests__/storyGenerator.test.ts`

**Interfaces:**
- Consumes: `apiClient<T>(path, options)` from `FE/src/utils/api.ts`; `generateBedtimeStory(input)`, `mapSectionsToSegments(sections)` from `FE/src/utils/storyGenerator.ts`; `StoryFormInput`/`BedtimeStory` from `FE/src/types.ts`.
- Produces: tests locking FE→BE contract (snake_case body, tenant header, error code propagation, section→segment mapping).

- [ ] **Step 1: Write failing apiClient tests**

Create `FE/src/utils/__tests__/api.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';

const VALID_TENANT = '12345678-1234-4123-8123-123456789abc';

describe('apiClient', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bootstraps tenant once and caches it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenant_id: VALID_TENANT }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ children: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await apiClient('/child-profile');
    await apiClient('/child-profile');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/tenant/init');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/child-profile');
    expect(fetchMock.mock.calls[1][1].headers['X-Tenant-Id']).toBe(VALID_TENANT);
  });

  it('reuses stored tenant without calling /tenant/init', async () => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await apiClient('/memory/context/x');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/memory/context/x');
    expect(fetchMock.mock.calls[0][1].headers['X-Tenant-Id']).toBe(VALID_TENANT);
  });

  it('throws error code on non-2xx', async () => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: 'AGE_OUT_OF_RANGE', message: 'Tuổi không hợp lệ' } }),
    }));

    await expect(apiClient('/story/create', { method: 'POST' }))
      .rejects.toThrow('AGE_OUT_OF_RANGE');
  });

  it('throws API_ERROR when response body has no error code', async () => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }));

    await expect(apiClient('/story/create', { method: 'POST' }))
      .rejects.toThrow('API_ERROR');
  });
});
```

- [ ] **Step 2: Run api tests to verify pass**

Run: `npx vitest run src/utils/__tests__/api.test.ts` in `FE/`.
Expected: PASS (4 tests).

- [ ] **Step 3: Write failing storyGenerator tests**

Create `FE/src/utils/__tests__/storyGenerator.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateBedtimeStory, mapSectionsToSegments } from '../storyGenerator';
import { StoryFormInput } from '../../types';

const VALID_TENANT = '12345678-1234-4123-8123-123456789abc';

describe('storyGenerator', () => {
  beforeEach(() => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts snake_case payload to /story/create', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          title: 'Chú thỏ dũng cảm',
          sections: [{ type: 'opening', text: 'Ngày xửa...', order: 1 }],
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const input: StoryFormInput = {
      childName: 'An',
      childAge: 4,
      favoriteTopic: 'Động vật',
      gender: 'girl',
      lesson: 'Dũng cảm',
      mood: 'vui vẻ',
      favoriteCharacter: 'Mèo',
    };
    const story = await generateBedtimeStory(input);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/story/create');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      child_name: 'An',
      age: 4,
      theme: 'Động vật',
      goal: 'Dũng cảm',
      mood: 'vui vẻ',
      language: 'vi',
      gender: 'girl',
      favorite_character: 'Mèo',
    });
    expect(story.title).toBe('Chú thỏ dũng cảm');
    expect(story.segments.opening).toBe('Ngày xửa...');
  });

  it('maps engine sections to story segments', () => {
    const segments = mapSectionsToSegments([
      { type: 'opening', text: 'Mở đầu', order: 1 },
      { type: 'context', text: 'Bối cảnh', order: 2 },
      { type: 'interaction', text: 'Bé nghĩ sao?', order: 3 },
      { type: 'moral', text: 'Bài học', order: 4 },
    ]);
    expect(segments.opening).toBe('Mở đầu');
    expect(segments.situation).toBe('Bối cảnh');
    expect(segments.interaction2).toBe('Bé nghĩ sao?');
    expect(segments.moralSummary).toBe('Bài học');
  });

  it('rethrows errors from the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: 'ENGINE_ERROR', message: 'Engine down' } }),
    }));

    const input: StoryFormInput = { childName: 'An', childAge: 4, favoriteTopic: 'Động vật' };
    await expect(generateBedtimeStory(input)).rejects.toThrow('ENGINE_ERROR');
  });
});
```

- [ ] **Step 4: Run storyGenerator tests**

Run: `npx vitest run src/utils/__tests__/storyGenerator.test.ts` in `FE/`.
Expected: PASS (3 tests). (If `mapSectionsToSegments` behavior differs from expectations, adjust the test to the actual SECTION_MAP — the map currently expects `moral` type → `moralSummary`.)

- [ ] **Step 5: Run full FE suite**

Run: `npm test` in `FE/`.
Expected: smoke + 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add FE/src/utils/__tests__/api.test.ts FE/src/utils/__tests__/storyGenerator.test.ts
git commit -m "test(fe): add api client and story generator tests"
```

---

### Task 7: FE component tests — FormScreen and StoryViewScreen

**Files:**
- Create: `FE/src/components/__tests__/FormScreen.test.tsx`
- Create: `FE/src/components/__tests__/StoryViewScreen.test.tsx`

**Interfaces:**
- Consumes: `FormScreen` props `{ onSubmit, onBack, isNightMode, activeChild? }`; `StoryViewScreen` props `{ story, onReadAgain, onCreateNew, onGoToFeedback, onSaveStory, isSaved, isNightMode }`; `BedtimeStory` type; `memoryClient` (mocked).
- Produces: component tests for form validation + submit payload, and story rendering + interaction points + save.

- [ ] **Step 1: Write failing FormScreen tests**

Create `FE/src/components/__tests__/FormScreen.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormScreen } from '../FormScreen';
import { StoryFormInput } from '../../types';

vi.mock('../../utils/memoryClient', () => ({
  memoryClient: {
    getContext: vi.fn().mockResolvedValue({
      interests: [], preferences: [], recentThemes: [], behaviors: [],
    }),
  },
}));

const renderForm = (onSubmit = vi.fn()) =>
  render(<FormScreen onSubmit={onSubmit} onBack={vi.fn()} isNightMode={false} />);

describe('FormScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows error when child name is empty', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));
    expect(await screen.findByText(/vui lòng nhập tên của bé/i)).toBeInTheDocument();
  });

  it('submits valid form with defaults', async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    fireEvent.change(screen.getByLabelText(/tên của bé/i), { target: { value: 'An' } });
    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload: StoryFormInput = onSubmit.mock.calls[0][0];
    expect(payload.childName).toBe('An');
    expect(payload.childAge).toBe(4);
    expect(payload.favoriteTopic).toBe('Động vật');
  });

  it('uses custom topic when provided', async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    fireEvent.change(screen.getByLabelText(/tên của bé/i), { target: { value: 'An' } });
    fireEvent.change(screen.getByPlaceholderText(/nhập chủ đề khác/i), { target: { value: 'Tàu hỏa' } });
    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].favoriteTopic).toBe('Tàu hỏa');
  });
});
```

- [ ] **Step 2: Run FormScreen tests**

Run: `npx vitest run src/components/__tests__/FormScreen.test.tsx` in `FE/`.
Expected: PASS (3 tests). If label query fails, use `getByPlaceholderText(/nhập tên bé/i)` instead of `getByLabelText`.

- [ ] **Step 3: Write failing StoryViewScreen tests**

Create `FE/src/components/__tests__/StoryViewScreen.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StoryViewScreen } from '../StoryViewScreen';
import { BedtimeStory } from '../../types';

const story: BedtimeStory = {
  id: 'story-1',
  title: 'Chú thỏ dũng cảm',
  childName: 'An',
  childAge: 4,
  topic: 'Động vật',
  segments: {
    opening: 'Ngày xửa ngày xưa, có một chú thỏ nhỏ.',
    situation: 'Chú thỏ sống trong khu rừng.',
    interaction1: 'Bé ơi, chú thỏ nên làm gì?',
    challenge: 'Chú thỏ gặp một con sông lớn.',
    interaction2: 'Bé thử đoán xem?',
    ending: 'Chú thỏ đã vượt qua.',
    interaction3: 'Chú thỏ vui vẻ trở về.',
    moralSummary: 'Dũng cảm sẽ giúp con vượt qua khó khăn.',
  },
  createdAt: new Date().toISOString(),
};

describe('StoryViewScreen', () => {
  it('renders title, child name and moral summary', () => {
    render(
      <StoryViewScreen
        story={story}
        onReadAgain={vi.fn()}
        onCreateNew={vi.fn()}
        onGoToFeedback={vi.fn()}
        onSaveStory={vi.fn()}
        isSaved={false}
        isNightMode={false}
      />,
    );
    expect(screen.getByText('Chú thỏ dũng cảm')).toBeInTheDocument();
    expect(screen.getByText(/Dành cho bé An/i)).toBeInTheDocument();
    expect(screen.getByText(/Dũng cảm sẽ giúp con vượt qua khó khăn/i)).toBeInTheDocument();
  });

  it('calls onSaveStory when save button is clicked', () => {
    const onSaveStory = vi.fn();
    render(
      <StoryViewScreen
        story={story}
        onReadAgain={vi.fn()}
        onCreateNew={vi.fn()}
        onGoToFeedback={vi.fn()}
        onSaveStory={onSaveStory}
        isSaved={false}
        isNightMode={false}
      />,
    );
    const saveBtn = screen.getByTitle(/lưu/i) || screen.getByRole('button', { name: /lưu/i });
    fireEvent.click(saveBtn);
    expect(onSaveStory).toHaveBeenCalledWith(story);
  });

  it('calls onGoToFeedback when feedback button is clicked', () => {
    const onGoToFeedback = vi.fn();
    render(
      <StoryViewScreen
        story={story}
        onReadAgain={vi.fn()}
        onCreateNew={vi.fn()}
        onGoToFeedback={onGoToFeedback}
        onSaveStory={vi.fn()}
        isSaved={false}
        isNightMode={false}
      />,
    );
    const fbBtn = screen.getByRole('button', { name: /đánh giá|feedback|góp ý/i });
    fireEvent.click(fbBtn);
    expect(onGoToFeedback).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run StoryViewScreen tests**

Run: `npx vitest run src/components/__tests__/StoryViewScreen.test.tsx` in `FE/`.
Expected: PASS (3 tests). Read `FE/src/components/StoryViewScreen.tsx` (lines 120-359) to confirm exact button text/labels for save and feedback buttons and adjust selectors if needed.

- [ ] **Step 5: Run full FE suite + lint**

Run: `npm test` and `npm run lint` in `FE/`.
Expected: all tests PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add FE/src/components/__tests__/FormScreen.test.tsx FE/src/components/__tests__/StoryViewScreen.test.tsx
git commit -m "test(fe): add form and story view component tests"
```

---

### Task 8: Standalone E2E script

**Files:**
- Create: `scripts/e2e.mjs`

**Interfaces:**
- Consumes: Engine `main.py` (port from env, default 8001), BE `npm run start` → `dist/main.js` (port from env, default 3001), LLM proxy `http://localhost:20128`.
- Produces: `node scripts/e2e.mjs` — spawns Engine + BE, runs happy-path / error-path / tenant-isolation flows against the real stack, prints PASS/FAIL per flow, exits 0/1, cleans up temp DBs and processes.

- [ ] **Step 1: Write the E2E script**

Create `scripts/e2e.mjs`:

```js
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PROXY_BASE = process.env.E2E_PROXY || 'http://localhost:20128';
const ENGINE_PORT = process.env.E2E_ENGINE_PORT || '8001';
const BE_PORT = process.env.E2E_BE_PORT || '3001';
const ENGINE_URL = `http://localhost:${ENGINE_PORT}`;
const BE_URL = `http://localhost:${BE_PORT}`;

const children = [];
let tempDir;

function log(msg) {
  console.log(`[e2e] ${msg}`);
}

function spawnService(name, command, args, env = {}) {
  log(`spawning ${name}: ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', d => {
    if (process.env.E2E_VERBOSE) process.stdout.write(`[${name}] ${d}`);
  });
  child.stderr.on('data', d => {
    if (process.env.E2E_VERBOSE) process.stderr.write(`[${name}] ${d}`);
  });
  return child;
}

async function waitFor(fn, timeoutMs, what) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await fn()) return;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting for ${what}`);
}

async function proxyReachable() {
  try {
    const res = await fetch(`${PROXY_BASE}/v1/models`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

function cleanup() {
  for (const child of children) {
    try { child.kill(); } catch {}
  }
  if (tempDir) {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

async function api(path, { method = 'GET', tenant, body, timeoutMs = 30000 } = {}) {
  const headers = {};
  if (tenant) headers['X-Tenant-Id'] = tenant;
  const res = await fetch(`${BE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, headers: res.headers, data };
}

async function main() {
  log(`checking LLM proxy at ${PROXY_BASE}`);
  assert.ok(await proxyReachable(), `LLM proxy not reachable at ${PROXY_BASE} — start it first`);

  const distMain = join(ROOT, 'BE', 'dist', 'main.js');
  assert.ok(existsSync(distMain), `BE not built (missing ${distMain}). Run: cd BE && npm run build`);

  tempDir = mkdtempSync(join(tmpdir(), 'bsc-e2e-'));
  log(`temp dir: ${tempDir}`);

  spawnService('Engine', 'python', ['main.py'], {
    ENGINE_PORT,
    CUSTOM_LLM_URL: `${PROXY_BASE}/v1/chat/completions`,
    CUSTOM_LLM_MODEL: process.env.E2E_LLM_MODEL || 'open-code',
    CUSTOM_LLM_API_KEY: '',
    PRIMARY_LLM: '',
    FALLBACK_LLM: '',
    OPENAI_API_KEYS: '',
    GEMINI_API_KEY: '',
  });
  await waitFor(async () => {
    const r = await fetch(`${ENGINE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  }, 30000, 'Engine /health');

  spawnService('BE', 'node', ['BE/dist/main.js'], {
    PORT: BE_PORT,
    ENGINE_URL,
    CORE_DB_PATH: join(tempDir, 'core.db'),
    LOCAL_DB_PATH: join(tempDir, 'local.db'),
    NODE_ENV: 'development',
    QUEUE_MAX_CONCURRENT: '5',
    QUEUE_MIN_TIME_MS: '0',
    QUEUE_RESERVOIR: '50',
    QUEUE_RESERVOIR_REFRESH_MS: '60000',
  });
  await waitFor(async () => {
    const r = await api('/tenant/init', { method: 'POST', timeoutMs: 5000 });
    return r.status === 201;
  }, 30000, 'BE readiness');

  log('Flow 1: happy path (create story via real stack)');
  {
    const init = await api('/tenant/init', { method: 'POST' });
    assert.equal(init.status, 201, 'tenant init');
    const tenant = init.data.tenant_id;
    assert.ok(tenant, 'tenant_id returned');

    const story = await api('/story/create', {
      method: 'POST', tenant,
      body: { child_name: 'An', age: 4, theme: 'Động vật', goal: 'Dũng cảm', mood: 'vui vẻ' },
      timeoutMs: 120000,
    });
    assert.equal(story.status, 201, `story create returned ${story.status}`);
    assert.ok(story.data.story_id, 'story_id present');
    assert.ok(story.data.title, 'title present');
    assert.ok(Array.isArray(story.data.sections), 'sections array');

    const detail = await api(`/story/${story.data.story_id}`, { tenant });
    assert.equal(detail.status, 200, 'story detail 200');
    assert.equal(detail.data.title, story.data.title, 'detail title matches');
    log('Flow 1 PASS');
  }

  log('Flow 2: error path (validation)');
  {
    const init = await api('/tenant/init', { method: 'POST' });
    const tenant = init.data.tenant_id;

    const bad = await api('/story/create', {
      method: 'POST', tenant,
      body: { child_name: 'An', age: 10, theme: 'Động vật' },
    });
    assert.equal(bad.status, 422, 'invalid age returns 422');
    assert.ok(bad.data.error, 'error object present');
    log('Flow 2 PASS');
  }

  log('Flow 3: tenant isolation');
  {
    const t1 = (await api('/tenant/init', { method: 'POST' })).data.tenant_id;
    const t2 = (await api('/tenant/init', { method: 'POST' })).data.tenant_id;

    await api('/story/create', {
      method: 'POST', tenant: t1,
      body: { child_name: 'An', age: 4, theme: 'Động vật' },
      timeoutMs: 120000,
    });

    const other = await api('/story/latest', { tenant: t2 });
    assert.equal(other.status, 200, 'latest for t2');
    assert.equal(other.data.stories.length, 0, 'no cross-tenant leakage');
    log('Flow 3 PASS');
  }

  log('ALL E2E FLOWS PASSED');
}

main()
  .then(() => { cleanup(); process.exit(0); })
  .catch(err => {
    console.error('[e2e] FAILED:', err.message);
    cleanup();
    process.exit(1);
  });
```

- [ ] **Step 2: Ensure BE is built**

Run: `npm run build` in `BE/`.
Expected: `BE/dist/main.js` exists.

- [ ] **Step 3: Verify proxy is up and run the script**

Run: `node scripts/e2e.mjs` from project root.
Expected: prints `[e2e] Flow 1 PASS`, `Flow 2 PASS`, `Flow 3 PASS`, `ALL E2E FLOWS PASSED`, exit 0. (Takes 1-3 min; uses real LLM via proxy.)

- [ ] **Step 4: Verify proxy-down behavior**

Run: `$env:E2E_PROXY="http://localhost:1"; node scripts/e2e.mjs`
Expected: exits 1 with "LLM proxy not reachable".

- [ ] **Step 5: Document run commands in README**

Edit `README.md` Testing section to add:

```bash
# FE
cd FE && npm test

# Full-stack E2E (requires LLM proxy on localhost:20128 and BE built)
node scripts/e2e.mjs
```

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e.mjs README.md
git commit -m "test(e2e): add full-stack e2e script spawning Engine and BE"
```

---

## Self-Review Notes (post-write)

- **Spec coverage:** Task 1 (BE foundation fix + supertest + datasource) ✓; Task 2 (contract camelCase→snake_case + tests) ✓; Task 3 (BE↔Engine real integration) ✓; Task 4 (Engine real-LLM via proxy) ✓; Task 5 (FE infra) ✓; Task 6 (FE api/storyGenerator) ✓; Task 7 (FE components) ✓; Task 8 (E2E script) ✓.
- **Placeholder scan:** All code blocks complete. Task 3's `story.flow.spec.ts` uses the real in-memory factories in both `beforeAll` and the Engine-down test. No TBD/TODO/sketch remains.
- **Type consistency:** `toEnginePayload` return type `Record<string, unknown>`; `GenerateDto` fields consistent with `generate-story.dto.ts`; `EngineResponse` camelCase fields match existing interface.
