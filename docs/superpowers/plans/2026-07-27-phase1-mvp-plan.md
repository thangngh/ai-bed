# Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect existing FE shell to NestJS BE + Python Engine for real LLM story generation with multi-key round-robin, dual SQLite DB, and tenant isolation.

**Architecture:** Monorepo with `BE/` (NestJS 11, TypeORM, Bottleneck) + `Engine/` (Python FastAPI, multi-LLM router). FE stripped of LLM keys, proxy through BE. Sync HTTP with Bottleneck queue for concurrency control. No login — tenant = device UUID.

**Tech Stack:** NestJS 11, TypeORM, SQLite × 2, Bottleneck, Python 3.11+, FastAPI, Pydantic, openai, google-genai

## Global Constraints

- All prompt instructions = English, story output = Vietnamese (thuần Việt)
- No API keys in FE — zero LLM config in browser
- Tenant = UUID v4, tự sinh không login
- Dual SQLite: `data/core.db` (private) + `data/local.db` (user-visible)
- Bottleneck queue: maxConcurrent=2, minTime=6000ms
- Rate limiter: token bucket 10 req/min/tenant
- LLM retry: max 2 per stage, fallback story if exhausted
- OpenAI multi-key round-robin with failure tracking
- Every endpoint returns structured error: `{ error: { code, message } }`

---

## File Structure (All New Unless Noted)

```
BE/
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/
│   │   ├── middleware/
│   │   │   ├── tenant.middleware.ts          # Parse/inject X-Tenant-Id
│   │   │   └── rate-limiter.middleware.ts    # Token bucket
│   │   ├── guards/
│   │   │   └── tenant.guard.ts               # Validate tenant exists
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   └── tenant.interceptor.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts
│   │   ├── dto/
│   │   │   ├── api-response.dto.ts
│   │   │   └── pagination.dto.ts
│   │   └── services/
│   │       └── queue.service.ts              # Bottleneck wrapper
│   ├── modules/
│   │   ├── tenant/
│   │   │   ├── tenant.module.ts
│   │   │   ├── tenant.service.ts
│   │   │   ├── tenant.controller.ts
│   │   │   ├── entities/
│   │   │   │   └── tenant.entity.ts
│   │   │   └── __tests__/
│   │   │       └── tenant.service.spec.ts
│   │   ├── child/
│   │   │   ├── child.module.ts
│   │   │   ├── child.service.ts
│   │   │   ├── child.controller.ts
│   │   │   ├── dto/
│   │   │   │   └── child-profile.dto.ts
│   │   │   ├── entities/
│   │   │   │   └── child-profile.entity.ts
│   │   │   └── __tests__/
│   │   │       └── child.service.spec.ts
│   │   ├── story/
│   │   │   ├── story.module.ts
│   │   │   ├── story.service.ts
│   │   │   ├── story.controller.ts
│   │   │   ├── dto/
│   │   │   │   ├── create-story.dto.ts
│   │   │   │   └── story-response.dto.ts
│   │   │   ├── entities/
│   │   │   │   ├── story.entity.ts
│   │   │   │   └── story-section.entity.ts
│   │   │   └── __tests__/
│   │   │       └── story.service.spec.ts
│   │   ├── feedback/
│   │   │   ├── feedback.module.ts
│   │   │   ├── feedback.service.ts
│   │   │   ├── feedback.controller.ts
│   │   │   ├── dto/
│   │   │   │   └── feedback.dto.ts
│   │   │   ├── entities/
│   │   │   │   └── feedback.entity.ts
│   │   │   └── __tests__/
│   │   │       └── feedback.service.spec.ts
│   │   ├── memory/
│   │   │   ├── memory.module.ts
│   │   │   ├── memory.service.ts
│   │   │   ├── memory.controller.ts
│   │   │   ├── entities/
│   │   │   │   └── memory-item.entity.ts
│   │   │   └── __tests__/
│   │   │       └── memory.service.spec.ts
│   │   └── engine-gateway/
│   │       ├── engine-gateway.module.ts
│   │       ├── engine-gateway.service.ts
│   │       ├── dto/
│   │       │   ├── generate-story.dto.ts
│   │       │   └── engine-response.dto.ts
│   │       └── engine.config.ts
│   └── config/
│       ├── app.config.ts
│       ├── engine.config.ts
│       └── rate-limit.config.ts
│
Engine/
├── requirements.txt
├── .env.example
├── Dockerfile
├── main.py
├── core/
│   ├── __init__.py
│   ├── orchestrator.py             # Full pipeline orchestration
│   ├── pipeline.py                  # Planner → Writer → Reviewer
│   ├── memory_extractor.py
│   ├── validator.py                 # Schema check + safety
│   ├── llm/
│   │   ├── __init__.py
│   │   ├── client.py                # BaseLLMClient abstract
│   │   ├── router.py                # LLMRouter fallback chain
│   │   ├── openai_client.py         # Round-robin multi-key
│   │   ├── gemini_client.py
│   │   └── custom_client.py
│   └── prompts/
│       ├── __init__.py
│       ├── registry.py              # Template loader
│       └── templates/
│           ├── system/
│           │   └── default.txt
│           ├── developer/
│           │   ├── 3-4.txt
│           │   └── 5-6.txt
│           └── user/
│               └── default.txt
├── tests/
│   ├── __init__.py
│   ├── conftest.py
│   ├── test_llm_client.py
│   ├── test_llm_router.py
│   ├── test_openai_client.py
│   ├── test_orchestrator.py
│   ├── test_pipeline.py
│   ├── test_validator.py
│   └── test_memory_extractor.py
│
FE/ (modified)
├── .env.example                    # Remove GEMINI_API_KEY
├── server.ts                       # Remove Gemini AI code
├── src/
│   └── utils/
│       ├── api.ts                   # NEW: API client with tenant
│       └── storyGenerator.ts        # MODIFY: proxy through BE
```

---

## PHASE 1A: Foundation (18 tasks)

### Task 1A.1: Scaffold BE — NestJS Project

**Files:**
- Create: `BE/package.json`
- Create: `BE/tsconfig.json`
- Create: `BE/tsconfig.build.json`
- Create: `BE/nest-cli.json`
- Create: `BE/.env.example`
- Create: `BE/.gitignore`
- Test: manual `npm install` + `npm run build`

**Interfaces:**
- Produces: working NestJS scaffold that compiles

- [ ] **Step 1: Create BE/package.json**

```json
{
  "name": "bedtime-story-be",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "node dist/main",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:cov": "jest --coverage",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/typeorm": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "typeorm": "^0.3.20",
    "sqlite3": "^5.1.7",
    "bottleneck": "^2.19.5",
    "class-validator": "^0.14.1",
    "class-transformer": "^0.5.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "typescript": "~5.8.0",
    "ts-node": "^10.9.2"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 2: Create BE/tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create BE/tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "**/*spec.ts"]
}
```

- [ ] **Step 4: Create BE/nest-cli.json**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 5: Create BE/.env.example**

```
PORT=3001
NODE_ENV=development

ENGINE_URL=http://localhost:8000
ENGINE_TIMEOUT_MS=25000
ENGINE_RETRY_COUNT=2

RATE_LIMIT_CAPACITY=10
RATE_LIMIT_REFILL_SECONDS=6

QUEUE_MAX_CONCURRENT=2
QUEUE_MIN_TIME_MS=6000
QUEUE_RESERVOIR=10
QUEUE_RESERVOIR_REFRESH_MS=60000
```

- [ ] **Step 6: Create BE/.gitignore**

```
node_modules/
dist/
data/*.db
data/*.db-journal
.env
```

- [ ] **Step 7: Install + verify build**

Run: `cd BE && npm install`
Run: `cd BE && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
cd E:/pet-project/AI-BEDTIME
git add BE/
git commit -m "feat(be): scaffold NestJS project"
```

---

### Task 1A.2: BE — main.ts + AppModule Shell

**Files:**
- Create: `BE/src/main.ts`
- Create: `BE/src/app.module.ts`
- Test: `npm run start:dev` starts on port 3001

**Interfaces:**
- Produces: NestJS app with ConfigModule, health endpoint at GET /

- [ ] **Step 1: Write main.ts**

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`BE running on http://localhost:${port}`);
}
bootstrap();
```

- [ ] **Step 2: Write app.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Run to verify startup**

Run: `cd BE && npx nest start` (let it run 5s, then Ctrl+C)
Expected: "BE running on http://localhost:3001" logged

- [ ] **Step 4: Commit**

```bash
git add BE/src/main.ts BE/src/app.module.ts
git commit -m "feat(be): add main.ts and AppModule shell"
```

---

### Task 1A.3: BE — TypeORM Dual Datasource + Data Dir

**Files:**
- Modify: `BE/src/app.module.ts`
- Test: Verify both DB files created on startup

- [ ] **Step 1: Write the failing test — verify datasources load**

```typescript
// BE/src/common/__tests__/datasource.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AppModule } from '../../app.module';

