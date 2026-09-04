# Drop SQLite — Postgres-Only Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every SQLite code path, dependency, script, volume, and doc reference from the repo, leaving the NestJS backend running on a single Postgres TypeORM datasource with a test suite that runs against real Postgres.

**Architecture:** The two datasources (`core` + `local`) collapse into one named `core` holding all 16 tables. TypeORM migrations become the single source of schema truth and run automatically at app boot via `migrationsRun: true`, replacing the `create-all-tables.js` SQLite bootstrap. Tests get a Jest `globalSetup` that starts one `postgres:16-alpine` testcontainer, migrates a template database, and hands each spec file a throwaway clone via `CREATE DATABASE ... TEMPLATE`.

**Tech Stack:** NestJS 11, TypeORM 0.3.20, `pg` 8, PostgreSQL 16, Jest 29 + ts-jest, `@testcontainers/postgresql` 12.

**Spec:** [docs/superpowers/specs/2026-09-03-drop-sqlite-design.md](../specs/2026-09-03-drop-sqlite-design.md)

## Global Constraints

- All work happens on branch `feat/drop-sqlite-storage` (already checked out).
- The datasource keeps the name `core`. Do **not** rename it to the unnamed default connection — a missed `forFeature`/`getDataSourceToken` fails only at boot, with no compile-time signal.
- `synchronize` is `false` everywhere, including tests. Schema comes from migrations only.
- The Postgres `*_at` text format stays exactly `'YYYY-MM-DD HH:MM:SS'` (produced by `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`). `vietnam-time.ts` and `analytics.service.ts` parse that shape; changing it breaks them.
- No `onDelete` / cascade behavior is **introduced** on any foreign key by this plan. Note that one already exists and must be left alone: `tenant_sessions.tenant_id` carries `onDelete: 'CASCADE'`, added by `1756166400004-AddTenantAuth.ts` (the parent-Google-OAuth work, which landed before this plan). So the schema has five foreign keys, four with default `NO ACTION` and that one cascading. Documentation must say so.
- The existing `BE/data/core.db` and `BE/data/local.db` rows are **not** migrated. They are already backed up to the session scratchpad at `D:\Temp\claude\e--pet-project-AI-BEDTIME\e10b13de-c2e5-4ddb-b09e-2e373f6170f1\scratchpad\sqlite-backup\`.
- The commented-out `networks:` blocks in `docker-compose.yml` are an unrelated local change. Leave them exactly as found — do not revert and do not stage them.
- The npm/pnpm dual-lockfile situation is out of scope. Keep `npm ci` in the Dockerfile and keep `package-lock.json`. Do not commit `pnpm-lock.yaml`.
- Docker must be running for the test suite from Task 1 onward.
- **`BE/.env`'s `DATABASE_URL` carries a stale password** that does not match the password the running Postgres container was created with (the container uses the root `.env`'s `POSTGRES_PASSWORD`, which is what `BE/.env.example` says `DATABASE_URL` should carry). Do **not** edit `BE/.env` or the root `.env` — they are gitignored credentials files and belong to the user. Every host-side command that needs a database connection supplies the password inline from the root `.env` instead, as the affected steps show. Commands running *inside* compose are unaffected: the `backend` service's `environment:` block already overrides `DATABASE_URL` with `${POSTGRES_PASSWORD}`.
- **`BE/.env` sets `PORT=3007`**, while `expose`, nginx's upstream, and the backend healthcheck all address the container on 3001. Host-side boot checks must curl `:3007`; the compose fix is pinning `PORT: 3001` in the `backend` service's `environment:` block (Task 9, Step 2).

## Starting state you must expect

These are **already broken** before you start. Do not treat them as regressions you caused:

- The BE does not boot: `app.module.ts` no longer registers the `local` datasource, but `StoryModule`, `MemoryModule`, and `AnalyticsModule` still ask for it.
- `sqlite3`'s native binding is not built in `node_modules`, so all 17 SQLite-backed spec files fail with `Could not locate the bindings file`.
- The dev Postgres database is empty — migrations have never been run against it.

---

### Task 1: Postgres test harness (container + template database)

**Files:**
- Create: `BE/src/common/__tests__/test-entities.ts`
- Create: `BE/src/common/__tests__/global-setup.ts`
- Create: `BE/src/common/__tests__/global-teardown.ts`
- Modify: `BE/src/common/__tests__/test-db.ts` (full rewrite)
- Modify: `BE/package.json` (jest config block)
- Test: `BE/src/common/__tests__/test-db.spec.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ALL_TEST_ENTITIES: Function[]` and `TEMPLATE_DB: string` from `test-entities.ts`
  - `openTestDataSource(): Promise<DataSource>` and `closeTestDataSource(ds: DataSource): Promise<void>` from `test-db.ts`
  - `CORE_TOKEN` (unchanged export) from `test-db.ts`
  - `LOCAL_TOKEN`, `makeDataSource`, `openTestDataSources`, `closeTestDataSources` are **deleted** — Tasks 3-5 migrate their callers.

- [ ] **Step 1: Write the entity + template-name module**

Create `BE/src/common/__tests__/test-entities.ts`:

```typescript
import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../../modules/child/entities/child-profile.entity';
import { Feedback } from '../../modules/feedback/entities/feedback.entity';
import { Story } from '../../modules/story/entities/story.entity';
import { StorySection } from '../../modules/story/entities/story-section.entity';
import { MemoryItem } from '../../modules/memory/entities/memory-item.entity';
import { AdminUser } from '../../modules/admin/entities/admin-user.entity';
import { TenantSession } from '../../modules/auth/entities/tenant-session.entity';
import {
  TrafficEvent,
  TrafficHourly,
  LlmUsageEvent,
  LlmUsageHourly,
  IpRule,
  IpState,
  Alert,
  AdminSetting,
} from '../../modules/admin/dashboard/entities';

/**
 * Every spec file gets a database cloned from the same fully migrated
 * template, so there is no cost to registering all 16 entities everywhere.
 * Doing so removes a whole class of failures: a partial list breaks
 * TypeORM metadata building the moment one registered entity has a relation
 * to an unregistered one (Story -> StorySection is exactly that case).
 */
export const ALL_TEST_ENTITIES = [
  Tenant, ChildProfile, Feedback, AdminUser, TenantSession,
  TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
  IpRule, IpState, Alert, AdminSetting,
  Story, StorySection, MemoryItem,
];

/**
 * Lives here rather than in global-setup.ts so that importing it from a spec
 * file does not drag `@testcontainers/postgresql` into every worker.
 */
export const TEMPLATE_DB = 'tpl_ai_bed';
```

- [ ] **Step 2: Write the Jest globalSetup**

Create `BE/src/common/__tests__/global-setup.ts`:

```typescript
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ALL_TEST_ENTITIES, TEMPLATE_DB } from './test-entities';

/**
 * Starts one Postgres container for the whole run, migrates a template
 * database, then hands workers its admin connection string through
 * process.env. Jest forks its workers after globalSetup returns, so they
 * inherit the variable; `globalThis` would not survive the process boundary,
 * which is why only the container handle (needed by globalTeardown, same
 * process) is stashed there.
 */