describe('DualDataSource', () => {
  let module: TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  it('should have core datasource', async () => {
    const ds = module.get(getDataSourceToken('core'));
    expect(ds).toBeDefined();
    expect(ds.isInitialized).toBe(true);
  });

  it('should have local datasource', async () => {
    const ds = module.get(getDataSourceToken('local'));
    expect(ds).toBeDefined();
    expect(ds.isInitialized).toBe(true);
  });

  afterAll(async () => {
    await module.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd BE && npx jest src/common/__tests__/datasource.spec.ts --no-cache`
Expected: FAIL — "Cannot find module '@nestjs/typeorm'" or similar until module is wired

- [ ] **Step 3: Update app.module.ts with TypeORM dual sources**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      name: 'core',
      useFactory: (config: ConfigService) => ({
        type: 'sqlite',
        database: config.get('CORE_DB_PATH', 'data/core.db'),
        entities: [],
        synchronize: config.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forRootAsync({
      name: 'local',
      useFactory: (config: ConfigService) => ({
        type: 'sqlite',
        database: config.get('LOCAL_DB_PATH', 'data/local.db'),
        entities: [],
        synchronize: config.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Create data/ directory + .gitkeep**

Run: `mkdir BE\data` (if not exists) and `echo "" > BE\data\.gitkeep`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd BE && npx jest src/common/__tests__/datasource.spec.ts --no-cache`
Expected: PASS — both datasources initialized

- [ ] **Step 6: Verify DB files created on startup**

Run: `cd BE && npx nest start` Ctrl+C after 3s
Expected: `BE/data/core.db` and `BE/data/local.db` files exist

- [ ] **Step 7: Commit**

```bash
git add BE/src/app.module.ts BE/data/.gitkeep BE/src/common/__tests__/datasource.spec.ts
git commit -m "feat(be): TypeORM dual SQLite datasources"
```

---

### Task 1A.4: BE — Tenant Entity (core.db)

**Files:**
- Create: `BE/src/modules/tenant/entities/tenant.entity.ts`
- Modify: `BE/src/app.module.ts` (register entity)
- Test: `BE/src/modules/tenant/__tests__/tenant.entity.spec.ts`

**Interfaces:**
- Produces: `Tenant` entity mapped to core.db with all required columns

- [ ] **Step 1: Write the failing test**

```typescript
// BE/src/modules/tenant/__tests__/tenant.entity.spec.ts
import { Tenant } from '../entities/tenant.entity';

describe('TenantEntity', () => {
  it('should have all required columns', () => {
    const tenant = new Tenant();
    tenant.tenantId = 'uuid-123';
    tenant.name = 'anonymous';
    tenant.authType = 'local';
    
    expect(tenant.tenantId).toBe('uuid-123');
    expect(tenant.name).toBe('anonymous');
    expect(tenant.authType).toBe('local');
    expect(tenant.metadata).toBeUndefined();
    expect(tenant.createdAt).toBeUndefined(); // DB default
    expect(tenant.updatedAt).toBeUndefined(); // DB default
  });
});
```

- [ ] **Step 2: Write Tenant entity**

```typescript
// BE/src/modules/tenant/entities/tenant.entity.ts
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'name', type: 'text', default: 'anonymous' })
  name!: string;

  @Column({ name: 'auth_type', type: 'text', default: 'local' })
  authType!: string;

  @Column({ name: 'auth_key', type: 'text', nullable: true })
  authKey?: string;

  @Column({ name: 'metadata', type: 'text', nullable: true })
  metadata?: string;

  @Column({ name: 'created_at', type: 'text', default: () => "datetime('now')" })
  createdAt?: string;

  @Column({ name: 'updated_at', type: 'text', default: () => "datetime('now')" })
  updatedAt?: string;
}
```

- [ ] **Step 3: Register Tenant in core datasource**

Edit `BE/src/app.module.ts`:
```typescript
import { Tenant } from './modules/tenant/entities/tenant.entity';

// In TypeOrmModule.forRootAsync({ name: 'core', ... }):
entities: [Tenant],
```

- [ ] **Step 4: Run tests**

Run: `cd BE && npx jest src/modules/tenant/__tests__/tenant.entity.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/tenant/entities/tenant.entity.ts BE/src/modules/tenant/__tests__/tenant.entity.spec.ts
git commit -m "feat(be): Tenant entity for core.db"
```

---

### Task 1A.5: BE — Tenant Service (CRUD)

**Files:**
- Create: `BE/src/modules/tenant/tenant.service.ts`
- Test: `BE/src/modules/tenant/__tests__/tenant.service.spec.ts`

**Interfaces:**
- Consumes: `@InjectDataSource('core') DataSource`
- Produces:
  - `findById(tenantId: string): Promise<Tenant | null>`
  - `create(tenantId?: string): Promise<Tenant>`
  - `findOrCreate(tenantId: string): Promise<Tenant>`

- [ ] **Step 1: Write the failing test**

```typescript
// BE/src/modules/tenant/__tests__/tenant.service.spec.ts
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantService } from '../tenant.service';
import { Tenant } from '../entities/tenant.entity';

describe('TenantService', () => {
  let service: TenantService;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TenantService,
        {
          provide: getDataSourceToken('core'),
          useFactory: async () => {
            const ds = new DataSource({
              type: 'sqlite',
              database: ':memory:',
              entities: [Tenant],
              synchronize: true,
            });
            await ds.initialize();
            return ds;
          },
        },
      ],
    }).compile();
    service = module.get(TenantService);
    dataSource = module.get(getDataSourceToken('core'));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should create a tenant with UUID', async () => {
    const tenant = await service.create();
    expect(tenant.tenantId).toBeDefined();
    expect(tenant.tenantId.length).toBe(36); // UUID v4
    expect(tenant.name).toBe('anonymous');
    expect(tenant.authType).toBe('local');
  });

  it('should find tenant by ID', async () => {
    const created = await service.create();
    const found = await service.findById(created.tenantId);
    expect(found).toBeDefined();
    expect(found!.tenantId).toBe(created.tenantId);
  });

  it('should return null for non-existent tenant', async () => {
    const found = await service.findById('non-existent');
    expect(found).toBeNull();
  });

  it('should find or create tenant', async () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const created = await service.findOrCreate(tenantId);
    expect(created.tenantId).toBe(tenantId);

    const found = await service.findOrCreate(tenantId);
    expect(found.tenantId).toBe(tenantId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd BE && npx jest src/modules/tenant/__tests__/tenant.service.spec.ts`
Expected: FAIL — "TenantService not defined"

- [ ] **Step 3: Write TenantService**

```typescript
// BE/src/modules/tenant/tenant.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Tenant } from './entities/tenant.entity';

@Injectable()
export class TenantService {
  private repo: Repository<Tenant>;

  constructor(@InjectDataSource('core') private dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(Tenant);
  }

  async create(existingId?: string): Promise<Tenant> {
    const tenant = new Tenant();
    tenant.tenantId = existingId || uuidv4();
    return this.repo.save(tenant);
  }

  async findById(tenantId: string): Promise<Tenant | null> {
    return this.repo.findOne({ where: { tenantId } });
  }

  async findOrCreate(tenantId: string): Promise<Tenant> {
    const existing = await this.findById(tenantId);
    if (existing) return existing;
    return this.create(tenantId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd BE && npx jest src/modules/tenant/__tests__/tenant.service.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/tenant/tenant.service.ts BE/src/modules/tenant/__tests__/tenant.service.spec.ts
git commit -m "feat(be): TenantService CRUD with SQLite"
```

---

### Task 1A.6: BE — Tenant Module + Controller

**Files:**
- Create: `BE/src/modules/tenant/tenant.module.ts`
- Create: `BE/src/modules/tenant/tenant.controller.ts`
- Modify: `BE/src/app.module.ts`
- Test: `BE/src/modules/tenant/__tests__/tenant.controller.spec.ts`

**Interfaces:**
- `POST /tenant/init` → `{ tenant_id: string, message: string }`
- Registers TenantModule in AppModule

- [ ] **Step 1: Write the failing test**

```typescript
// BE/src/modules/tenant/__tests__/tenant.controller.spec.ts
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { TenantModule } from '../tenant.module';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';

describe('TenantController', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TenantModule],
    })
      .overrideProvider(getDataSourceToken('core'))
      .useFactory({
        factory: async () => {
          const ds = new DataSource({
            type: 'sqlite',
            database: ':memory:',
            entities: [Tenant],
            synchronize: true,
          });
          await ds.initialize();
          return ds;
        },
      })
      .compile();

    app = module.createNestApplication();
    await app.init();
    dataSource = module.get(getDataSourceToken('core'));
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

- [ ] **Step 2: Write TenantModule**

```typescript
// BE/src/modules/tenant/tenant.module.ts
import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
```

- [ ] **Step 3: Write TenantController**

```typescript
// BE/src/modules/tenant/tenant.controller.ts
import { Controller, Post } from '@nestjs/common';
import { TenantService } from './tenant.service';

@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post('init')
  async init() {
    const tenant = await this.tenantService.create();
    return {
      tenant_id: tenant.tenantId,
      message: 'Tenant initialized',
    };
  }
}
```

- [ ] **Step 4: Register TenantModule in AppModule**

Edit `app.module.ts`:
```typescript
import { TenantModule } from './modules/tenant/tenant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ ... }),
    TypeOrmModule.forRootAsync({ name: 'core', ... }),
    TypeOrmModule.forRootAsync({ name: 'local', ... }),
    TenantModule,
  ],
})
```

- [ ] **Step 5: Install supertest**

Run: `cd BE && npm install --save-dev supertest @types/supertest`

- [ ] **Step 6: Run tests**

Run: `cd BE && npx jest src/modules/tenant/__tests__/tenant.controller.spec.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add BE/src/modules/tenant/
git commit -m "feat(be): Tenant module + POST /tenant/init"
```

---

### Task 1A.7: FE — Tenant ID Management (api.ts)

**Files:**
- Create: `FE/src/utils/api.ts`

**Interfaces:**
- Produces: `apiClient<T>(path, options?)` — auto-manages X-Tenant-Id
- On first boot: POST `/tenant/init` → store in localStorage
- On subsequent: read from localStorage, attach header

- [ ] **Step 1: Write api.ts**

```typescript
// FE/src/utils/api.ts
const API_BASE = import.meta.env.VITE_BE_URL || '/api';

let tenantIdPromise: Promise<string> | null = null;

async function ensureTenantId(): Promise<string> {
  const stored = localStorage.getItem('bsc_tenant_id');
  if (stored) return stored;

  if (!tenantIdPromise) {
    tenantIdPromise = (async () => {
      const res = await fetch(`${API_BASE}/tenant/init`, { method: 'POST' });
      const data = await res.json();
      localStorage.setItem('bsc_tenant_id', data.tenant_id);
      return data.tenant_id;
    })();
  }

  return tenantIdPromise;
}

export async function apiClient<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const tenantId = await ensureTenantId();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { code: 'UNKNOWN' } }));
    throw new Error(err.error?.code || 'API_ERROR');
  }

  return res.json();
}
```

- [ ] **Step 2: Verify build**

Run: `cd FE && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add FE/src/utils/api.ts
git commit -m "feat(fe): apiClient with auto tenant ID management"
```

---

### Task 1A.8: BE — Tenant Middleware

**Files:**
- Create: `BE/src/common/middleware/tenant.middleware.ts`
- Test: `BE/src/common/__tests__/tenant.middleware.spec.ts`

**Interfaces:**
- Produces: Express middleware that parses `X-Tenant-Id`, injects `req.tenantId`
- If missing: lazy init → create tenant → set response header `X-Tenant-Id`
- If invalid UUID: throw `BadRequestException`

- [ ] **Step 1: Write the failing test**

```typescript
// BE/src/common/__tests__/tenant.middleware.spec.ts
import { TenantMiddleware } from '../middleware/tenant.middleware';
import { TenantService } from '../../modules/tenant/tenant.service';
import { BadRequestException } from '@nestjs/common';