export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();

  // The admin URL targets the always-present `postgres` maintenance database.
  // CREATE DATABASE and DROP DATABASE cannot run from inside the database
  // being created or dropped.
  const adminUrl =
    `postgresql://${container.getUsername()}:${container.getPassword()}` +
    `@${container.getHost()}:${container.getPort()}/postgres`;

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
  await admin.end();

  const template = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: TEMPLATE_DB,
    entities: ALL_TEST_ENTITIES,
    migrations: [__dirname + '/../../database/migrations/*.ts'],
    synchronize: false,
  });
  await template.initialize();
  await template.runMigrations();
  // Postgres refuses `CREATE DATABASE ... TEMPLATE` while any session is
  // attached to the source, so this destroy() is load-bearing, not cleanup.
  await template.destroy();

  process.env.TEST_PG_ADMIN_URL = adminUrl;
  (globalThis as any).__PG_CONTAINER__ = container;
}
```

- [ ] **Step 3: Write the Jest globalTeardown**

Create `BE/src/common/__tests__/global-teardown.ts`:

```typescript
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export default async function globalTeardown(): Promise<void> {
  const container = (globalThis as any).__PG_CONTAINER__ as
    | StartedPostgreSqlContainer
    | undefined;
  if (container) {
    await container.stop();
  }
}
```

- [ ] **Step 4: Rewrite the test-db helper**

Replace the entire contents of `BE/src/common/__tests__/test-db.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { ALL_TEST_ENTITIES, TEMPLATE_DB } from './test-entities';

export const CORE_TOKEN = getDataSourceToken('core');

function adminUrl(): string {
  const url = process.env.TEST_PG_ADMIN_URL;
  if (!url) {
    throw new Error(
      'TEST_PG_ADMIN_URL is unset — jest globalSetup did not run. Is Docker running?',
    );
  }
  return url;
}

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * One throwaway database per caller, cloned from the migrated template.
 * Postgres copies the template's files, so a clone costs far less than
 * re-running the migrations, and each spec file stays isolated even when
 * Jest runs several in parallel workers.
 */
export async function openTestDataSource(): Promise<DataSource> {
  const dbName = `t_${randomUUID().replace(/-/g, '')}`;
  await withAdmin((c) =>
    c.query(`CREATE DATABASE "${dbName}" TEMPLATE "${TEMPLATE_DB}"`),
  );

  const url = new URL(adminUrl());
  const ds = new DataSource({
    type: 'postgres',
    host: url.hostname,
    port: Number(url.port),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    // Explicit host/port/username/database rather than `url` so that
    // closeTestDataSource can read the database name back off ds.options.
    database: dbName,
    entities: ALL_TEST_ENTITIES,
    synchronize: false,
    // The container's max_connections (100) is shared by every parallel
    // worker, and each worker holds its own pool.
    extra: { max: 4 },
  });
  await ds.initialize();
  return ds;
}

export async function closeTestDataSource(ds: DataSource): Promise<void> {
  const dbName = ds.options.database as string;
  await ds.destroy();
  await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${dbName}"`));
}
```

- [ ] **Step 5: Wire the harness into the jest config**

Modify the `"jest"` block in `BE/package.json`: add `globalSetup`, `globalTeardown`, and raise `testTimeout`.

```json
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": {
      "^.+\\.(t|j)s$": "ts-jest"
    },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node",
    "testTimeout": 60000,
    "setupFiles": ["<rootDir>/test-setup.ts"],
    "globalSetup": "<rootDir>/common/__tests__/global-setup.ts",
    "globalTeardown": "<rootDir>/common/__tests__/global-teardown.ts"
  }
```

Keep the existing key order and formatting style of the file; only these three keys change or get added.

- [ ] **Step 6: Write the failing harness test**

Create `BE/src/common/__tests__/test-db.spec.ts`:

```typescript
import { DataSource } from 'typeorm';
import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { openTestDataSource, closeTestDataSource } from './test-db';

const EXPECTED_TABLES = [
  'tenants', 'child_profiles', 'feedbacks', 'admin_users', 'tenant_sessions',
  'traffic_event', 'traffic_hourly', 'llm_usage_event', 'llm_usage_hourly',
  'ip_rules', 'ip_states', 'alerts', 'admin_settings',
  'stories', 'story_sections', 'memory_items',
];

describe('Postgres test harness', () => {
  let a: DataSource;
  let b: DataSource;

  beforeAll(async () => {
    a = await openTestDataSource();
    b = await openTestDataSource();
  });

  afterAll(async () => {
    await closeTestDataSource(a);
    await closeTestDataSource(b);
  });

  it('clones the fully migrated schema', async () => {
    const rows: { table_name: string }[] = await a.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name != 'migrations'`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      [...EXPECTED_TABLES].sort(),
    );
  });

  it('isolates writes between two datasources', async () => {
    await a.getRepository(Tenant).insert({ tenantId: 'iso-1', name: 'a' });

    expect(await a.getRepository(Tenant).count()).toBe(1);
    expect(await b.getRepository(Tenant).count()).toBe(0);
  });

  it('applies the Postgres-side created_at default in the SQLite text shape', async () => {
    await a.getRepository(Tenant).insert({ tenantId: 'iso-2', name: 'b' });

    const row = await a.getRepository(Tenant).findOneByOrFail({ tenantId: 'iso-2' });
    expect(row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
```

- [ ] **Step 7: Run the harness test**

Run: `cd BE && npx jest src/common/__tests__/test-db.spec.ts --verbose`
Expected: PASS, all 3 tests. First run pulls `postgres:16-alpine` if absent, so allow a few minutes.

If it fails with `TEST_PG_ADMIN_URL is unset`, `globalSetup` did not run — check the `<rootDir>` path in `package.json` and that Docker is up.

- [ ] **Step 8: Commit**

```bash
git add BE/package.json BE/src/common/__tests__/test-entities.ts BE/src/common/__tests__/global-setup.ts BE/src/common/__tests__/global-teardown.ts BE/src/common/__tests__/test-db.ts BE/src/common/__tests__/test-db.spec.ts
git commit -m "test: run fixtures on real Postgres via a template database"
```

---

### Task 2: Collapse the `local` datasource into `core`

**Files:**
- Modify: `BE/src/app.module.ts`
- Modify: `BE/src/modules/story/story.module.ts:15`
- Modify: `BE/src/modules/memory/memory.module.ts:11`
- Modify: `BE/src/modules/analytics/analytics.module.ts:12-14`
- Modify: `BE/src/modules/analytics/analytics.service.ts:48-53`
- Test: `BE/src/common/__tests__/datasource.spec.ts` (rewrite)

**Interfaces:**
- Consumes: `openTestDataSource`, `closeTestDataSource`, `CORE_TOKEN` from Task 1.
- Produces: a single TypeORM connection named `core` carrying all 16 entities, with `migrationsRun: true`. Every `forFeature` in the app uses `'core'`; `'local'` no longer exists as a datasource name anywhere.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `BE/src/common/__tests__/datasource.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { StoryService } from '../../modules/story/story.service';
import { MemoryService } from '../../modules/memory/memory.service';
import { AnalyticsService } from '../../modules/analytics/analytics.service';
import { EngineGatewayService } from '../../modules/engine-gateway/engine-gateway.service';
import { CORE_TOKEN, openTestDataSource, closeTestDataSource } from './test-db';

// Compiling the real AppModule with ONLY the core datasource provided is the
// regression test for the collapse: any module still asking for a 'local'
// connection fails here, because nothing provides that token any more.
describe('single core datasource', () => {
  let module: TestingModule;
  let core: DataSource;

  beforeAll(async () => {
    core = await openTestDataSource();
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CORE_TOKEN)
      .useValue(core)
      .overrideProvider(EngineGatewayService)
      .useValue({ generate: jest.fn() })
      .compile();
  });

  afterAll(async () => {
    await closeTestDataSource(core);
  });

  it('initializes the core datasource', () => {
    expect(module.get<DataSource>(CORE_TOKEN).isInitialized).toBe(true);
  });

  it('resolves every service that used to sit on the local datasource', () => {
    expect(module.get(StoryService)).toBeDefined();
    expect(module.get(MemoryService)).toBeDefined();
    expect(module.get(AnalyticsService)).toBeDefined();
  });

  it('registers the former local entities on the core connection', () => {
    const tables = module
      .get<DataSource>(CORE_TOKEN)
      .entityMetadatas.map((m) => m.tableName);

    expect(tables).toContain('stories');
    expect(tables).toContain('story_sections');
    expect(tables).toContain('memory_items');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd BE && npx jest src/common/__tests__/datasource.spec.ts --verbose`
Expected: FAIL while compiling `AppModule` — Nest cannot resolve the repository providers registered against the missing `local` datasource token.

- [ ] **Step 3: Point `app.module.ts` at one connection with all 16 entities**

In `BE/src/app.module.ts`, replace the `TypeOrmModule.forRootAsync` block (lines 59-71) with:

```typescript
    TypeOrmModule.forRootAsync({
      name: 'core',
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [Tenant, ChildProfile, Feedback, AdminUser, TenantSession,
          TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
          IpRule, IpState, Alert, AdminSetting,
          Story, StorySection, MemoryItem],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        // Replaces the old `create-all-tables.js` boot step: a fresh database
        // gets the full schema, an existing one is a no-op. Safe because the
        // stack runs exactly one backend container. Add a Postgres advisory
        // lock around this before ever running a second replica, or two
        // instances can race the same migration.
        migrationsRun: true,
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
```

`Story`, `StorySection`, and `MemoryItem` are already imported at the top of the file (lines 6-8) — they were left behind when the `local` block was removed, so no import changes are needed.

- [ ] **Step 4: Move the three feature modules onto `core`**

`BE/src/modules/story/story.module.ts:15`:

```typescript
    TypeOrmModule.forFeature([Story, StorySection], 'core'),
```

`BE/src/modules/memory/memory.module.ts:11`:

```typescript
    TypeOrmModule.forFeature([MemoryItem], 'core'),
```

`BE/src/modules/analytics/analytics.module.ts` — replace the three `forFeature` lines with one:

```typescript
    TypeOrmModule.forFeature([Story, Feedback, MemoryItem], 'core'),
```

- [ ] **Step 5: Move the analytics constructor injections onto `core`**

`BE/src/modules/analytics/analytics.service.ts`, constructor:

```typescript
  constructor(
    @InjectRepository(Story, 'core') private storyRepo: Repository<Story>,
    @InjectRepository(Feedback, 'core') private feedbackRepo: Repository<Feedback>,
    @InjectRepository(MemoryItem, 'core') private memoryRepo: Repository<MemoryItem>,
    private readonly childService: ChildService,
  ) {}
```

Also update the now-misleading comment on the `sinceStr` line (`analytics.service.ts:57`):

```typescript
    // The *_at columns are text in the 'YYYY-MM-DD HH:MM:SS' UTC shape the
    // migrations produce, so the comparison value has to match that format.
    const sinceStr = since.toISOString().replace('T', ' ').replace('Z', '');
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd BE && npx jest src/common/__tests__/datasource.spec.ts --verbose`
Expected: PASS, all 3 tests.

- [ ] **Step 7: Confirm no `'local'` datasource reference survives**

Run: `cd BE && grep -rn "'local'" src --include=*.ts`
Expected: no output. (If a spec file still matches, it belongs to Tasks 3-5 — note it and continue; the app code must be clean.)

Run: `cd BE && npx tsc --noEmit -p tsconfig.build.json`
Expected: no TypeScript errors.

`tsconfig.build.json` is used here, not `npm run lint`. Task 1 deleted `LOCAL_TOKEN`, `makeDataSource`, `openTestDataSources`, and `closeTestDataSources`, and the 11 spec files that still call them are not migrated until Tasks 3-5. `npm run lint` uses `tsconfig.json`, which type-checks `src/**/*` including spec files, so it cannot be clean until Task 5. `tsconfig.build.json` excludes `**/*spec.ts`, so it gates exactly what this task owns: the application code. Full `npm run lint` returns as a gate in Task 6.

- [ ] **Step 8: Verify the app actually boots against real Postgres**

```bash
cd /e/pet-project/AI-BEDTIME
docker compose up -d postgres
cd BE
npm run build
node dist/main &
sleep 5
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/health
kill %1
```

Expected: `200`. The boot log must show TypeORM running the four migrations (this is the first proof that `migrationsRun: true` works). Requires `DATABASE_URL` in `BE/.env` pointing at `localhost:5434`.

- [ ] **Step 9: Commit**

```bash
git add BE/src/app.module.ts BE/src/modules/story/story.module.ts BE/src/modules/memory/memory.module.ts BE/src/modules/analytics/analytics.module.ts BE/src/modules/analytics/analytics.service.ts BE/src/common/__tests__/datasource.spec.ts
git commit -m "feat: collapse the local datasource into a single Postgres connection"
```

---

### Task 3: Move the six inline-fixture specs onto the harness

**Files:**
- Modify: `BE/src/modules/tenant/__tests__/tenant.service.spec.ts:11-35`
- Modify: `BE/src/modules/child/__tests__/child.service.spec.ts`
- Modify: `BE/src/modules/feedback/__tests__/feedback.service.spec.ts`
- Modify: `BE/src/modules/memory/__tests__/memory.service.spec.ts`
- Modify: `BE/src/modules/story/__tests__/story.service.spec.ts`
- Modify: `BE/src/modules/analytics/__tests__/analytics.service.spec.ts`
- Test: the six files above are the tests.

**Interfaces:**
- Consumes: `openTestDataSource`, `closeTestDataSource` from Task 1; the `'core'` datasource name from Task 2.
- Produces: nothing new.

Each of these six files builds its own `new DataSource({ type: 'sqlite', database: ':memory:', entities: [...], synchronize: true })` inside a provider factory. The mechanical transformation is identical in all six:

1. `beforeAll` opens one shared datasource with `await openTestDataSource()` **before** `Test.createTestingModule`.
2. Every `provide: getDataSourceToken('local' | 'core')` becomes `provide: getDataSourceToken('core'), useValue: dataSource`.
3. `afterAll` calls `await closeTestDataSource(dataSource)` instead of `dataSource.destroy()`.

- [ ] **Step 1: Transform `tenant.service.spec.ts`**

Replace its `beforeAll`/`afterAll` (lines 11-35) with:

```typescript
  beforeAll(async () => {
    dataSource = await openTestDataSource();
    const module = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: getDataSourceToken('core'), useValue: dataSource },
      ],
    }).compile();
    service = module.get(TenantService);
  });

  afterAll(async () => {
    await closeTestDataSource(dataSource);
  });
```

Replace the `DataSource` import block at the top with:

```typescript
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantService } from '../tenant.service';
import { openTestDataSource, closeTestDataSource } from '../../../common/__tests__/test-db';
```

The `Tenant` import becomes unused — remove it.

- [ ] **Step 2: Run it**

Run: `cd BE && npx jest src/modules/tenant/__tests__/tenant.service.spec.ts --verbose`
Expected: PASS, 4 tests.

- [ ] **Step 3: Transform the remaining five the same way**

Apply the identical three-point transformation to:

- `child.service.spec.ts` — one datasource, token `'core'` (already `'core'`)
- `feedback.service.spec.ts` — one datasource, token `'core'` (already `'core'`)
- `memory.service.spec.ts` — token changes `'local'` → `'core'`; keep the existing `ConfigService` mock provider untouched
- `story.service.spec.ts` — token(s) change to `'core'`
- `analytics.service.spec.ts` — the two datasources (`'local'` and `'core'`) collapse into **one**. The three `getRepositoryToken(..., 'local' | 'core')` factories all become:

```typescript
        {
          provide: getRepositoryToken(Story, 'core'),
          useFactory: (ds: DataSource) => ds.getRepository(Story),
          inject: [getDataSourceToken('core')],
        },
        {
          provide: getRepositoryToken(Feedback, 'core'),
          useFactory: (ds: DataSource) => ds.getRepository(Feedback),
          inject: [getDataSourceToken('core')],
        },
        {
          provide: getRepositoryToken(MemoryItem, 'core'),
          useFactory: (ds: DataSource) => ds.getRepository(MemoryItem),
          inject: [getDataSourceToken('core')],
        },
```

with a single `{ provide: getDataSourceToken('core'), useValue: dataSource }`, and `afterAll` closing one datasource instead of two.

- [ ] **Step 4: Run the six files together**

Run (explicit file paths only — passing a directory would pull in `tenant.controller.spec.ts`, `story.integration.spec.ts`, and `story.flow.spec.ts`, which Tasks 4 and 5 have not migrated yet and which are expected to fail until then):
```bash
cd BE && npx jest \
  src/modules/tenant/__tests__/tenant.service.spec.ts \
  src/modules/child/__tests__/child.service.spec.ts \
  src/modules/feedback/__tests__/feedback.service.spec.ts \
  src/modules/memory/__tests__/memory.service.spec.ts \
  src/modules/story/__tests__/story.service.spec.ts \
  src/modules/analytics/__tests__/analytics.service.spec.ts --verbose
```

Expected: PASS. **If assertions fail rather than the setup failing, that is the dialect fallout the spec warned about** — Postgres is stricter than SQLite. Fix each one on its merits; the common causes are:

- **Unordered `find()` results.** SQLite tended to return insertion order; Postgres does not guarantee any order without `ORDER BY`. Fix the *service* if the API promises an order (add `ORDER BY`), or fix the *test* if it only ever assumed one (sort before asserting).
- **Text vs integer comparison.** `is_active`/`listened_complete`/`wants_more` are `integer` columns compared against `1`; a test inserting `true` worked on SQLite and fails on Postgres.
- **`LIKE` case sensitivity.** SQLite's `LIKE` is case-insensitive for ASCII by default; Postgres's is not. Use `ILIKE` only if the service intends case-insensitive matching — check the caller before changing behavior.
- **Empty-table aggregates** returning `null` as a string vs a number.

Record what you changed and why in the commit message. Do not "fix" a test by weakening the assertion without saying so.

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/tenant BE/src/modules/child BE/src/modules/feedback BE/src/modules/memory BE/src/modules/story BE/src/modules/analytics
git commit -m "test: move service specs off the SQLite in-memory fixture"
```

---

### Task 4: Move the five `makeDataSource` specs onto the harness

**Files:**
- Modify: `BE/src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts:13,46`
- Modify: `BE/src/modules/admin/__tests__/admin-auth.service.spec.ts:6,20`
- Modify: `BE/src/modules/admin/__tests__/admin-feedback.service.spec.ts:8,38-39,133`
- Modify: `BE/src/modules/admin/__tests__/admin-user.entity.spec.ts:2,6`
- Modify: `BE/src/modules/tenant/__tests__/tenant.controller.spec.ts:6,16`
- Test: the five files above are the tests.

**Interfaces:**
- Consumes: `openTestDataSource`, `closeTestDataSource`, `CORE_TOKEN` from Task 1.
- Produces: nothing new.

`makeDataSource(entities)` was synchronous and returned an **un-initialized** `DataSource` that each caller then `initialize()`d. `openTestDataSource()` is async and returns an already-initialized one, so every call site loses its own `initialize()` and gains an `await`.

- [ ] **Step 1: Transform `admin-user.entity.spec.ts`**

```typescript
import { AdminUser } from '../entities/admin-user.entity';
import { openTestDataSource, closeTestDataSource } from '../../../common/__tests__/test-db';

// (inside the test/beforeAll, replacing `const ds = makeDataSource([AdminUser]); await ds.initialize();`)
    const ds = await openTestDataSource();
// ... and replacing `await ds.destroy()`:
    await closeTestDataSource(ds);
```

- [ ] **Step 2: Run it**

Run: `cd BE && npx jest src/modules/admin/__tests__/admin-user.entity.spec.ts --verbose`
Expected: PASS.

- [ ] **Step 3: Transform the remaining four**

- `admin-auth.service.spec.ts:20` — `makeDataSource([AdminUser])` → `await openTestDataSource()`; drop the separate `initialize()`; `destroy()` → `closeTestDataSource(ds)`.
- `dashboard.service.spec.ts:46` — `makeDataSource(ALL_ENTITIES)` → `await openTestDataSource()`. The file's local `ALL_ENTITIES` constant becomes unused; delete it and its imports. Keep the long comment at lines 315-323 but update it: the "sqlite driver holds a single physical connection" caveat no longer applies, and the spy-based assertions it justifies now genuinely exercise pooled-connection behavior.
- `admin-feedback.service.spec.ts:38-39` and `:133` — two datasources (`core` = `[Tenant, ChildProfile, Feedback]`, `local` = `[Story, StorySection]`) collapse into **one** `await openTestDataSource()`. Both `core.getRepository(...)` and `local.getRepository(...)` call sites now read from the same datasource; rename the local variable to `ds` so no reader thinks two stores are still involved.
- `tenant.controller.spec.ts:16` — `makeDataSource([Tenant])` inside a `useFactory` → make the factory `async` and `await openTestDataSource()`, or hoist it into `beforeAll` and pass `useValue`. Prefer hoisting, so `afterAll` has a handle to close.

- [ ] **Step 4: Run the five files**

Run:
```bash
cd BE && npx jest src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts src/modules/admin/__tests__/admin-auth.service.spec.ts src/modules/admin/__tests__/admin-feedback.service.spec.ts src/modules/admin/__tests__/admin-user.entity.spec.ts src/modules/tenant/__tests__/tenant.controller.spec.ts --verbose
```

Expected: PASS. Apply the same dialect-fallout guidance as Task 3, Step 4. `dashboard.service.spec.ts` is the most likely to surface real issues — it is the largest file and the one whose comments already flag driver-dependent behavior.

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/admin BE/src/modules/tenant
git commit -m "test: move admin and dashboard specs onto the Postgres harness"
```

---

### Task 5: Move the five remaining integration specs onto the harness

**Files:**
- Modify: `BE/src/common/__tests__/admin-tenant-isolation.spec.ts:10-14,28-30,35-38,52`
- Modify: `BE/src/modules/admin/__tests__/admin.integration.spec.ts:13-17,28-30,45-48,64`
- Modify: `BE/src/modules/child/__tests__/child.integration.spec.ts`
- Modify: `BE/src/modules/story/__tests__/story.integration.spec.ts`
- Modify: `BE/src/modules/story/__tests__/story.flow.spec.ts`
- Test: the five files above are the tests.

**Interfaces:**
- Consumes: `openTestDataSource`, `closeTestDataSource`, `CORE_TOKEN` from Task 1; the single-`core` AppModule from Task 2.
- Produces: nothing new. After this task, `LOCAL_TOKEN`, `makeDataSource`, `openTestDataSources`, and `closeTestDataSources` have no callers left anywhere.

The transformation for each:

```typescript
// before
import { CORE_TOKEN, LOCAL_TOKEN, openTestDataSources, closeTestDataSources } from './test-db';
let core: DataSource;
let local: DataSource;

const ds = await openTestDataSources();
core = ds.core;
local = ds.local;

module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(CORE_TOKEN).useValue(core)
  .overrideProvider(LOCAL_TOKEN).useValue(local)
  ...

await closeTestDataSources(core, local);

// after
import { CORE_TOKEN, openTestDataSource, closeTestDataSource } from './test-db';
let core: DataSource;

core = await openTestDataSource();

module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(CORE_TOKEN).useValue(core)
  ...

await closeTestDataSource(core);
```

- [ ] **Step 1: Transform `admin-tenant-isolation.spec.ts`**

Apply the pattern above. Any `local.getRepository(...)` call becomes `core.getRepository(...)`. The `jest.setTimeout(60_000)` line can stay (it now matches the config default; harmless).

Update the `afterAll` comment — "app.close()/module.close() throw for named `forRootAsync` datasources" is still true, so keep the manual close and keep the explanation, but drop the plural.

- [ ] **Step 2: Run it**

Run: `cd BE && npx jest src/common/__tests__/admin-tenant-isolation.spec.ts --verbose`
Expected: PASS.

- [ ] **Step 3: Transform the remaining four**

`admin.integration.spec.ts`, `child.integration.spec.ts`, `story.integration.spec.ts`, `story.flow.spec.ts` — identical pattern. In `story.integration.spec.ts` and `story.flow.spec.ts` the `Story`/`StorySection` seed data moves from `local` to `core`; nothing else about the seeds changes.

- [ ] **Step 4: Run the whole suite**

Run: `cd BE && npm test`
Expected: every suite passes. This is the first full-suite green run of the plan.

- [ ] **Step 5: Confirm the dead helpers are gone**

Run: `cd BE && grep -rn "LOCAL_TOKEN\|makeDataSource\|openTestDataSources\|closeTestDataSources" src`
Expected: no output. If `test-db.ts` still exports any of them, delete those exports (Task 1's rewrite should already have).

- [ ] **Step 6: Commit**

```bash
git add BE/src/common/__tests__ BE/src/modules/admin BE/src/modules/child BE/src/modules/story
git commit -m "test: move integration specs onto the single Postgres datasource"
```

---

### Task 6: Replace the SQLite `datetime('now')` defaults

**Files:**
- Modify: `BE/src/database/now-default-expr.ts` (full rewrite)
- Modify: `BE/src/database/migrations/1756166400001-CreateCoreTables.ts:2,8`
- Modify: `BE/src/database/migrations/1756166400002-CreateDashboardTables.ts`
- Modify: `BE/src/database/migrations/1756166400003-CreateLocalTables.ts`
- Modify: `BE/src/database/migrations/1756166400004-AddTenantAuth.ts`
- Modify: 11 entity files, 13 occurrences (exact list below)
- Test: `BE/src/common/__tests__/test-db.spec.ts` (the created_at-format test from Task 1 already covers this)

**Interfaces:**
- Consumes: nothing.
- Produces: `NOW_UTC_TEXT_EXPR: string` exported from `BE/src/database/now-default-expr.ts`. `nowDefaultExpr(queryRunner)` is **removed**.

Editing already-applied migration files is safe here **only because the emitted SQL is byte-identical**: `nowDefaultExpr` returned the same Postgres expression the constant holds, TypeORM will not re-run a recorded migration, and a fresh database gets the same DDL as before.

- [ ] **Step 1: Rewrite the helper as a constant**

Replace `BE/src/database/now-default-expr.ts` entirely:

```typescript
/**
 * DB-side default for the `*_at` text columns. Reproduces the
 * 'YYYY-MM-DD HH:MM:SS' UTC shape that the pre-Postgres SQLite schema
 * produced with `datetime('now')`, because app code (vietnam-time.ts,
 * analytics.service.ts) parses these columns as plain strings in that shape.
 */
export const NOW_UTC_TEXT_EXPR =
  `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
```

- [ ] **Step 2: Update the four migration files**

In each of the four files under `BE/src/database/migrations/`, change the import and the local `now` binding. For `1756166400001-CreateCoreTables.ts`:

```typescript
import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../now-default-expr';

export class CreateCoreTables1756166400001 implements MigrationInterface {
  name = 'CreateCoreTables1756166400001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const now = NOW_UTC_TEXT_EXPR;
```

Apply the same two-line change to `...002`, `...003`, and `...004`. Do not touch anything else in those files.

- [ ] **Step 3: Update the 12 entity files**

Replace every `default: () => "datetime('now')"` with `default: () => NOW_UTC_TEXT_EXPR`, adding the import to each file. There are exactly 13 occurrences across 11 files:

| File | Columns |
|---|---|
| `src/modules/tenant/entities/tenant.entity.ts:25,28` | `created_at`, `updated_at` |
| `src/modules/child/entities/child-profile.entity.ts:35,38` | `created_at`, `updated_at` |
| `src/modules/feedback/entities/feedback.entity.ts:32` | `created_at` |
| `src/modules/story/entities/story.entity.ts:60` | `created_at` |
| `src/modules/memory/entities/memory-item.entity.ts:44` | `created_at` |
| `src/modules/admin/entities/admin-user.entity.ts:16` | `created_at` |
| `src/modules/auth/entities/tenant-session.entity.ts:30` | `created_at` |
| `src/modules/admin/dashboard/entities/admin-setting.entity.ts:10` | `updated_at` |
| `src/modules/admin/dashboard/entities/alert.entity.ts:22` | `created_at` |
| `src/modules/admin/dashboard/entities/ip-rule.entity.ts:24` | `created_at` |
| `src/modules/admin/dashboard/entities/ip-state.entity.ts:24` | `updated_at` |

Import path from a `src/modules/<x>/entities/` file is `../../../database/now-default-expr`; from `src/modules/admin/dashboard/entities/` it is `../../../../database/now-default-expr`.

Be honest about what this step does: with `synchronize: false` these entity-level defaults are never used to emit DDL, so this is removing a landmine (someone enabling `synchronize` would generate invalid Postgres), not fixing a live bug.

- [ ] **Step 4: Verify nothing references the old helper or the SQLite function**

Run: `cd BE && grep -rn "nowDefaultExpr\|datetime('now')" src`
Expected: no output.

Run: `cd BE && npm run lint`
Expected: no TypeScript errors.

- [ ] **Step 5: Run the suite**

Run: `cd BE && npm test`
Expected: all suites pass, including the `created_at` format assertion from Task 1.

- [ ] **Step 6: Commit**

```bash
git add BE/src/database BE/src/modules
git commit -m "refactor: replace the SQLite datetime('now') defaults with the Postgres expression"
```

---

### Task 7: Drop the dual-write control columns

**Files:**
- Create: `BE/src/database/migrations/1756166400005-DropStorageBackend.ts`
- Modify: `BE/src/database/migrations/1756166400001-CreateCoreTables.ts:21-26` (comment only)
- Test: `BE/src/database/__tests__/migrations.spec.ts`

**Interfaces:**
- Consumes: `NOW_UTC_TEXT_EXPR` from Task 6.
- Produces: migration class `DropStorageBackend1756166400005`.

`tenants.storage_backend` and `tenants.migrated_at` exist only to drive the per-tenant dual-write cutover that the 2026-09-03 spec drops. No code reads either column (verified by grep).

- [ ] **Step 1: Write the failing test**

Append to the `describe('Postgres migrations', ...)` block in `BE/src/database/__tests__/migrations.spec.ts`:

```typescript
  it('leaves no dual-write control columns on tenants', async () => {
    const rows: { column_name: string }[] = await dataSource.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tenants'`,
    );
    const columns = rows.map((r) => r.column_name);

    expect(columns).not.toContain('storage_backend');
    expect(columns).not.toContain('migrated_at');
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd BE && npx jest src/database/__tests__/migrations.spec.ts --verbose`
Expected: FAIL — `expect(received).not.toContain("storage_backend")`.

- [ ] **Step 3: Write the migration**

Create `BE/src/database/migrations/1756166400005-DropStorageBackend.ts`:

```typescript
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * `storage_backend` and `migrated_at` were added to drive a per-tenant
 * SQLite -> Postgres dual-write cutover. That cutover was dropped: the only
 * SQLite data was throwaway dev data, so there was nothing to protect. No
 * application code ever read either column.
 */
export class DropStorageBackend1756166400005 implements MigrationInterface {
  name = 'DropStorageBackend1756166400005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('tenants', 'storage_backend');
    await queryRunner.dropColumn('tenants', 'migrated_at');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'tenants',
      new TableColumn({ name: 'storage_backend', type: 'text', default: `'sqlite'` }),
    );
    await queryRunner.addColumn(
      'tenants',
      new TableColumn({ name: 'migrated_at', type: 'text', isNullable: true }),
    );
  }
}
```

- [ ] **Step 4: Fix the stale comment in migration 001**

`1756166400001-CreateCoreTables.ts`, the comment above `storage_backend` currently promises a "follow-up dual-write plan" that no longer exists. Replace it with:

```typescript
          // Cutover control columns for the abandoned per-tenant dual-write
          // plan. Never read by application code; dropped again in
          // DropStorageBackend1756166400005. Kept here so the recorded
          // migration history stays replayable from scratch.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd BE && npx jest src/database/__tests__/migrations.spec.ts --verbose`
Expected: PASS, all tests including the 16-table and foreign-key assertions.

- [ ] **Step 6: Apply the migration to the dev database**

`BE/.env`'s `DATABASE_URL` carries a stale password that does not match the running container (see Global Constraints), so host-side database commands must take the password from the root `.env` inline. This never prints the value and never edits a credentials file:

```bash
cd /e/pet-project/AI-BEDTIME && docker compose up -d postgres
cd BE && PGPW=$(awk -F= '/^POSTGRES_PASSWORD=/{print $2}' ../.env) \
  DATABASE_URL="postgresql://ai_bed:${PGPW}@localhost:5434/ai_bed" npm run migration:run
docker exec ai-bedtime-postgres-1 psql -U ai_bed -d ai_bed -c '\d tenants'
```

Expected: the `tenants` description shows neither `storage_backend` nor `migrated_at`.

- [ ] **Step 7: Commit**

```bash
git add BE/src/database
git commit -m "feat: drop the abandoned dual-write control columns from tenants"
```

---

### Task 8: Remove the SQLite scripts and dependency

**Files:**
- Delete: `BE/scripts/create-all-tables.js`
- Delete: `BE/scripts/create-tenants.js`
- Delete: `BE/scripts/create-tenants.ts`
- Delete: `BE/scripts/migrate-core-to-postgres.ts`
- Delete: `BE/scripts/check-core-orphans.ts`
- Modify: `BE/scripts/create-admin.ts`
- Modify: `BE/package.json`
- Modify: `BE/src/config/app.config.ts:6-7`
- Test: manual — Step 6 runs `admin:create` against Postgres.

**Interfaces:**
- Consumes: the migrated Postgres schema from Task 7.
- Produces: `npm run admin:create -- --username <name>` working against `DATABASE_URL`. The `db:init`, `migrate:core`, and `check:core-orphans` scripts no longer exist.

`create-tenants.ts` is deleted rather than rewritten (the spec said "rewrite"): all it ever did was `CREATE TABLE IF NOT EXISTS tenants`, which the migrations now own. It seeds nothing, so a Postgres version of it would be dead weight.

- [ ] **Step 1: Delete the five obsolete scripts**

```bash
cd /e/pet-project/AI-BEDTIME
git rm BE/scripts/create-all-tables.js BE/scripts/create-tenants.js BE/scripts/create-tenants.ts BE/scripts/migrate-core-to-postgres.ts BE/scripts/check-core-orphans.ts
```

- [ ] **Step 2: Point `create-admin.ts` at Postgres**

In `BE/scripts/create-admin.ts`, replace the datasource setup and the `CREATE TABLE` block inside `main()`:

```typescript
async function main(): Promise<void> {
  const username = readUsername(process.argv);
  const password = readPassword();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. See BE/.env.example.');
  }

  // No CREATE TABLE here any more: `admin_users` comes from
  // CreateCoreTables1756166400001, which the app runs on boot. If this script
  // fails with "relation admin_users does not exist", run `npm run
  // migration:run` first rather than re-adding a second schema source.
  const ds = new DataSource({ type: 'postgres', url, entities: [AdminUser] });
  await ds.initialize();

  const repo = ds.getRepository(AdminUser);
  const passwordHash = await hashPassword(password);
  const existing = await repo.findOne({ where: { username } });

  if (existing) {
    await repo.update({ adminId: existing.adminId }, { passwordHash });
    console.log(`Password reset for admin "${username}".`);
  } else {
    await repo.insert({ adminId: randomUUID(), username, passwordHash });
    console.log(`Admin "${username}" created.`);
  }

  await ds.destroy();
}
```

Also update the doc comment at the top of the file: drop the sentence about `synchronize` only being on for `NODE_ENV=development`, which is no longer true.

- [ ] **Step 3: Drop `sqlite3` and the dead npm scripts**

In `BE/package.json`:
- Remove `"sqlite3": "^5.1.7"` from `dependencies`.
- Remove the `"db:init"`, `"migrate:core"`, and `"check:core-orphans"` entries from `scripts`.

- [ ] **Step 4: Remove the SQLite path config**

`BE/src/config/app.config.ts` becomes:

```typescript
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
}));
```

- [ ] **Step 5: Reinstall and verify the dependency is gone**

`package-lock.json` **must** be resynced, not left stale: `npm ci` — which the Dockerfile runs, and which Task 9 Step 5 exercises — fails outright when `package.json` and the lockfile disagree. Removing `sqlite3` from `dependencies` without updating the lockfile would break the image build.

Use `--package-lock-only`, which rewrites the lockfile without touching `node_modules`:

```bash
cd BE && npm install --package-lock-only
grep -n "sqlite" package.json; grep -c "sqlite3" package-lock.json
```

`node_modules` here is a pnpm layout that the whole test suite is currently running against; a plain `npm install` would replace it wholesale, which is both slow and outside this plan's scope (the npm/pnpm split is an explicit non-goal). `--package-lock-only` keeps the working install untouched while making the lockfile honest.

Expected: no `sqlite` match in `package.json`; `package-lock.json`'s `sqlite3` count drops to 0. If `sqlite3` survives as a direct entry, the lockfile did not pick up the change.

- [ ] **Step 6: Verify `admin:create` works against Postgres**

Same inline-`DATABASE_URL` treatment as Task 7 Step 6 — `BE/.env`'s copy is stale:

```bash
cd /e/pet-project/AI-BEDTIME && docker compose up -d postgres
cd BE
PGPW=$(awk -F= '/^POSTGRES_PASSWORD=/{print $2}' ../.env) \
  DATABASE_URL="postgresql://ai_bed:${PGPW}@localhost:5434/ai_bed" \
  ADMIN_PASSWORD='local-dev-password-123' npm run admin:create -- --username thang
docker exec ai-bedtime-postgres-1 psql -U ai_bed -d ai_bed -c 'SELECT username FROM admin_users'
```

Expected: the script prints `Admin "thang" created.` and the query returns one row.

- [ ] **Step 7: Run lint and the full suite**

Run: `cd BE && npm run lint && npm test`
Expected: no TypeScript errors; every suite passes.

- [ ] **Step 8: Commit**

```bash
git add BE/package.json BE/package-lock.json BE/scripts BE/src/config/app.config.ts
git commit -m "chore: drop the sqlite3 dependency and its bootstrap scripts"
```

---

### Task 9: Clean SQLite out of the container image and compose stack

**Files:**
- Modify: `BE/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `BE/.env.example:73-76`
- Modify: `BE/.dockerignore:8-11`
- Modify: `BE/.gitignore:3-4`
- Modify: `.gitignore:4`
- Delete (untracked, local only): `BE/data/core.db`, `BE/data/local.db`
- Test: manual — Steps 6 and 7 boot the stack, including from an empty volume.

**Interfaces:**
- Consumes: `migrationsRun: true` from Task 2 (it is what replaces the deleted `create-all-tables.js` boot step).
- Produces: a backend image with no native-module toolchain and no data volume.

- [ ] **Step 1: Strip SQLite from the Dockerfile**

`BE/Dockerfile` — in the build stage, delete the `apk add ... .build-deps` line, its comment, and the `&& apk del .build-deps` from the build command:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev
```

In the production stage, delete the `COPY --from=build /app/scripts/create-all-tables.js` line, the `RUN mkdir -p data` line and its comment, and rewrite the `CMD` and the `chown` comment:

```dockerfile
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/dist ./dist/
COPY --from=build /app/node_modules ./node_modules/
COPY --from=build /app/package.json ./

# Non-root, using the `node` user the base image already ships.
RUN chown -R node:node /app
USER node

EXPOSE 3001
# Schema comes from the TypeORM migrations the app runs itself on boot
# (`migrationsRun: true` in app.module.ts), so there is no separate
# schema-initializer step and no writable data directory.
CMD ["node", "dist/main"]
```

- [ ] **Step 2: Drop the data volume from compose**

`docker-compose.yml`, `backend` service: delete the `volumes:` block (`- be-data:/app/data`) and the "Not read_only: SQLite needs to write…" comment. In the top-level `volumes:` map, delete the `be-data:` entry, leaving `pg-data:`.

Then make the backend read-only, matching the `engine` service:

```yaml
    # Nothing under /app is written at runtime now that the schema comes from
    # migrations and the data lives in Postgres; /tmp is the one path a Node
    # process still needs.
    read_only: true
    tmpfs:
      - /tmp
```

Also add `PORT` to the `backend` service's existing `environment:` block, alongside the `ENGINE_URL` and `DATABASE_URL` overrides that are already there for the same host-vs-in-network reason:

```yaml
      # BE/.env sets PORT=3007 for host development, but `expose`, nginx's
      # upstream, and this service's own healthcheck all address the container
      # on 3001. `environment` wins over `env_file`, so pin it here rather than
      # asking every developer to keep the two in sync.
      PORT: 3001
```

Without this the container listens on 3007, the healthcheck's `fetch('http://localhost:3001/health')` never succeeds, `backend` never reports healthy, and `frontend` — which has `depends_on: condition: service_healthy` — never starts at all. This is a pre-existing defect unrelated to SQLite, but Steps 6 and 7 and all of Task 11 cannot pass while it stands.

**Do not touch the commented-out `networks:` blocks.**

- [ ] **Step 3: Remove the SQLite env keys and ignore rules**

`BE/.env.example` — delete lines 73-76 (the `# SQLite files.` comment and the two commented `CORE_DB_PATH`/`LOCAL_DB_PATH` lines). Leave the `DATABASE_URL` block that follows.

`BE/.dockerignore` — delete lines 8-11 (the "Runtime SQLite lives in the be-data volume" comment and the two `data/*.db*` patterns).

`BE/.gitignore` — delete lines 3-4 (`data/*.db`, `data/*.db-journal`).

`.gitignore` — delete line 4 (`*.db`).

- [ ] **Step 4: Delete the local database files**

These are untracked, so this is a filesystem action, not a commit. Backups already exist in the session scratchpad (see Global Constraints).

```bash
rm /e/pet-project/AI-BEDTIME/BE/data/core.db /e/pet-project/AI-BEDTIME/BE/data/local.db
ls -la /e/pet-project/AI-BEDTIME/BE/data
```

Expected: only `.gitkeep` remains. Leave `.gitkeep` in place — it is tracked.

- [ ] **Step 5: Confirm the image builds without the toolchain**

```bash
cd /e/pet-project/AI-BEDTIME && docker compose build backend
```

Expected: build succeeds. Previously `npm ci` needed `python3 make g++` to compile `sqlite3`; if the build now fails on a native module, something else in the tree needs it and the build deps have to come back — say so rather than working around it.

- [ ] **Step 6: Boot the full stack**

```bash
cd /e/pet-project/AI-BEDTIME
docker compose up -d
docker compose ps
docker compose logs backend --tail 40
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/health
```

Expected: all services healthy, `200` from the health endpoint, and no error in the backend log. If `read_only: true` causes a crash (an `EROFS` in the log), remove just those two `read_only`/`tmpfs` lines, re-run, and record in the commit message what path needed to be writable.

- [ ] **Step 7: Prove the schema bootstraps from empty**

This is the test that `migrationsRun: true` genuinely replaces `create-all-tables.js`.

```bash
cd /e/pet-project/AI-BEDTIME
docker compose down
docker volume rm ai-bedtime_pg-data
docker compose up -d
docker compose logs backend --tail 40
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/health
docker exec ai-bedtime-postgres-1 psql -U ai_bed -d ai_bed -c '\dt'
```

Expected: the backend log shows the five migrations running, health returns `200`, and `\dt` lists 16 application tables plus TypeORM's `migrations` table. If `docker volume rm` reports the volume name is wrong, get the real one from `docker volume ls | grep pg-data`.

- [ ] **Step 8: Recreate the admin account**

The volume wipe removed it.

```bash
cd /e/pet-project/AI-BEDTIME/BE
ADMIN_PASSWORD='local-dev-password-123' npm run admin:create -- --username thang
```

Expected: `Admin "thang" created.`

- [ ] **Step 9: Commit**

```bash
cd /e/pet-project/AI-BEDTIME
git add BE/Dockerfile docker-compose.yml BE/.env.example BE/.dockerignore BE/.gitignore .gitignore
git commit -m "chore: remove the SQLite data volume and native toolchain from the image"
```

Note: `docker-compose.yml` also carries the unrelated commented-out `networks:` change. If you want it out of this commit, stage the file with `git add -p` and take only the volume/read-only hunks.

---

### Task 10: Update the documentation

**Files:**
- Modify: `README.md:39,151,221,262`
- Modify: `docs/02-architecture-document.md`
- Modify: `docs/04-schema-db-document.md`
- Modify: `docs/superpowers/specs/2026-08-26-postgres-migration-design.md`
- Test: none (documentation).

**Interfaces:**
- Consumes: the finished state from Tasks 1-9.
- Produces: nothing consumed by code.

- [ ] **Step 0: Correct four in-code references that are now false**

These are not documentation, but they are the same defect as the docs below: text that asserts something untrue about how the system stores data. Two of them state a falsehood outright; two are stale naming.

`BE/src/modules/admin/admin-feedback.service.ts:88` — currently says "SQLite stores UTC". Postgres stores it now, in the same text shape:

```typescript
    // The UI date inputs are Vietnam calendar dates; the *_at columns are UTC
    // text. Shift the boundaries so a day filter means a Vietnam day.
```

`BE/src/modules/child/child.service.ts:85` — currently says "whatever SQLite hands back":

```typescript
    // Without an explicit order the list is whatever Postgres hands back, so the
```

`BE/src/common/time/vietnam-time.ts:6-7` — the local variable is named `sqliteUtc` after a database that is gone. Rename it to `utcTextShape`; the regex and the behavior do not change:

```typescript
  const utcTextShape = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed);
  return new Date(utcTextShape ? `${trimmed.replace(' ', 'T')}Z` : trimmed);
```

`BE/src/common/__tests__/test-db.spec.ts:43` — the test name says "in the SQLite text shape". Rename it to `'applies the Postgres-side created_at default in the expected text shape'`. Do not change the assertion.

Run `cd BE && npx jest src/common/__tests__/vietnam-time.spec.ts src/common/__tests__/test-db.spec.ts --verbose` afterwards; both must still pass.

- [ ] **Step 1: Fix the README**

- Line 39, the ASCII architecture diagram: `│  SQLite  │` → `│ Postgres │` (keep the box width).
- Line 151, the env table: delete the `DB_PATH | ./data | SQLite files directory` row; the `DATABASE_URL` row should describe the Postgres connection string.
- Line 221, the directory tree: `│   └── data/           # SQLite runtime files` → delete the line (the directory now holds only `.gitkeep`).
- Line 262: `- **Database**: SQLite (dual: core.db + local.db)` → `- **Database**: PostgreSQL 16 (single schema, TypeORM migrations)`.

- [ ] **Step 2: Fix the architecture and schema docs**

`docs/02-architecture-document.md` — the section around lines 136-255 describes the two-file `core.db`/`local.db` split and explicitly says `local.db` is not client storage. Rewrite it to describe one Postgres database with all 16 tables, and keep the clarifying note that the frontend's `localStorage` cache is a separate, unrelated thing.

`docs/04-schema-db-document.md` — replace SQLite type names and any `datetime('now')` defaults with what the migrations actually create (`text` columns defaulting to `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`), and note the five foreign keys the migrations add (`child_profiles`, `feedbacks` ×2, `story_sections`, `tenant_sessions`).

- [ ] **Step 3: Mark the old spec superseded**

Add directly under the `**Status:**` line of `docs/superpowers/specs/2026-08-26-postgres-migration-design.md`:

```markdown
> **Superseded (2026-09-03):** Phases 0 and 1 shipped. Phases 2, 3, and 4
> (per-tenant dual-write for the `local` tables, `sync-tenant-to-postgres.ts`,
> and the deferred cleanup) were **dropped** — the only SQLite data was
> throwaway dev data, so the parallel-run cutover had nothing to protect.
> See [2026-09-03-drop-sqlite-design.md](2026-09-03-drop-sqlite-design.md).
```

- [ ] **Step 4: Check for remaining SQLite claims in docs**

Grep for both spellings — `sqlite` alone misses the many places that name the two database files directly:

```bash
cd /e/pet-project/AI-BEDTIME
grep -rn -i "sqlite\|core\.db\|local\.db" README.md docs/*.md
```

Expected: only explicitly-past-tense historical notes. A surviving reference is acceptable only where the surrounding sentence marks it as history ("the MVP ran two SQLite files…"); anything written in the present tense, describing how the system stores data *now*, must be fixed.

`docs/05-business-logic-mvp.md` is in scope here even though it is not in this task's file list: its data-flow diagrams and section headers route writes to `core.db` and `local.db` in the present tense (around lines 18-21, 85, 94, 272-273, 296-297). Those are now false. Rewrite them to name the tables on the single Postgres datasource, keeping the private-versus-user-visible distinction the document is actually making — that distinction was about schema namespacing, and it survives as a documentation concept even though the two files do not.

- [ ] **Step 5: Commit**

```bash
git add README.md docs
git commit -m "docs: describe the Postgres-only backend"
```

---

### Task 11: Final verification sweep

**Files:**
- Test: no new files — this task runs the spec's §5 verification list end to end and records the result.

**Interfaces:**
- Consumes: everything from Tasks 1-10.
- Produces: a verified, reportable end state.

Run each command and record the actual output. Do not report completion from inspection.

- [ ] **Step 1: No SQLite left in the backend source**

```bash
cd /e/pet-project/AI-BEDTIME/BE
grep -rn -i "sqlite" src scripts package.json Dockerfile .env.example .dockerignore .gitignore
```

Expected: only the hits on this allowlist, and nothing else. Every one of them is a deliberate reference to what SQLite *used to* do, in a comment or a schema literal that must not change:

| Location | Why it stays |
|---|---|
| `src/database/migrations/1756166400001-CreateCoreTables.ts:25` | the `default: `'sqlite'`` on `storage_backend` — must stay so the recorded migration history replays from scratch |
| same file, the comment above it (Task 7 Step 4) | explains the line above |
| `src/database/migrations/1756166400005-DropStorageBackend.ts:5-6,20` | the doc comment and the same default restored in `down()` |
| `src/database/now-default-expr.ts:3` | doc comment naming the format's origin |
| `src/modules/admin/admin-feedback.service.ts:47,50` | explains why the two-query title lookup exists and points at the spec section that defers merging it |
| `src/common/__tests__/admin-feedback.service.spec.ts:72`, `analytics.service.spec.ts:153`, `child.service.spec.ts:16`, `feedback.service.spec.ts:23` | explain why FK parent rows are seeded — the old fixtures did not enforce them |

Anything not on this list is a leftover. Note that Task 10 Step 0 removes four *stale* references that are not on it.

- [ ] **Step 2: TypeScript clean**

Run: `cd BE && npm run lint`
Expected: exit 0, no output.

- [ ] **Step 3: Full test suite green**

Run: `cd BE && npm test`
Expected: 0 failed suites. Record the suite/test counts.

- [ ] **Step 4: Migrations produce the expected schema**

```bash
cd /e/pet-project/AI-BEDTIME && docker compose up -d postgres
cd BE && PGPW=$(awk -F= '/^POSTGRES_PASSWORD=/{print $2}' ../.env) \
  DATABASE_URL="postgresql://ai_bed:${PGPW}@localhost:5434/ai_bed" npm run migration:show
docker exec ai-bedtime-postgres-1 psql -U ai_bed -d ai_bed -c '\dt'
```

Expected: `migration:show` marks all five migrations `[X]` (applied); `\dt` lists the 16 application tables plus `migrations`.

- [ ] **Step 5: Stack healthy end to end**

```bash
cd /e/pet-project/AI-BEDTIME
docker compose up -d
docker compose ps
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/api/health
```

Expected: every service `healthy`, `200` from health.

- [ ] **Step 6: Admin login works**

```bash
curl -s -X POST http://localhost/api/admin/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"thang","password":"local-dev-password-123"}' | head -c 200
```

Expected: a JSON body containing a `token`. If the account is missing, re-run `npm run admin:create` (Task 8, Step 6) — a missing account is not a failure of this plan, but a `500` or a schema error is.

- [ ] **Step 7: Generate one story through the real stack**

The end-to-end proof that the former `local` tables work on Postgres. Open `http://localhost` in a browser, create a child profile, and generate a story. Then:

```bash
docker exec ai-bedtime-postgres-1 psql -U ai_bed -d ai_bed \
  -c 'SELECT count(*) FROM stories' -c 'SELECT count(*) FROM story_sections'
```

Expected: both counts greater than 0. This requires a working Engine/LLM configuration; if the Engine is not configured, say so explicitly instead of marking the step done.

- [ ] **Step 8: Report**

Write the outcome of Steps 1-7 — actual numbers and any step that could not be run — and hand off. Do not claim the migration is complete if Step 3 or Step 7 did not pass.

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §4.1 single datasource named `core` | Task 2 |
| §4.2 runtime code (app.module, 3 modules, analytics.service, now-default-expr, 14 entity defaults, app.config, DropStorageBackend) | Tasks 2, 6, 7, 8 |
| §4.3 scripts | Task 8 |
| §4.4 test harness + 17 spec files | Tasks 1, 3, 4, 5 |
| §4.5 Docker, compose, env, ignores, `.db` deletion | Task 9 |
| §4.6 documentation + supersede note | Task 10 |
| §5 verification list (6 items) | Task 11 |
| §7 open item: `read_only` feasibility | Task 9, Step 6 (with explicit fallback) |
| §7 open item: dialect fallout count | Tasks 3-5, Step 4 guidance |
| §7 open item: advisory lock for multi-replica | Task 2, Step 3 (comment in code) |

**Deviation from the spec, recorded deliberately:** §4.3 says rewrite `create-tenants.ts` against Postgres. Task 8 deletes it instead — the script only ran `CREATE TABLE IF NOT EXISTS tenants`, which the migrations now own, so a Postgres port would be dead code. Nothing else departs from the spec.

**Known gap, not addressed:** the dashboard entities type their `*_at` columns as `varchar(25)` while the migrations create `text`. Harmless with `synchronize: false` and unrelated to SQLite, so it stays out of scope — worth a follow-up.