describe('TenantMiddleware', () => {
  let middleware: TenantMiddleware;
  let tenantService: jest.Mocked<TenantService>;

  beforeEach(() => {
    tenantService = {
      create: jest.fn(),
      findOrCreate: jest.fn(),
      findById: jest.fn(),
    } as any;
    middleware = new TenantMiddleware(tenantService);
  });

  it('should create tenant if header missing', async () => {
    const req = { headers: {} } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    tenantService.create.mockResolvedValue({ tenantId: 'new-uuid' });
    await middleware.use(req, res, next);

    expect(tenantService.create).toHaveBeenCalled();
    expect(req.tenantId).toBe('new-uuid');
    expect(res.setHeader).toHaveBeenCalledWith('X-Tenant-Id', 'new-uuid');
    expect(next).toHaveBeenCalled();
  });

  it('should use existing valid tenant ID', async () => {
    const req = { headers: { 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' } } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    tenantService.findOrCreate.mockResolvedValue({ tenantId: '550e8400-e29b-41d4-a716-446655440000' });
    await middleware.use(req, res, next);

    expect(tenantService.findOrCreate).toHaveBeenCalled();
    expect(req.tenantId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(next).toHaveBeenCalled();
  });

  it('should throw for invalid UUID format', async () => {
    const req = { headers: { 'x-tenant-id': 'not-a-uuid' } } as any;
    const res = {} as any;
    const next = jest.fn();

    await expect(middleware.use(req, res, next)).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd BE && npx jest src/common/__tests__/tenant.middleware.spec.ts`
Expected: FAIL

- [ ] **Step 3: Write TenantMiddleware**

```typescript
// BE/src/common/middleware/tenant.middleware.ts
import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantService } from '../../modules/tenant/tenant.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenantService: TenantService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    let tenantId = req.headers['x-tenant-id'] as string;

    if (!tenantId) {
      const tenant = await this.tenantService.create();
      tenantId = tenant.tenantId;
      res.setHeader('X-Tenant-Id', tenantId);
      (req as any).tenantId = tenantId;
      return next();
    }

    if (!UUID_REGEX.test(tenantId)) {
      throw new BadRequestException('INVALID_TENANT');
    }

    await this.tenantService.findOrCreate(tenantId);
    (req as any).tenantId = tenantId;
    next();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd BE && npx jest src/common/__tests__/tenant.middleware.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add BE/src/common/middleware/tenant.middleware.ts BE/src/common/__tests__/tenant.middleware.spec.ts
git commit -m "feat(be): TenantMiddleware with lazy init"
```

---

### Task 1A.9: BE — Tenant Guard

**Files:**
- Create: `BE/src/common/guards/tenant.guard.ts`
- Test: `BE/src/common/__tests__/tenant.guard.spec.ts`

**Interfaces:**
- Produces: Guard that rejects requests missing `req.tenantId`

- [ ] **Step 1: Write test**

```typescript
// BE/src/common/__tests__/tenant.guard.spec.ts
import { TenantGuard } from '../guards/tenant.guard';
import { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';

describe('TenantGuard', () => {
  let guard: TenantGuard;

  beforeEach(() => {
    guard = new TenantGuard();
  });

  it('should allow request with tenantId', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ tenantId: 'valid-uuid' }),
      }),
    } as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should reject request without tenantId', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Write guard**

```typescript
// BE/src/common/guards/tenant.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!request.tenantId) {
      throw new UnauthorizedException('TENANT_REQUIRED');
    }
    return true;
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd BE && npx jest src/common/__tests__/tenant.guard.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add BE/src/common/guards/tenant.guard.ts BE/src/common/__tests__/tenant.guard.spec.ts
git commit -m "feat(be): TenantGuard"
```

---

### Task 1A.10: BE — Rate Limiter Middleware

**Files:**
- Create: `BE/src/common/middleware/rate-limiter.middleware.ts`
- Test: `BE/src/common/__tests__/rate-limiter.middleware.spec.ts`

**Interfaces:**
- Produces: Token bucket rate limiter per tenant
- Capacity: 10 tokens, refill 1 token / 6s
- Returns 429 with Retry-After header

- [ ] **Step 1: Write the failing test**

```typescript
// BE/src/common/__tests__/rate-limiter.middleware.spec.ts
import { RateLimiterMiddleware } from '../middleware/rate-limiter.middleware';
import { HttpException } from '@nestjs/common';

describe('RateLimiterMiddleware', () => {
  let middleware: RateLimiterMiddleware;

  beforeEach(() => {
    middleware = new RateLimiterMiddleware({ capacity: 3, refillRate: 10 });
  });

  it('should allow requests within capacity', () => {
    const req = { tenantId: 'tenant-1' } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should reject when bucket empty', () => {
    const req = { tenantId: 'tenant-2' } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    // Consume all 3 tokens
    middleware.use(req, res, next);
    middleware.use(req, res, next);
    middleware.use(req, res, next);

    // 4th should fail
    expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('should have separate buckets per tenant', () => {
    const reqA = { tenantId: 'tenant-a' } as any;
    const reqB = { tenantId: 'tenant-b' } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    // Exhaust tenant-a
    middleware.use(reqA, res, next);
    middleware.use(reqA, res, next);
    middleware.use(reqA, res, next);

    // tenant-b should still have tokens
    expect(() => middleware.use(reqB, res, next)).not.toThrow();
  });
});
```

- [ ] **Step 2: Write the rate limiter**

```typescript
// BE/src/common/middleware/rate-limiter.middleware.ts
import { Injectable, NestMiddleware, HttpException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // seconds per 1 token
}

@Injectable()
export class RateLimiterMiddleware implements NestMiddleware {
  private buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly config: { capacity: number; refillRate: number }
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) return next();

    let bucket = this.buckets.get(tenantId);
    if (!bucket) {
      bucket = {
        tokens: this.config.capacity,
        lastRefill: Date.now(),
        capacity: this.config.capacity,
        refillRate: this.config.refillRate,
      };
      this.buckets.set(tenantId, bucket);
    }

    // Refill
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    const refillTokens = Math.floor(elapsed / bucket.refillRate);
    if (refillTokens > 0) {
      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + refillTokens);
      bucket.lastRefill = now;
    }

    if (bucket.tokens <= 0) {
      const waitSeconds = Math.ceil(bucket.refillRate - (elapsed % bucket.refillRate));
      res.setHeader('Retry-After', waitSeconds);
      throw new HttpException({
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Quá nhiều yêu cầu', retry_after: waitSeconds },
      }, 429);
    }

    bucket.tokens -= 1;
    next();
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd BE && npx jest src/common/__tests__/rate-limiter.middleware.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add BE/src/common/middleware/rate-limiter.middleware.ts BE/src/common/__tests__/rate-limiter.middleware.spec.ts
git commit -m "feat(be): token bucket rate limiter middleware"
```

---

### Task 1A.11: BE — Middleware Registration in AppModule

**Files:**
- Modify: `BE/src/app.module.ts` — apply TenantMiddleware + RateLimiterMiddleware globally
- Test: E2E verify both middleware on routes

- [ ] **Step 1: Update AppModule with middleware consumer**

```typescript
// In app.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { RateLimiterMiddleware } from './common/middleware/rate-limiter.middleware';
import { TenantModule } from './modules/tenant/tenant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({ name: 'core', ... }),
    TypeOrmModule.forRootAsync({ name: 'local', ... }),
    TenantModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware, RateLimiterMiddleware)
      .forRoutes('*');
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd BE && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add BE/src/app.module.ts
git commit -m "feat(be): register TenantMiddleware + RateLimiter globally"
```

---

### Task 1A.12: BE — Error Filter

**Files:**
- Create: `BE/src/common/filters/http-exception.filter.ts`
- Test: `BE/src/common/__tests__/http-exception.filter.spec.ts`

**Interfaces:**
- Produces: Global exception filter that returns `{ error: { code, message }, request_id }`

- [ ] **Step 1: Write test**

```typescript
// BE/src/common/__tests__/http-exception.filter.spec.ts
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { HttpException, BadRequestException } from '@nestjs/common';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockResponse: any;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  it('should format HttpException', () => {
    const exception = new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'Invalid age' } });
    const host = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ requestId: 'req-123' }),
      }),
    } as any;

    filter.catch(exception, host);
    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid age' },
      request_id: 'req-123',
    });
  });

  it('should handle unknown errors as 500', () => {
    const exception = new Error('Something broke');
    const host = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({ requestId: 'req-456' }),
      }),
    } as any;

    filter.catch(exception, host);
    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: { code: 'INTERNAL_ERROR', message: 'Đã có lỗi xảy ra' },
      request_id: 'req-456',
    });
  });
});
```

- [ ] **Step 2: Write filter**

```typescript
// BE/src/common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response, Request } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = 500;
    let body: any = {
      error: { code: 'INTERNAL_ERROR', message: 'Đã có lỗi xảy ra' },
      request_id: (request as any).requestId || uuidv4(),
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      body.error = typeof res === 'string' ? { code: 'HTTP_ERROR', message: res } : (res as any);
      body.request_id = (request as any).requestId || uuidv4();
    }

    response.status(status).json(body);
  }
}
```

- [ ] **Step 3: Register filter in main.ts**

```typescript
// In main.ts
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new HttpExceptionFilter());
  // ...
}
```

- [ ] **Step 4: Run tests**

Run: `cd BE && npx jest src/common/__tests__/http-exception.filter.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add BE/src/common/filters/http-exception.filter.ts BE/src/common/__tests__/http-exception.filter.spec.ts
git commit -m "feat(be): global HttpExceptionFilter"
```

---

### Task 1A.13: BE — Validation Pipe + Common DTOs

**Files:**
- Create: `BE/src/common/pipes/validation.pipe.ts`
- Create: `BE/src/common/dto/api-response.dto.ts`
- Create: `BE/src/common/dto/pagination.dto.ts`

**Interfaces:**
- Produces: Global validation pipe + standard DTOs for API shape

- [ ] **Step 1: Write validation pipe**

```typescript
// BE/src/common/pipes/validation.pipe.ts
import { PipeTransform, Injectable, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    if (!metatype || !this.toValidate(metatype)) return value;

    const object = plainToInstance(metatype, value);
    const errors = await validate(object);
    if (errors.length > 0) {
      const firstError = errors[0];
      const constraints = firstError.constraints || {};
      const message = Object.values(constraints)[0] || 'Validation failed';
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message,
          details: { field: firstError.property, value: value[firstError.property] },
        },
      });
    }
    return object;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
```

- [ ] **Step 2: Create API response DTOs**

```typescript
// BE/src/common/dto/api-response.dto.ts
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    retry_after?: number;
  };
  request_id?: string;
}

export interface SuccessResponse<T> {
  request_id?: string;
  data: T;
  meta?: {
    latency_ms?: number;
    llm_calls?: number;
    is_fallback?: boolean;
  };
}
```

```typescript
// BE/src/common/dto/pagination.dto.ts
export interface PaginationDto {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] **Step 3: Register pipe in main.ts**

```typescript
// In main.ts
import { ValidationPipe } from './common/pipes/validation.pipe';
app.useGlobalPipes(new ValidationPipe());
```

- [ ] **Step 4: Verify build**

Run: `cd BE && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add BE/src/common/pipes/ BE/src/common/dto/
git commit -m "feat(be): global validation pipe + response DTOs"
```

---

### Task 1A.14: BE — Bottleneck Queue Service

**Files:**
- Create: `BE/src/common/services/queue.service.ts`
- Test: `BE/src/common/__tests__/queue.service.spec.ts`

**Interfaces:**
- `schedule<T>(tenantId, fn): Promise<T>` — wraps fn in Bottleneck per tenant
- Per-tenant limiter: maxConcurrent=2, minTime=6000ms, reservoir=10

- [ ] **Step 1: Write the failing test**

```typescript
// BE/src/common/__tests__/queue.service.spec.ts
import { QueueService } from '../services/queue.service';

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(() => {
    service = new QueueService({
      maxConcurrent: 2,
      minTime: 10,
      reservoir: 5,
      reservoirRefreshInterval: 60 * 1000,
    });
  });

  it('should execute function and return result', async () => {
    const result = await service.schedule('tenant-1', async () => 'hello');
    expect(result).toBe('hello');
  });

  it('should limit concurrent executions per tenant', async () => {
    let concurrent = 0;
    let maxConcurrentHit = 0;

    const task = async () => {
      concurrent++;
      maxConcurrentHit = Math.max(maxConcurrentHit, concurrent);
      await new Promise(r => setTimeout(r, 50));
      concurrent--;
      return 'done';
    };

    const results = await Promise.all([
      service.schedule('tenant-1', task),
      service.schedule('tenant-1', task),
      service.schedule('tenant-1', task),
    ]);

    expect(maxConcurrentHit).toBeLessThanOrEqual(2);
    expect(results).toEqual(['done', 'done', 'done']);
  });

  it('should have separate queues per tenant', async () => {
    const start = Date.now();

    const results = await Promise.all([
      service.schedule('tenant-a', async () => { await new Promise(r => setTimeout(r, 30)); return 'a'; }),
      service.schedule('tenant-b', async () => { await new Promise(r => setTimeout(r, 30)); return 'b'; }),
    ]);

    const elapsed = Date.now() - start;
    // Separate queues run in parallel — should be ~30ms not ~60ms
    expect(elapsed).toBeLessThan(60);
    expect(results).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Write QueueService**

```typescript
// BE/src/common/services/queue.service.ts
import { Injectable } from '@nestjs/common';
import Bottleneck from 'bottleneck';

interface QueueConfig {
  maxConcurrent: number;
  minTime: number;
  reservoir: number;
  reservoirRefreshInterval: number;
}

@Injectable()
export class QueueService {
  private limiters = new Map<string, Bottleneck>();

  constructor(private readonly config: QueueConfig) {}

  getLimiter(tenantId: string): Bottleneck {
    if (!this.limiters.has(tenantId)) {
      this.limiters.set(tenantId, new Bottleneck({
        maxConcurrent: this.config.maxConcurrent,
        minTime: this.config.minTime,
        reservoir: this.config.reservoir,
        reservoirRefreshAmount: this.config.reservoir,
        reservoirRefreshInterval: this.config.reservoirRefreshInterval,
      }));
    }
    return this.limiters.get(tenantId)!;
  }

  async schedule<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const limiter = this.getLimiter(tenantId);
    return limiter.schedule(fn);
  }
}
```

- [ ] **Step 3: Add QueueService to app.module.ts providers**

```typescript
// In AppModule, add:
import { QueueService } from './common/services/queue.service';

@Module({
  providers: [
    {
      provide: QueueService,
      useFactory: () => new QueueService({
        maxConcurrent: parseInt(process.env.QUEUE_MAX_CONCURRENT || '2'),
        minTime: parseInt(process.env.QUEUE_MIN_TIME_MS || '6000'),
        reservoir: parseInt(process.env.QUEUE_RESERVOIR || '10'),
        reservoirRefreshInterval: parseInt(process.env.QUEUE_RESERVOIR_REFRESH_MS || '60000'),
      }),
    },
  ],
  exports: [QueueService],
})
```

- [ ] **Step 4: Run tests**

Run: `cd BE && npx jest src/common/__tests__/queue.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add BE/src/common/services/queue.service.ts BE/src/common/__tests__/queue.service.spec.ts
git commit -m "feat(be): Bottleneck queue service per tenant"
```

---

### Task 1A.15: BE — Logging Interceptor

**Files:**
- Create: `BE/src/common/interceptors/logging.interceptor.ts`
- Create: `BE/src/common/interceptors/tenant.interceptor.ts`
- Test: `BE/src/common/__tests__/logging.interceptor.spec.ts`

- [ ] **Step 1: Write logging interceptor**

```typescript
// BE/src/common/interceptors/logging.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const start = Date.now();
    const requestId = (req as any).requestId || 'unknown';

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(JSON.stringify({
            request_id: requestId,
            tenant_id: (req as any).tenantId,
            method: req.method,
            path: req.path,
            status: context.switchToHttp().getResponse().statusCode,
            latency_ms: Date.now() - start,
            event: 'end',
          }));
        },
        error: (err) => {
          this.logger.error(JSON.stringify({
            request_id: requestId,
            tenant_id: (req as any).tenantId,
            method: req.method,
            path: req.path,
            error_code: err?.response?.error?.code || 'UNKNOWN',
            latency_ms: Date.now() - start,
            event: 'error',
          }));
        },
      })
    );
  }
}
```

- [ ] **Step 2: Write tenant interceptor**

```typescript
// BE/src/common/interceptors/tenant.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    // Auto-generate request ID
    if (!(req as any).requestId) {
      (req as any).requestId = require('uuid').v4();
    }
    return next.handle();
  }
}
```

- [ ] **Step 3: Register in main.ts**

```typescript
app.useGlobalInterceptors(new LoggingInterceptor(), new TenantInterceptor());
```

- [ ] **Step 4: Verify build**

Run: `cd BE && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add BE/src/common/interceptors/
git commit -m "feat(be): logging + tenant interceptors"
```

---

### Task 1A.16: FE — server.ts Cleanup (Remove Gemini)

**Files:**
- Modify: `FE/server.ts`
- Modify: `FE/.env.example`

**Goal:** Remove all Gemini AI code. No API key in FE.

- [ ] **Step 1: Rewrite server.ts — remove Gemini imports and endpoint**

```typescript
// FE/server.ts
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'Bedtime Story Companion' });
  });

  // Vite dev middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FE server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
```

- [ ] **Step 2: Update FE/.env.example**

```env
VITE_BE_URL=http://localhost:3001
```

- [ ] **Step 3: Remove GEMINI_API_KEY from package.json dependencies if `@google/genai` no longer imported**

Check if `@google/genai` is still imported anywhere in FE/src. If not:
```bash
cd FE && npm uninstall @google/genai
```

- [ ] **Step 4: Verify FE builds**

Run: `cd FE && npx tsc --noEmit`
Expected: No type errors (ignore any errors about missing `@google/genai`)

- [ ] **Step 5: Commit**

```bash
git add FE/server.ts FE/.env.example
git commit -m "feat(fe): remove Gemini integration, FE now proxy-only"
```

---

### Task 1A.17: BE — Config Modules

**Files:**
- Create: `BE/src/config/app.config.ts`
- Create: `BE/src/config/engine.config.ts`
- Create: `BE/src/config/rate-limit.config.ts`

- [ ] **Step 1: Write config files**

```typescript
// BE/src/config/app.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  coreDbPath: process.env.CORE_DB_PATH || 'data/core.db',
  localDbPath: process.env.LOCAL_DB_PATH || 'data/local.db',
}));
```

```typescript
// BE/src/config/engine.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('engine', () => ({
  baseUrl: process.env.ENGINE_URL || 'http://localhost:8000',
  timeoutMs: parseInt(process.env.ENGINE_TIMEOUT_MS || '25000', 10),
  retryCount: parseInt(process.env.ENGINE_RETRY_COUNT || '2', 10),
  retryDelayMs: 1000,
}));
```

```typescript
// BE/src/config/rate-limit.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('rateLimit', () => ({
  capacity: parseInt(process.env.RATE_LIMIT_CAPACITY || '10', 10),
  refillRate: parseInt(process.env.RATE_LIMIT_REFILL_SECONDS || '6', 10),
}));
```

- [ ] **Step 2: Register in app.module.ts**

```typescript
import appConfig from './config/app.config';
import engineConfig from './config/engine.config';
import rateLimitConfig from './config/rate-limit.config';

// In ConfigModule.forRoot:
load: [appConfig, engineConfig, rateLimitConfig],
```

- [ ] **Step 3: Verify build**

Run: `cd BE && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add BE/src/config/
git commit -m "feat(be): config modules for app, engine, rate-limit"
```

---

## PHASE 1B: Engine Core (20 tasks)

### Task 1B.1: Scaffold Engine — Python Project

**Files:**
- Create: `Engine/requirements.txt`
- Create: `Engine/.env.example`
- Create: `Engine/Dockerfile`
- Create: `Engine/main.py`
- Create: `Engine/core/__init__.py`

- [ ] **Step 1: Create requirements.txt**

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
pydantic==2.10.0
pydantic-settings==2.6.0
openai==1.55.0
google-genai==1.2.0
httpx==0.28.0
pytest==8.3.0
pytest-asyncio==0.24.0
```

- [ ] **Step 2: Create .env.example**

```
ENGINE_PORT=8000

PRIMARY_LLM=openai
OPENAI_API_KEYS=sk-key1,sk-key2,sk-key3,sk-key4
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOKENS=1024
OPENAI_TEMPERATURE=0.7

FALLBACK_LLM=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
```

- [ ] **Step 3: Create main.py**

```python
# Engine/main.py
from fastapi import FastAPI
import uvicorn

app = FastAPI(title="Bedtime Story Engine")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "Bedtime Story Engine"}

if __name__ == "__main__":
    port = int(os.getenv("ENGINE_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
```

- [ ] **Step 4: Create core/__init__.py**

```python
# Engine/core/__init__.py
```

- [ ] **Step 5: Install dependencies + verify**

Run: `cd Engine && pip install -r requirements.txt`
Run: `cd Engine && python -c "from fastapi import FastAPI; print('OK')"`
Expected: "OK"

- [ ] **Step 6: Commit**

```bash
git add Engine/
git commit -m "feat(engine): scaffold Python FastAPI project"
```

---

### Task 1B.2: Engine — Base LLM Client

**Files:**
- Create: `Engine/core/llm/__init__.py`
- Create: `Engine/core/llm/client.py`
- Test: `Engine/tests/__init__.py`
- Test: `Engine/tests/conftest.py`
- Test: `Engine/tests/test_llm_client.py`

**Interfaces:**
- `BaseLLMClient` abstract class with `async complete(prompt: str, stage: str) -> str`

- [ ] **Step 1: Write test**

```python
# Engine/tests/test_llm_client.py
import pytest
from core.llm.client import BaseLLMClient

class ConcreteClient(BaseLLMClient):
    async def complete(self, prompt: str, stage: str = "") -> str:
        return f"response:{prompt[:10]}"

@pytest.mark.asyncio
async def test_base_client_can_instantiate():
    client = ConcreteClient()
    result = await client.complete("hello world")
    assert result == "response:hello worl"

@pytest.mark.asyncio
async def test_base_client_raises_if_not_implemented():
    with pytest.raises(TypeError):
        # Can't instantiate abstract class without complete()
        class BadClient(BaseLLMClient):
            pass
        BadClient()
```

- [ ] **Step 2: Write BaseLLMClient**

```python
# Engine/core/llm/client.py
from abc import ABC, abstractmethod

class BaseLLMClient(ABC):
    """Abstract base for all LLM providers."""

    @abstractmethod
    async def complete(self, prompt: str, stage: str = "") -> str:
        """
        Send a prompt to the LLM and return the response text.
        
        Args:
            prompt: Full prompt with system + user context
            stage: 'planner', 'writer', 'reviewer', or 'memory_ext'
            
        Returns:
            Raw response text from LLM
        """
        raise NotImplementedError
```

- [ ] **Step 3: Create test conftest**

```python
# Engine/tests/conftest.py
import pytest
import sys
from pathlib import Path

# Add Engine root to path
sys.path.insert(0, str(Path(__file__).parent.parent))
```

- [ ] **Step 4: Run tests**

Run: `cd Engine && python -m pytest tests/test_llm_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Engine/core/llm/client.py Engine/tests/
git commit -m "feat(engine): BaseLLMClient abstract class"
```

---

### Task 1B.3: Engine — OpenAI Client with Round-Robin

**Files:**
- Create: `Engine/core/llm/openai_client.py`
- Test: `Engine/tests/test_openai_client.py`

**Interfaces:**
- `OpenAIClient(BaseLLMClient)` with multi-key round-robin rotation
- Keys from `OPENAI_API_KEYS` env (comma-separated)
- Failure tracking: auto-disable key after 3 consecutive failures
- Retry next key on failure

- [ ] **Step 1: Write the failing test**

```python
# Engine/tests/test_openai_client.py
import pytest
from core.llm.openai_client import OpenAIClient

class TestOpenAIClient:
    def test_load_keys_from_env(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-key1,sk-key2,sk-key3")
        client = OpenAIClient()
        assert len(client.keys) == 3
        assert client.keys[0] == "sk-key1"

    def test_round_robin_rotation(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-key1,sk-key2")
        client = OpenAIClient()
        
        key1, _ = client._get_next_key()
        key2, _ = client._get_next_key()
        key3, _ = client._get_next_key()
        
        assert key1 == "sk-key1"
        assert key2 == "sk-key2"
        assert key3 == "sk-key1"  # wraps around

    def test_key_disabled_after_max_failures(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-key1,sk-key2")
        client = OpenAIClient()
        client.max_failures = 2
        
        # Fail key1 twice
        client._record_failure("sk-key1")
        client._record_failure("sk-key1")
        
        assert client._is_key_disabled("sk-key1") is True

    def test_key_skipped_if_disabled(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-key1,sk-key2")
        client = OpenAIClient()
        client.max_failures = 1
        client._record_failure("sk-key1")
        
        # Should skip key1 and return key2
        key, _ = client._get_next_key()
        assert key == "sk-key2"

    def test_all_keys_exhausted_raises(self, monkeypatch):
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-key1")
        client = OpenAIClient()
        client.max_failures = 1
        client._record_failure("sk-key1")
        
        with pytest.raises(Exception, match="All OpenAI keys exhausted"):
            client._get_next_key()
```

- [ ] **Step 2: Write the implementation**

```python
# Engine/core/llm/openai_client.py
import os
import logging
from typing import Optional
from openai import AsyncOpenAI, RateLimitError, AuthenticationError
from .client import BaseLLMClient

logger = logging.getLogger(__name__)

class AllKeysExhausted(Exception):
    """All OpenAI keys have been disabled."""
    pass

class OpenAIClient(BaseLLMClient):
    def __init__(self, model: str = "gpt-4o-mini", max_tokens: int = 1024, temperature: float = 0.7):
        keys_env = os.getenv("OPENAI_API_KEYS", "")
        self.keys = [k.strip() for k in keys_env.split(",") if k.strip()]
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature
        self._index = 0
        self._key_failures: dict[str, int] = {}
        self.max_failures = 3

    def _record_failure(self, key: str):
        self._key_failures[key] = self._key_failures.get(key, 0) + 1

    def _record_success(self, key: str):
        self._key_failures[key] = 0

    def _is_key_disabled(self, key: str) -> bool:
        return self._key_failures.get(key, 0) >= self.max_failures

    def _get_next_key(self) -> tuple[str, AsyncOpenAI]:
        if not self.keys:
            raise AllKeysExhausted("No OpenAI keys configured")

        for _ in range(len(self.keys)):
            key = self.keys[self._index]
            self._index = (self._index + 1) % len(self.keys)

            if not self._is_key_disabled(key):
                client = AsyncOpenAI(api_key=key)
                return key, client

        raise AllKeysExhausted("All OpenAI keys exhausted")

    async def complete(self, prompt: str, stage: str = "") -> str:
        key = None
        try:
            key, client = self._get_next_key()
            logger.info(f"OpenAI call with key ...{key[-4:]} stage={stage}")
            
            response = await client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=self.max_tokens,
                temperature=self.temperature,
            )
            
            self._record_success(key)
            return response.choices[0].message.content or ""
            
        except (RateLimitError, AuthenticationError) as e:
            if key:
                self._record_failure(key)
                logger.warning(f"OpenAI key ...{key[-4:]} failed: {e}. Trying next key...")
                if not self._is_key_disabled(key):
                    self._record_failure(key)  # ensure disabled
            # Retry with next key
            return await self.complete(prompt, stage)
        except Exception as e:
            logger.error(f"OpenAI unexpected error: {e}")
            raise
```

- [ ] **Step 3: Run tests**

Run: `cd Engine && python -m pytest tests/test_openai_client.py -v`
Expected: PASS (5 tests)

- [ ] **Step 4: Commit**

```bash
git add Engine/core/llm/openai_client.py Engine/tests/test_openai_client.py
git commit -m "feat(engine): OpenAI client with round-robin multi-key rotation"
```

---

### Task 1B.4: Engine — Gemini Client

**Files:**
- Create: `Engine/core/llm/gemini_client.py`
- Test: `Engine/tests/test_gemini_client.py` (basic mock test)

- [ ] **Step 1: Write test**

```python
# Engine/tests/test_gemini_client.py
import pytest
from core.llm.gemini_client import GeminiClient

class TestGeminiClient:
    def test_init_with_env_key(self, monkeypatch):
        monkeypatch.setenv("GEMINI_API_KEY", "test-key-abc")
        monkeypatch.setenv("GEMINI_MODEL", "gemini-2.0-flash")
        client = GeminiClient()
        assert client.api_key == "test-key-abc"
        assert client.model == "gemini-2.0-flash"

    def test_init_raises_without_key(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        with pytest.raises(ValueError, match="GEMINI_API_KEY"):
            GeminiClient()
```

- [ ] **Step 2: Write implementation**

```python
# Engine/core/llm/gemini_client.py
import os
import logging
from .client import BaseLLMClient

logger = logging.getLogger(__name__)

class GeminiClient(BaseLLMClient):
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY", "")
        self.model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
        self.max_tokens = int(os.getenv("OPENAI_MAX_TOKENS", "1024"))
        self.temperature = float(os.getenv("OPENAI_TEMPERATURE", "0.7"))
        
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not configured")

    async def complete(self, prompt: str, stage: str = "") -> str:
        try:
            from google import genai
            from google.genai import types as genai_types
            
            client = genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    max_output_tokens=self.max_tokens,
                    temperature=self.temperature,
                ),
            )
            return response.text or ""
            
        except Exception as e:
            logger.error(f"Gemini API error stage={stage}: {e}")
            raise
```

- [ ] **Step 3: Run tests**

Run: `cd Engine && python -m pytest tests/test_gemini_client.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add Engine/core/llm/gemini_client.py Engine/tests/test_gemini_client.py
git commit -m "feat(engine): Gemini client"
```

---

### Task 1B.5: Engine — Custom LLM Client

**Files:**
- Create: `Engine/core/llm/custom_client.py`
- Test: `Engine/tests/test_custom_client.py`

- [ ] **Step 1: Write test**

```python
# Engine/tests/test_custom_client.py
import pytest
from core.llm.custom_client import CustomClient

class TestCustomClient:
    def test_init_with_env(self, monkeypatch):
        monkeypatch.setenv("CUSTOM_LLM_URL", "https://my-llm.example.com/v1/chat/completions")
        monkeypatch.setenv("CUSTOM_LLM_API_KEY", "ck-custom-key")
        monkeypatch.setenv("CUSTOM_LLM_MODEL", "my-model")
        client = CustomClient()
        assert client.api_url == "https://my-llm.example.com/v1/chat/completions"
        assert client.api_key == "ck-custom-key"
        assert client.model == "my-model"

    def test_init_raises_without_url(self, monkeypatch):
        monkeypatch.delenv("CUSTOM_LLM_URL", raising=False)
        with pytest.raises(ValueError, match="CUSTOM_LLM_URL"):
            CustomClient()
```

- [ ] **Step 2: Write implementation**

```python
# Engine/core/llm/custom_client.py
import os
import logging
import httpx
from .client import BaseLLMClient

logger = logging.getLogger(__name__)

class CustomClient(BaseLLMClient):
    def __init__(self):
        self.api_url = os.getenv("CUSTOM_LLM_URL", "")
        self.api_key = os.getenv("CUSTOM_LLM_API_KEY", "")
        self.model = os.getenv("CUSTOM_LLM_MODEL", "default")

        if not self.api_url:
            raise ValueError("CUSTOM_LLM_URL not configured")

    async def complete(self, prompt: str, stage: str = "") -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": int(os.getenv("OPENAI_MAX_TOKENS", "1024")),
            "temperature": float(os.getenv("OPENAI_TEMPERATURE", "0.7")),
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(self.api_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            
            # Try common response formats
            if "choices" in data:
                return data["choices"][0]["message"]["content"]
            if "response" in data:
                return data["response"]
            return str(data)
```

- [ ] **Step 3: Run tests**

Run: `cd Engine && python -m pytest tests/test_custom_client.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add Engine/core/llm/custom_client.py Engine/tests/test_custom_client.py
git commit -m "feat(engine): Custom LLM client (OpenAI-compatible)"
```

---

### Task 1B.6: Engine — LLM Router (Provider Fallback)

**Files:**
- Create: `Engine/core/llm/router.py`
- Test: `Engine/tests/test_llm_router.py`

**Interfaces:**
- `LLMRouter` with fallback chain: primary → fallback → custom
- Takes stage name to route appropriate provider
- Raises `FallbackTriggered` if all fail

- [ ] **Step 1: Write tests**

```python
# Engine/tests/test_llm_router.py
import pytest
from core.llm.router import LLMRouter, FallbackTriggered
from core.llm.client import BaseLLMClient

class MockClient(BaseLLMClient):
    def __init__(self, name: str, should_fail: bool = False):
        self.name = name
        self.should_fail = should_fail
    async def complete(self, prompt: str, stage: str = "") -> str:
        if self.should_fail:
            raise Exception(f"{self.name} failed")
        return f"{self.name}:{prompt[:20]}"

class TestLLMRouter:
    def test_successful_primary(self):
        router = LLMRouter()
        router.providers = {"primary": MockClient("primary")}
        router.fallback_order = ["primary"]
        
        result = router.complete("test prompt")
        assert result == "primary:test prompt"

    def test_fallback_on_failure(self):
        router = LLMRouter()
        router.providers = {
            "primary": MockClient("primary", should_fail=True),
            "fallback": MockClient("fallback"),
        }
        router.fallback_order = ["primary", "fallback"]
        
        result = router.complete("test prompt")
        assert result == "fallback:test prompt"

    def test_all_providers_fail(self):
        router = LLMRouter()
        router.providers = {
            "p1": MockClient("p1", should_fail=True),
        }
        router.fallback_order = ["p1"]
        
        with pytest.raises(FallbackTriggered):
            router.complete("test")

    def test_loads_from_env(self, monkeypatch):
        monkeypatch.setenv("PRIMARY_LLM", "openai")
        monkeypatch.setenv("FALLBACK_LLM", "gemini")
        monkeypatch.setenv("OPENAI_API_KEYS", "sk-test")
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        
        router = LLMRouter()
        assert "openai" in router.providers
        assert "gemini" in router.providers
```

- [ ] **Step 2: Write implementation**

```python
# Engine/core/llm/router.py
import os
import logging
from .client import BaseLLMClient
from .openai_client import OpenAIClient, AllKeysExhausted
from .gemini_client import GeminiClient
from .custom_client import CustomClient

logger = logging.getLogger(__name__)

class FallbackTriggered(Exception):
    """All providers in the fallback chain failed."""
    pass

class LLMRouter:
    def __init__(self):
        self.providers: dict[str, BaseLLMClient] = {}
        self.fallback_order: list[str] = []
        self._load_providers()

    def _load_providers(self):
        """Load providers from environment configuration."""
        primary = os.getenv("PRIMARY_LLM", "").strip()
        fallback = os.getenv("FALLBACK_LLM", "").strip()
        custom_url = os.getenv("CUSTOM_LLM_URL", "").strip()

        order = []
        
        if primary == "openai":
            self.providers["openai"] = OpenAIClient()
            order.append("openai")
        
        if fallback == "gemini":
            try:
                self.providers["gemini"] = GeminiClient()
                order.append("gemini")
            except ValueError as e:
                logger.warning(f"Gemini not available: {e}")

        if custom_url:
            try:
                self.providers["custom"] = CustomClient()
                order.append("custom")
            except ValueError as e:
                logger.warning(f"Custom LLM not available: {e}")

        self.fallback_order = order

    async def complete(self, prompt: str, stage: str = "") -> str:
        last_error = None
        for provider_name in self.fallback_order:
            try:
                provider = self.providers[provider_name]
                logger.info(f"LLM call: provider={provider_name} stage={stage}")
                return await provider.complete(prompt, stage)
            except AllKeysExhausted as e:
                last_error = str(e)
                logger.warning(f"Provider {provider_name} keys exhausted, trying fallback")
                continue
            except Exception as e:
                last_error = str(e)
                logger.warning(f"Provider {provider_name} failed: {e}, trying fallback")
                continue

        raise FallbackTriggered(f"All providers failed: {last_error}")
```

- [ ] **Step 3: Run tests**

Run: `cd Engine && python -m pytest tests/test_llm_router.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add Engine/core/llm/router.py Engine/tests/test_llm_router.py
git commit -m "feat(engine): LLMRouter with provider fallback chain"
```

---

### Task 1B.7: Engine — Prompt Registry

**Files:**
- Create: `Engine/core/prompts/__init__.py`
- Create: `Engine/core/prompts/registry.py`
- Create: `Engine/core/prompts/templates/system/default.txt`
- Create: `Engine/core/prompts/templates/developer/3-4.txt`
- Create: `Engine/core/prompts/templates/developer/5-6.txt`
- Create: `Engine/core/prompts/templates/user/default.txt`
- Test: `Engine/tests/test_prompt_registry.py`

**Interfaces:**
- `PromptRegistry` with `load(age: int) -> dict[str, str]`
- Returns `{ system, developer, user }` prompt strings

- [ ] **Step 1: Write test**

```python
# Engine/tests/test_prompt_registry.py
import pytest
from core.prompts.registry import PromptRegistry

class TestPromptRegistry:
    def test_load_system_prompt(self):
        registry = PromptRegistry()
        prompt = registry.load_system()
        assert "Vietnamese" in prompt
        assert "bedtime" in prompt.lower()

    def test_load_developer_prompt_3_4(self):
        registry = PromptRegistry()
        prompt = registry.load_developer(3)
        assert prompt is not None
        assert len(prompt) > 50

    def test_load_developer_prompt_5_6(self):
        registry = PromptRegistry()
        prompt = registry.load_developer(5)
        assert prompt is not None
        assert len(prompt) > 50

    def test_load_developer_falls_back_to_3_4(self):
        registry = PromptRegistry()
        prompt = registry.load_developer(4)  # no 4.txt, should use 3-4
        assert prompt is not None

    def test_load_user_prompt(self):
        registry = PromptRegistry()
        prompt = registry.load_user()
        assert "Child information" in prompt

    def test_assembly(self):
        registry = PromptRegistry()
        prompts = registry.assemble(age=4, data={"childName": "An", "theme": "rồng"})
        assert "system" in prompts
        assert "developer" in prompts
        assert "user" in prompts
        assert "An" in prompts["user"]
        assert "rồng" in prompts["user"]
```

- [ ] **Step 2: Create prompt template files**

System prompt (English instructions):
```
You are a Vietnamese children's bedtime storyteller for ages 3-6.
Tone: gentle, warm, rich in imagery.
Language: ALL story content MUST be in Vietnamese — pure, simple,
beautiful Vietnamese suitable for young children.

Safety: STRICTLY FORBIDDEN — no violence, blood, horror,
sexual content, adult themes, profanity, discrimination,
politics, religion, or disguised advertising.

Output format: Respond ONLY with valid JSON following the
requested schema. Never add text outside the JSON block.
```

Developer prompt for ages 3-4:
```
Storytelling strategy for age 3-4:
- VERY simple sentences, 3-5 words per sentence
- Repeat key phrases for comfort
- Short story: 150-250 words
- Lots of sound words (onomatopoeia like "tích tắc", "ào ào", "róc rách")
- Main character is the child
- Simple gentle conflict easily resolved
- The FINAL STORY must be in Vietnamese (thuần Việt)
```

Developer prompt for ages 5-6:
```
Storytelling strategy for age 5-6:
- Richer vocabulary but still clear
- Story length: 300-500 words
- Mild conflict with a clear lesson
- 2-3 interaction points for parent to ask child
- Vivid descriptions using Vietnamese từ láy
- Main character is the child
- Ending with a warm moral lesson
- The FINAL STORY must be in Vietnamese (thuần Việt)
```

User prompt template:
```
Child information:
- Name: {childName}
- Age: {age}
- Theme: {theme}
- Lesson goal: {goal}
- Mood: {mood}
- Memory context: {memories}

Generate a story following the structure defined in the system prompt.
The story itself MUST be in Vietnamese, thuần Việt style.
```

- [ ] **Step 3: Write PromptRegistry**

```python
# Engine/core/prompts/registry.py
import os
from pathlib import Path

TEMPLATES_DIR = Path(__file__).parent / "templates"

class PromptRegistry:
    def __init__(self):
        self.templates_dir = TEMPLATES_DIR

    def load_system(self) -> str:
        path = self.templates_dir / "system" / "default.txt"
        return path.read_text(encoding="utf-8")

    def load_developer(self, age: int) -> str:
        """Load age-appropriate developer prompt."""
        # Try exact age, then age group fallback
        candidates = [
            f"{age}.txt",
            "3-4.txt" if age <= 4 else "5-6.txt",
        ]
        for name in candidates:
            path = self.templates_dir / "developer" / name
            if path.exists():
                return path.read_text(encoding="utf-8")
        # Ultimate fallback
        return self.load_developer(3)

    def load_user(self) -> str:
        path = self.templates_dir / "user" / "default.txt"
        return path.read_text(encoding="utf-8")

    def assemble(self, age: int, data: dict) -> dict[str, str]:
        """Build all three prompt tiers."""
        user_template = self.load_user()
        user_prompt = user_template.format(**data)
        
        return {
            "system": self.load_system(),
            "developer": self.load_developer(age),
            "user": user_prompt,
        }
```

- [ ] **Step 4: Run tests**

Run: `cd Engine && python -m pytest tests/test_prompt_registry.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Engine/core/prompts/
git commit -m "feat(engine): prompt registry + template files"
```

---

### Task 1B.8: Engine — Output Validator

**Files:**
- Create: `Engine/core/validator.py`
- Test: `Engine/tests/test_validator.py`

- [ ] **Step 1: Write tests**

```python
# Engine/tests/test_validator.py
import pytest
from core.validator import OutputValidator, ValidationResult

class TestOutputValidator:
    def test_valid_planner_output(self):
        validator = OutputValidator()
        data = {
            "title": "Câu chuyện của bé",
            "story_structure": {
                "opening": "Mở đầu",
                "sections": [
                    {"order": 0, "type": "opening", "description": "..."},
                    {"order": 1, "type": "resolution", "description": "..."},
                ],
                "moral": "Bài học",
                "key_characters": ["Bé An"]
            }
        }
        result = validator.validate_planner(data)
        assert result.valid is True
        assert len(result.errors) == 0

    def test_invalid_planner_missing_title(self):
        validator = OutputValidator()
        data = {"story_structure": {"sections": []}}
        result = validator.validate_planner(data)
        assert result.valid is False

    def test_valid_writer_output(self):
        validator = OutputValidator()
        data = {
            "title": "Truyện hay",
            "content": [
                {"type": "opening", "text": "Nội dung tiếng Việt", "order": 0},
                {"type": "interaction", "text": "Hỏi bé điều gì", "prompt": "Con nghĩ sao?", "order": 1},
                {"type": "resolution", "text": "Kết thúc", "order": 2},
            ],
            "word_count": 200
        }
        result = validator.validate_writer(data)
        assert result.valid is True

    def test_writer_too_short(self):
        validator = OutputValidator()
        data = {
            "title": "Truyện",
            "content": [{"type": "opening", "text": "Ngắn", "order": 0}],
            "word_count": 20
        }
        result = validator.validate_writer(data)
        assert result.valid is False
        assert any("word_count" in e for e in result.errors)

    def test_safety_blocklist(self):
        validator = OutputValidator()
        assert validator.has_blocklist_word("nội dung bình thường") is False
    
    def test_auto_fix_minor_issues(self):
        validator = OutputValidator()
        data = {
            "title": "  Title có space  ",
            "content": [{"type": "opening", "text": "  Text thừa space  ", "order": 0}],
            "word_count": 100
        }
        result = validator.validate_writer(data)
        assert result.valid is True  # auto-fixed
```

- [ ] **Step 2: Write implementation**

```python
# Engine/core/validator.py
import re
from dataclasses import dataclass, field
from typing import Any

@dataclass
class ValidationResult:
    valid: bool
    errors: list[str] = field(default_factory=list)
    fixed_data: dict | None = None

BLOCKLIST_WORDS = [
    "sex", "porn", "violence", "blood", "kill", "death",
    "weapon", "gun", "drug", "suicide", "demon", "devil",
]

class OutputValidator:
    def validate_planner(self, data: dict) -> ValidationResult:
        errors = []
        
        if not data.get("title"):
            errors.append("title is required")
        
        structure = data.get("story_structure")
        if not structure:
            errors.append("story_structure is required")
        else:
            sections = structure.get("sections", [])
            if len(sections) < 2:
                errors.append("at least 2 sections required")
            if not structure.get("moral"):
                errors.append("moral is required")
        
        return ValidationResult(valid=len(errors) == 0, errors=errors)

    def validate_writer(self, data: dict) -> ValidationResult:
        errors = []
        data = self._auto_fix(data)
        
        if not data.get("title"):
            errors.append("title is required")
        
        content = data.get("content", [])
        if not content:
            errors.append("content is required")
        else:
            types = [s.get("type") for s in content]
            if "interaction" not in types:
                errors.append("at least 1 interaction section required")
            if not any("prompt" in s for s in content if s.get("type") == "interaction"):
                errors.append("interaction must have prompt")
        
        if data.get("word_count", 0) < 100:
            errors.append(f"word_count too low: {data.get('word_count')}")
        
        # Safety check
        full_text = str(data)
        if self.has_blocklist_word(full_text):
            errors.append("content contains blocked words")
        
        return ValidationResult(valid=len(errors) == 0, errors=errors, fixed_data=data)

    def has_blocklist_word(self, text: str) -> bool:
        text_lower = text.lower()
        return any(word in text_lower for word in BLOCKLIST_WORDS)

    def _auto_fix(self, data: dict) -> dict:
        """Fix minor formatting issues."""
        fixed = dict(data)
        if fixed.get("title"):
            fixed["title"] = fixed["title"].strip()
        content = fixed.get("content", [])
        if content:
            for section in content:
                if "text" in section:
                    section["text"] = section["text"].strip()
        return fixed
```

- [ ] **Step 3: Run tests**

Run: `cd Engine && python -m pytest tests/test_validator.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add Engine/core/validator.py Engine/tests/test_validator.py
git commit -m "feat(engine): output validator with safety check"
```

---

### Task 1B.9: Engine — Pipeline (Planner → Writer → Reviewer)

**Files:**
- Create: `Engine/core/pipeline.py`
- Test: `Engine/tests/test_pipeline.py`

**Interfaces:**
- `StoryPipeline` with `run(prompts: dict[str,str]) -> PipelineResult`
- Calls Planner → Writer → Reviewer sequentially
- Handles retry + fallback

- [ ] **Step 1: Write tests**

```python
# Engine/tests/test_pipeline.py
import pytest
from core.pipeline import StoryPipeline
from core.llm.client import BaseLLMClient

class MockRouter:
    def __init__(self, responses: dict):
        self.responses = responses
        self.call_count = 0
        self.prompts = []
    
    async def complete(self, prompt: str, stage: str = ""):
        self.call_count += 1
        self.prompts.append(stage)
        return self.responses.get(stage, "{}")

class TestStoryPipeline:
    def test_happy_path(self):
        router = MockRouter({
            "planner": '{"title": "Test", "story_structure": {"opening": "...", "sections": [{"order": 0, "type": "opening", "description": "..."}], "moral": "good", "key_characters": ["An"]}}',
            "writer": '{"title": "Test", "content": [{"type": "opening", "text": "Xin chào", "order": 0}, {"type": "interaction", "text": "Hỏi", "prompt": "Con nghĩ?", "order": 1}, {"type": "resolution", "text": "Hết", "order": 2}], "word_count": 150}',
            "reviewer": '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}',
        })
        pipeline = StoryPipeline(router)
        
        result = pipeline.run({})
        assert result.success is True
        assert result.safety_verdict == "APPROVED"
        assert result.title == "Test"

    def test_writer_retry_on_reject(self):
        router = MockRouter({
            "planner": '{"title": "Test", "story_structure": {"opening": "...", "sections": [{"order": 0, "type": "opening", "description": "..."}], "moral": "good", "key_characters": ["An"]}}',
            "writer_0": '{"title": "Test", "content": [{"type": "opening", "text": "Xin chào", "order": 0}], "word_count": 150}',
            "writer_1": '{"title": "Test", "content": [{"type": "opening", "text": "Xin chào", "order": 0}, {"type": "interaction", "text": "Hỏi", "prompt": "Con nghĩ?", "order": 1}, {"type": "resolution", "text": "Hết", "order": 2}], "word_count": 150}',
            "reviewer": '{"safety_verdict": "APPROVED", "issues": [], "quality_score": 4}',
        })
        pipeline = StoryPipeline(router)
        # Track which writer call was which
        pipeline._call_llm = lambda p, s: router.complete(p, f"{s}_{router.call_count}" if s == "writer" else s)
        
        result = pipeline.run({})
        assert result.success is True

    def test_fallback_on_all_failures(self):
        class FailingRouter:
            async def complete(self, prompt, stage=""):
                raise Exception("LLM down")
        
        pipeline = StoryPipeline(FailingRouter())
        result = pipeline.run({})
        assert result.success is True  # fallback story
        assert result.is_fallback is True
        assert "bất ngờ" in result.title
```

- [ ] **Step 2: Write pipeline**

```python
# Engine/core/pipeline.py
import json
import logging
from dataclasses import dataclass, field
from typing import Any
from .validator import OutputValidator
from .llm.router import LLMRouter

logger = logging.getLogger(__name__)

@dataclass
class PipelineResult:
    success: bool
    title: str = ""
    content: list[dict] = field(default_factory=list)
    safety_verdict: str = "PENDING"
    llm_calls: int = 0
    is_fallback: bool = False
    error: str = ""

FALLBACK_STORY = {
    "title": "Câu chuyện bất ngờ",
    "content": [{
        "type": "opening", "text": "Xin lỗi bạn nhỏ, hôm nay máy kể chuyện hơi mệt một chút. Bạn hãy thử lại sau nhé! Hãy tưởng tượng một câu chuyện thật đẹp trước khi ngủ nào.", "order": 0
    }],
    "word_count": 30,
}

class StoryPipeline:
    def __init__(self, router: LLMRouter):
        self.router = router
        self.validator = OutputValidator()
        self.llm_calls = 0

    def _count_call(self):
        self.llm_calls += 1

    async def _call_llm(self, prompt: str, stage: str) -> str:
        self._count_call()
        return await self.router.complete(prompt, stage)

    async def run(self, prompts: dict[str, str]) -> PipelineResult:
        try:
            # Stage 1: Planner
            planner_raw = await self._call_retry(
                prompts, "planner", max_retries=2,
                validator=lambda d: self.validator.validate_planner(d)
            )
            if not planner_raw:
                return self._fallback("Planner failed after retries")
            
            outline = json.loads(planner_raw)
            
            # Stage 2: Writer
            writer_prompt = self._build_writer_prompt(prompts, outline)
            writer_raw = await self._call_retry(
                {"system": prompts["system"], "user": writer_prompt}, "writer", max_retries=2,
                validator=lambda d: self.validator.validate_writer(d)
            )
            if not writer_raw:
                return self._fallback("Writer failed after retries")
            
            story = json.loads(writer_raw)
            
            # Stage 3: Reviewer
            review = await self._review_story(story)
            if review.get("safety_verdict") == "REJECTED":
                # Retry writer once
                logger.warning("Story REJECTED, retrying writer...")
                writer_raw = await self._call_retry(
                    {"system": prompts["system"], "user": writer_prompt}, "writer", max_retries=1,
                    validator=lambda d: self.validator.validate_writer(d)
                )
                if writer_raw:
                    story = json.loads(writer_raw)
                    review = await self._review_story(story)
            
            verdict = review.get("safety_verdict", "FLAGGED")
            if verdict == "REJECTED":
                return self._fallback("Story still rejected after retry")
            
            return PipelineResult(
                success=True,
                title=story.get("title", outline.get("title", "")),
                content=story.get("content", []),
                safety_verdict=verdict,
                llm_calls=self.llm_calls,
            )
            
        except Exception as e:
            logger.error(f"Pipeline failed: {e}")
            return self._fallback(str(e))

    async def _call_retry(self, prompts: dict, stage: str, max_retries: int, validator) -> str | None:
        for attempt in range(max_retries + 1):
            try:
                combined = "\n\n".join([prompts.get("system", ""), prompts.get("developer", ""), prompts.get("user", "")])
                raw = await self._call_llm(combined, stage)
                data = json.loads(raw)
                result = validator(data)
                if result.valid:
                    return json.dumps(result.fixed_data or data)
                else:
                    logger.warning(f"{stage} validation failed attempt {attempt}: {result.errors}")
            except Exception as e:
                logger.warning(f"{stage} attempt {attempt} error: {e}")
        return None

    def _build_writer_prompt(self, prompts: dict, outline: dict) -> str:
        return f"System: {prompts.get('system', '')}\n\nOutline: {json.dumps(outline, ensure_ascii=False)}\n\n{prompts.get('user', '')}"

    async def _review_story(self, story: dict) -> dict:
        review_prompt = f"Review this children's story for safety and quality:\n{json.dumps(story, ensure_ascii=False)}\n\nReturn verdict as JSON: safety_verdict (APPROVED/REJECTED/FLAGGED), issues list, quality_score (1-5)"
        raw = await self._call_llm(review_prompt, "reviewer")
        try:
            return json.loads(raw)
        except:
            return {"safety_verdict": "FLAGGED", "issues": [{"type": "format", "severity": "low", "detail": "Cannot parse review"}], "quality_score": 3}

    def _fallback(self, reason: str) -> PipelineResult:
        return PipelineResult(
            success=True,
            title=FALLBACK_STORY["title"],
            content=FALLBACK_STORY["content"],
            safety_verdict="FALLBACK",
            llm_calls=self.llm_calls,
            is_fallback=True,
            error=reason,
        )
```

- [ ] **Step 3: Run tests**

Run: `cd Engine && python -m pytest tests/test_pipeline.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add Engine/core/pipeline.py Engine/tests/test_pipeline.py
git commit -m "feat(engine): story pipeline (planner/writer/reviewer) with retry"
```

---

### Task 1B.10: Engine — Memory Extractor

**Files:**
- Create: `Engine/core/memory_extractor.py`
- Test: `Engine/tests/test_memory_extractor.py`

- [ ] **Step 1: Write test**

```python
# Engine/tests/test_memory_extractor.py
import pytest
from core.memory_extractor import MemoryExtractor

class MockRouter:
    async def complete(self, prompt, stage=""):
        return '{"memories": [{"type": "interest", "key": "favorite_theme", "value": "rồng", "confidence": 0.8, "source": "..."}]}'

class TestMemoryExtractor:
    def test_extract_memories(self):
        extractor = MemoryExtractor(MockRouter())
        result = extractor.extract({"title": "Test"}, "vi")
        assert len(result) > 0
        assert result[0]["type"] == "interest"
        assert result[0]["confidence"] >= 0.3

    def test_filter_low_confidence(self):
        class LowConfRouter:
            async def complete(self, prompt, stage=""):
                return '{"memories": [{"type": "interest", "key": "bad", "value": "low", "confidence": 0.1, "source": "..."}]}'
        
        extractor = MemoryExtractor(LowConfRouter())
        result = extractor.extract({"title": "Test"}, "vi")
        assert len(result) == 0  # filtered out

    def test_extractor_skip_if_fallback(self):
        extractor = MemoryExtractor(MockRouter())
        result = extractor.extract({"title": "Test"}, "vi", is_fallback=True)
        assert len(result) == 0  # skip extraction for fallback
```

- [ ] **Step 2: Write implementation**

```python
# Engine/core/memory_extractor.py
import json
import logging
from .llm.router import LLMRouter

logger = logging.getLogger(__name__)

class MemoryExtractor:
    def __init__(self, router: LLMRouter):
        self.router = router

    def extract(self, story: dict, language: str, is_fallback: bool = False) -> list[dict]:
        """Extract memories from final story content."""
        if is_fallback:
            return []
        
        prompt = (
            f"Extract personalized memory items from this children's story.\n"
            f"Story: {json.dumps(story, ensure_ascii=False)}\n\n"
            f"Return JSON: memories array with type (interest/character/theme/feedback), "
            f"key, value (in Vietnamese), confidence (0-1), source text.\n"
            f"Only include memories with confidence >= 0.3."
        )
        
        try:
            import asyncio
            raw = asyncio.run(self.router.complete(prompt, "memory_ext"))
            data = json.loads(raw)
            memories = data.get("memories", [])
            # Filter low confidence
            filtered = [m for m in memories if m.get("confidence", 0) >= 0.3]
            logger.info(f"Extracted {len(filtered)} memories from story")
            return filtered
        except Exception as e:
            logger.warning(f"Memory extraction failed: {e}")
            return []
```

- [ ] **Step 3: Run tests**

Run: `cd Engine && python -m pytest tests/test_memory_extractor.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add Engine/core/memory_extractor.py Engine/tests/test_memory_extractor.py
git commit -m "feat(engine): memory extractor with confidence filter"
```

---

## PHASE 1C: Integration (10 tasks)

### Task 1C.1: Engine — Orchestrator (Full Pipeline)

**Files:**
- Create: `Engine/core/orchestrator.py`
- Test: `Engine/tests/test_orchestrator.py`

**Interfaces:**
- `StoryOrchestrator.generate(data: dict) -> dict` — calls prompt assembly → pipeline → memory extract

- [ ] **Step 1: Write test**

```python
# Engine/tests/test_orchestrator.py
import pytest
from core.orchestrator import StoryOrchestrator

class TestOrchestrator:
    def test_orchestrator_returns_full_response(self):
        orchestrator = StoryOrchestrator()
        # Use mock data that won't hit real LLM
        result = orchestrator.generate({
            "child_name": "An",
            "age": 4,
            "theme": "rồng",
            "language": "vi",
        })
        assert "title" in result
        assert "content" in result
        assert "safety_status" in result
        assert "llm_calls" in result
```

- [ ] **Step 2: Write implementation**

```python
# Engine/core/orchestrator.py
import json
import logging
import time
from .prompts.registry import PromptRegistry
from .pipeline import StoryPipeline
from .memory_extractor import MemoryExtractor
from .llm.router import LLMRouter

logger = logging.getLogger(__name__)

class StoryOrchestrator:
    def __init__(self):
        self.registry = PromptRegistry()
        self.router = LLMRouter()
        self.pipeline = StoryPipeline(self.router)
        self.extractor = MemoryExtractor(self.router)

    def generate(self, data: dict) -> dict:
        start = time.time()
        
        # 1. Assemble prompts
        prompts = self.registry.assemble(age=data.get("age", 4), data={
            "childName": data.get("child_name", "Bé"),
            "age": str(data.get("age", 4)),
            "theme": data.get("theme", "phiêu lưu"),
            "goal": data.get("goal", ""),
            "mood": data.get("mood", "vui vẻ"),
            "memories": json.dumps(data.get("memories", []), ensure_ascii=False),
        })
        
        # 2. Run pipeline
        import asyncio
        result = asyncio.run(self.pipeline.run(prompts))
        
        # 3. Extract memories
        memories = []
        if result.success and not result.is_fallback:
            story_data = {"title": result.title, "content": result.content}
            memories = asyncio.run(
                self.extractor.extract(story_data, data.get("language", "vi"), is_fallback=result.is_fallback)
            )
        
        elapsed = int((time.time() - start) * 1000)
        
        # 4. Build response
        return {
            "request_id": data.get("request_id", ""),
            "title": result.title,
            "content": result.content,
            "safety_status": result.safety_verdict,
            "memories": memories,
            "llm_calls": result.llm_calls,
            "word_count": sum(len(s.get("text", "").split()) for s in result.content),
            "is_fallback": result.is_fallback,
            "latency_ms": elapsed,
            "error": result.error,
        }
```

- [ ] **Step 3: Run tests**

Run: `cd Engine && python -m pytest tests/test_orchestrator.py -v`
Expected: PASS (may be slow if hitting real LLM — use mock)

- [ ] **Step 4: Commit**

```bash
git add Engine/core/orchestrator.py Engine/tests/test_orchestrator.py
git commit -m "feat(engine): StoryOrchestrator assembling full pipeline"
```

---

### Task 1C.2: Engine — /generate Endpoint

**Files:**
- Modify: `Engine/main.py`
- Test: via curl / integration test

- [ ] **Step 1: Add /generate endpoint to main.py**

```python
# Engine/main.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional
import uvicorn
import os

from core.orchestrator import StoryOrchestrator

app = FastAPI(title="Bedtime Story Engine")
orchestrator = StoryOrchestrator()

class GenerateRequest(BaseModel):
    child_name: str
    age: int
    theme: str
    goal: Optional[str] = ""
    mood: Optional[str] = "vui vẻ"
    language: Optional[str] = "vi"
    memories: Optional[list] = []
    recent_stories: Optional[list] = []

class GenerateResponse(BaseModel):
    request_id: str = ""
    title: str
    content: list
    safety_status: str
    memories: list = []
    llm_calls: int = 0
    word_count: int = 0
    is_fallback: bool = False
    latency_ms: int = 0
    error: str = ""

@app.get("/health")
async def health():
    return {"status": "ok", "service": "Bedtime Story Engine"}

@app.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    result = orchestrator.generate(req.model_dump())
    return GenerateResponse(**result)

if __name__ == "__main__":
    port = int(os.getenv("ENGINE_PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
```

- [ ] **Step 2: Test endpoint**

Run: `cd Engine && python -m uvicorn main:app --port 8000` (run in background)

Run: `curl -X POST http://localhost:8000/generate -H "Content-Type: application/json" -d '{"child_name":"An","age":4,"theme":"rồng"}'`

Expected: Returns JSON with title, content, safety_status

- [ ] **Step 3: Commit**

```bash
git add Engine/main.py
git commit -m "feat(engine): POST /generate endpoint"
```

---

### Task 1C.3: BE — ChildProfile Entity + Module

**Files:**
- Create: `BE/src/modules/child/entities/child-profile.entity.ts`
- Create: `BE/src/modules/child/child.module.ts`
- Create: `BE/src/modules/child/child.service.ts`
- Create: `BE/src/modules/child/child.controller.ts`
- Create: `BE/src/modules/child/dto/child-profile.dto.ts`
- Test: `BE/src/modules/child/__tests__/child.service.spec.ts`

**Interfaces:**
- `getOrCreate(tenantId, dto) → ChildProfile`
- `findByTenant(tenantId) → ChildProfile[]`

- [ ] **Step 1: Write ChildProfile entity**

```typescript
// BE/src/modules/child/entities/child-profile.entity.ts
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('child_profiles')
export class ChildProfile {
  @PrimaryColumn({ name: 'child_id', type: 'text' })
  childId!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  tenantId!: string;

  @Column({ name: 'child_name', type: 'text' })
  childName!: string;

  @Column({ name: 'age', type: 'integer' })
  age!: number;

  @Column({ name: 'interests', type: 'text', nullable: true })
  interests?: string;

  @Column({ name: 'preferred_characters', type: 'text', nullable: true })
  preferredCharacters?: string;

  @Column({ name: 'bedtime_goal', type: 'text', nullable: true })
  bedtimeGoal?: string;

  @Column({ name: 'language', type: 'text', default: 'vi' })
  language!: string;

  @Column({ name: 'is_active', type: 'integer', default: 1 })
  isActive!: number;

  @Column({ name: 'created_at', type: 'text', default: () => "datetime('now')" })
  createdAt?: string;

  @Column({ name: 'updated_at', type: 'text', default: () => "datetime('now')" })
  updatedAt?: string;
}
```

- [ ] **Step 2: Write service + controller + module** (following same pattern as Tenant module)

- [ ] **Step 3: Write tests**

- [ ] **Step 4: Commit**

---

### Task 1C.4: BE — Story + StorySection Entities (local.db)

**Files:**
- Create: `BE/src/modules/story/entities/story.entity.ts`
- Create: `BE/src/modules/story/entities/story-section.entity.ts`

**Interfaces:**
- Maps to `local.db` — user-visible schema

- [ ] **Step 1: Write Story entity**

- [ ] **Step 2: Write StorySection entity**

- [ ] **Step 3: Register in local datasource**

- [ ] **Step 4: Commit**

---

### Task 1C.5: BE — MemoryItem Entity (local.db)

**Files:**
- Create: `BE/src/modules/memory/entities/memory-item.entity.ts`

- [ ] **Step 1: Write entity**

- [ ] **Step 2: Register in local datasource**

- [ ] **Step 3: Commit**

---

### Task 1C.6: BE — Feedback Entity (core.db)

**Files:**
- Create: `BE/src/modules/feedback/entities/feedback.entity.ts`

- [ ] **Step 1: Write entity**

- [ ] **Step 2: Register in core datasource**

- [ ] **Step 3: Commit**

---

### Task 1C.7: BE — EngineGatewayService

**Files:**
- Create: `BE/src/modules/engine-gateway/engine-gateway.module.ts`
- Create: `BE/src/modules/engine-gateway/engine-gateway.service.ts`
- Create: `BE/src/modules/engine-gateway/engine.config.ts`
- Create: `BE/src/modules/engine-gateway/dto/generate-story.dto.ts`
- Create: `BE/src/modules/engine-gateway/dto/engine-response.dto.ts`

**Interfaces:**
- `generate(dto: GenerateDto) → Promise<EngineResponse>` — HTTP call to Engine

- [ ] **Step 1: Write DTOs**

- [ ] **Step 2: Write EngineGatewayService with HTTP retry + timeout**

- [ ] **Step 3: Write test**

- [ ] **Step 4: Commit**

---

### Task 1C.8: BE — StoryService + Controller

**Files:**
- Create: `BE/src/modules/story/story.module.ts`
- Create: `BE/src/modules/story/story.service.ts`
- Create: `BE/src/modules/story/story.controller.ts`
- Create: `BE/src/modules/story/dto/create-story.dto.ts`
- Create: `BE/src/modules/story/dto/story-response.dto.ts`
- Test: `BE/src/modules/story/__tests__/story.service.spec.ts`

**Interfaces:**
- `POST /story/create` — validates input, calls EngineGateway via queue, saves to DB
- `GET /story/latest` — returns stories from local.db

- [ ] **Step 1: Write DTOs with class-validator**

- [ ] **Step 2: Write StoryService**

- [ ] **Step 3: Write StoryController**

- [ ] **Step 4: Write tests**

- [ ] **Step 5: Register in AppModule**

- [ ] **Step 6: Commit**

---

### Task 1C.9: BE — Feedback Module + Controller

**Files:**
- Create: `BE/src/modules/feedback/feedback.module.ts`
- Create: `BE/src/modules/feedback/feedback.service.ts`
- Create: `BE/src/modules/feedback/feedback.controller.ts`
- Create: `BE/src/modules/feedback/dto/feedback.dto.ts`

- [ ] **Step 1: Write DTO**

- [ ] **Step 2: Write service (save feedback → core.db, update memory → local.db)**

- [ ] **Step 3: Write controller**

- [ ] **Step 4: Write tests**

- [ ] **Step 5: Commit**

---

### Task 1C.10: BE — Memory Module + Service

**Files:**
- Create: `BE/src/modules/memory/memory.module.ts`
- Create: `BE/src/modules/memory/memory.service.ts`
- Create: `BE/src/modules/memory/memory.controller.ts`

**Interfaces:**
- `getRelevant(tenantId, childId) → MemoryContext[]` — priority queue with token budget
- `bulkCreate(tenantId, childId, memories, storyId)` — save extracted memories

- [ ] **Step 1: Write MemoryService**

- [ ] **Step 2: Write controller**

- [ ] **Step 3: Write tests**

- [ ] **Step 4: Commit**

---

## PHASE 1D: FE Refactor + Polish (7 tasks)

### Task 1D.1: FE — storyGenerator.ts Refactor

**Files:**
- Modify: `FE/src/utils/storyGenerator.ts` — call BE via api.ts instead of local LLM

- [ ] **Step 1: Rewrite storyGenerator**

```typescript
// FE/src/utils/storyGenerator.ts
import { BedtimeStory, StoryFormInput } from '../types';
import { apiClient } from './api';

export async function generateBedtimeStory(input: StoryFormInput): Promise<BedtimeStory> {
  const data = await apiClient<any>('/story/create', {
    method: 'POST',
    body: JSON.stringify({
      child_name: input.childName,
      age: input.childAge,
      theme: input.favoriteTopic,
      goal: input.lesson || '',
      mood: input.mood || 'vui vẻ',
      language: 'vi',
    }),
  });

  const storyData = data.data || data;
  
  return {
    id: `story-${Date.now()}`,
    title: storyData.title || 'Câu chuyện của bé',
    childName: input.childName,
    childAge: input.childAge,
    topic: input.favoriteTopic,
    lesson: input.lesson,
    segments: {
      opening: storyData.sections?.[0]?.text || '',
      situation: storyData.sections?.[1]?.text || '',
      interaction1: storyData.sections?.find((s: any) => s.type === 'interaction')?.prompt || '',
      challenge: storyData.sections?.find((s: any) => s.type === 'conflict')?.text || '',
      interaction2: '',
      ending: storyData.sections?.find((s: any) => s.type === 'resolution')?.text || '',
      interaction3: '',
      moralSummary: '',
    },
    createdAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Verify FE builds**

Run: `cd FE && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

---

### Task 1D.2: FE — Vite Proxy Config (Dev)

**Files:**
- Modify: `FE/vite.config.ts` — proxy /api to BE

- [ ] **Step 1: Add proxy**

```typescript
// FE/vite.config.ts
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname, '.') } },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
```

- [ ] **Step 2: Commit**

---

### Task 1D.3: Integration Test — BE ↔ Engine

**Files:**
- Create: `BE/test/integration/be-engine.spec.ts`

- [ ] **Step 1: Write test**

- [ ] **Step 2: Run test**

- [ ] **Step 3: Commit**

---

### Task 1D.4: E2E Test — Full Story Flow

**Files:**
- Create: `BE/test/e2e/full-flow.spec.ts`

- [ ] **Step 1: Write E2E test**

- [ ] **Step 2: Run test**

- [ ] **Step 3: Commit**

---

### Task 1D.5: Docker Compose for Local Dev

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Write docker-compose**

```yaml
version: '3.8'
services:
  engine:
    build: ./Engine
    ports:
      - "8000:8000"
    env_file: ./Engine/.env
  be:
    build: ./BE
    ports:
      - "3001:3001"
    depends_on:
      - engine
    env_file: ./BE/.env
    volumes:
      - ./BE/data:/app/data
  fe:
    build: ./FE
    ports:
      - "3000:3000"
    depends_on:
      - be
```

- [ ] **Step 2: Commit**

---

### Task 1D.6: Root README Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write README with monorepo overview, setup steps, env vars**

- [ ] **Step 2: Commit**

---

### Task 1D.7: Spec Self-Review + Finalize

- [ ] **Step 1: Scan for placeholders** — check all task files have code, not "TBD"
- [ ] **Step 2: Verify type consistency** — method signatures match across tasks
- [ ] **Step 3: Spec coverage check** — every spec requirement has a task
- [ ] **Step 4: Commit final plan**

```bash
git add docs/superpowers/plans/2026-07-27-phase1-mvp-plan.md
git commit -m "docs: Phase 1 MVP implementation plan complete"
```
