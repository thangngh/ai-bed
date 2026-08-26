# Postgres Core Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `BE` NestJS app a real, version-controlled Postgres schema (all 15 tables) and cut the `core` datasource (`tenants`, `child_profiles`, `feedbacks`, `admin_users`, 8 dashboard tables) over from SQLite to Postgres in one shot, with FK constraints added where the app currently only enforces relationships in code.

**Architecture:** TypeORM migrations (QueryRunner `Table`/`TableForeignKey`/`TableIndex` API, not raw SQL, so they run unmodified against both SQLite and Postgres) create the full 15-table schema in a fresh Postgres database. An orphan-row check and a one-shot, idempotent copy script move existing `core` data from SQLite into Postgres. `app.module.ts`'s `core` `TypeOrmModule` connection then switches its `type`/`database` options from `sqlite`/`data/core.db` to `postgres`/`DATABASE_URL`. The `local` datasource (`stories`, `story_sections`, `memory_items`) stays on SQLite — its per-tenant dual-write cutover is a separate follow-up plan (see §"Not in this plan").

**Tech Stack:** NestJS 11, TypeORM 0.3.20, `pg` driver, PostgreSQL 16 (docker-compose `postgres:16-alpine`), `testcontainers`/`@testcontainers/postgresql` for the migration smoke test.

**Spec:** [docs/superpowers/specs/2026-08-26-postgres-migration-design.md](../specs/2026-08-26-postgres-migration-design.md) — this plan implements that spec's Phase 0 ("Foundation") and Phase 1 ("One-shot cutover of the `core` datasource").

## Global Constraints

- Migrations use TypeORM's `QueryRunner` `Table`/`TableColumn`/`TableForeignKey`/`TableIndex` API exclusively — no raw `CREATE TABLE` SQL strings — so the same migration file is dialect-portable between `sqlite` and `postgres` (spec §4 Phase 0).
- `synchronize` is `false` unconditionally once this plan lands — no `NODE_ENV` branch (spec §1, §4 Phase 0).
- SQLite source files (`core.db`) are never written by any script in this plan — only read. Rollback is "point the config back at SQLite" (spec §5).
- All new/changed scripts are idempotent — safe to re-run (spec §4 Phase 1 step 3).
- No FK `ON DELETE CASCADE` (or any `onDelete` behavior) is introduced unless it already existed — none did, so all new FKs use TypeORM's default (`NO ACTION`). Do not invent cascade behavior.
- The `local` datasource (`stories`, `story_sections`, `memory_items`) keeps running on SQLite after this plan. Do not touch its `TypeOrmModule.forRootAsync({ name: 'local', ... })` block in `app.module.ts`.

## Not in this plan

Per the spec, Phases 2-4 (per-tenant dual-write for the `local` tables, the `sync-tenant-to-postgres.ts` script, and the Phase-4 cleanup) are a separate follow-up plan, written after this one lands and the `core` cutover has been exercised. `BE/scripts/create-all-tables.js` (the partial 7-table manual script) is left in place for now — deleting it is listed as an open item in the spec, to be decided once the `local` tables also have migrations backing them.

---

### Task 1: Postgres driver, CLI migration data source, npm scripts

**Files:**
- Modify: `BE/package.json`
- Create: `BE/src/database/now-default-expr.ts`
- Create: `BE/src/database/postgres-data-source.ts`
- Test: none (no runtime behavior yet — verified in Task 3 when the first migration runs against it)

**Interfaces:**
- Produces: `nowDefaultExpr(queryRunner: QueryRunner): string` — used by every migration in Tasks 3-5 for `*_at` column defaults.
- Produces: `PostgresDataSource: DataSource` (default export from `postgres-data-source.ts`) — the CLI target for `migration:run`/`migration:revert`/`migration:show`, and reused as the target `DataSource` in Task 7's copy script.

- [ ] **Step 1: Add the `pg` driver and CLI-only dev dependencies**

Run:
```bash
cd BE
npm install pg@^8.23.0
npm install -D @types/pg@^8.23.1 testcontainers@^12.1.0 @testcontainers/postgresql@^12.1.0
```

- [ ] **Step 2: Write the shared default-timestamp helper**

Create `BE/src/database/now-default-expr.ts`:

```typescript
import { QueryRunner } from 'typeorm';

/**
 * The pre-migration SQLite schema used `datetime('now')` as the DB-side
 * default for *_at text columns, producing 'YYYY-MM-DD HH:MM:SS' in UTC.
 * Postgres has no `datetime()` function, so migrations pick the
 * dialect-appropriate expression that reproduces the same text format —
 * existing app code parses these columns as plain strings in that shape.
 */
export function nowDefaultExpr(queryRunner: QueryRunner): string {
  return queryRunner.connection.options.type === 'postgres'
    ? `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`
    : `(datetime('now'))`;
}
```

- [ ] **Step 3: Write the CLI/migration-runner data source**

Create `BE/src/database/postgres-data-source.ts`:

```typescript
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Tenant } from '../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../modules/child/entities/child-profile.entity';
import { Feedback } from '../modules/feedback/entities/feedback.entity';
import { AdminUser } from '../modules/admin/entities/admin-user.entity';
import { Story } from '../modules/story/entities/story.entity';
import { StorySection } from '../modules/story/entities/story-section.entity';
import { MemoryItem } from '../modules/memory/entities/memory-item.entity';
import {
  TrafficEvent,
  TrafficHourly,
  LlmUsageEvent,
  LlmUsageHourly,
  IpRule,
  IpState,
  Alert,
  AdminSetting,
} from '../modules/admin/dashboard/entities';

// Covers all 15 tables (core + dashboard + local) even though, until the
// follow-up plan lands, only the core+dashboard 12 are actually read/written
// via Postgres at runtime — the `local` tables' schema needs to exist ahead
// of their own per-tenant data cutover (spec §4 Phase 0).
export const PostgresDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [
    Tenant, ChildProfile, Feedback, AdminUser,
    TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
    IpRule, IpState, Alert, AdminSetting,
    Story, StorySection, MemoryItem,
  ],
  migrations: [__dirname + '/migrations/*.ts'],
  synchronize: false,
});

export default PostgresDataSource;
```

- [ ] **Step 4: Add migration npm scripts**

Modify `BE/package.json` — add to `"scripts"` (after `"db:init"`, `BE/package.json:9`):

```json
    "migration:run": "typeorm-ts-node-commonjs migration:run -d src/database/postgres-data-source.ts",
    "migration:revert": "typeorm-ts-node-commonjs migration:revert -d src/database/postgres-data-source.ts",
    "migration:show": "typeorm-ts-node-commonjs migration:show -d src/database/postgres-data-source.ts",
```

- [ ] **Step 5: Verify the project still builds**

Run: `cd BE && npm run lint`
Expected: exits 0 (no TypeScript errors — `now-default-expr.ts` and `postgres-data-source.ts` compile even with an empty `migrations/` glob).

- [ ] **Step 6: Commit**

```bash
git add BE/package.json BE/package-lock.json BE/src/database/now-default-expr.ts BE/src/database/postgres-data-source.ts
git commit -m "feat: add postgres driver and migration CLI data source"
```

---

### Task 2: docker-compose Postgres service

**Files:**
- Modify: `docker-compose.yml:65-104` (backend service block), `docker-compose.yml:141-142` (volumes block)
- Modify: `.env.example`
- Modify: `BE/.env.example`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a reachable `postgres` service (compose-network name `postgres`, port 5432) and a host-reachable `localhost:5432` (loopback-only publish) that Task 3-5's `npm run migration:run` and Task 7's copy script connect to during local development. `DATABASE_URL` env var, in both forms, is what later tasks read.

- [ ] **Step 1: Add `POSTGRES_PASSWORD` to the root env example**

Modify `.env.example` — add after the `ENGINE_API_KEY` block (`.env.example:16`):

```
# --- Postgres -----------------------------------------------------------------
# Password for the `ai_bed` Postgres role created on first container start.
# Generate: node -e console.log(require('crypto').randomBytes(24).toString('base64url'))
POSTGRES_PASSWORD=
```

- [ ] **Step 2: Add the `postgres` service to docker-compose.yml**

Modify `docker-compose.yml` — insert a new service before `backend:` (`docker-compose.yml:65`):

```yaml
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ai_bed
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set — see .env.example}
      POSTGRES_DB: ai_bed
    # Bound to loopback only: this lets `npm run migration:run` and the
    # one-shot copy script connect from the host during development without
    # publishing the DB to the LAN/internet, matching the posture the backend
    # and engine services already use (see the `expose`-only comment below).
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - pg-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ai_bed -d ai_bed"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    mem_limit: 512m
    cpus: 1.0

```

- [ ] **Step 3: Wire the backend service to Postgres and depend on its healthcheck**

Modify `docker-compose.yml:76-89` (the `backend.environment` block and `depends_on`) — add `DATABASE_URL` alongside the existing `ENGINE_URL` override and add `postgres` to `depends_on`:

```yaml
    environment:
      # BE/.env holds the host-development value (localhost:8000), which inside
      # this container points at the container itself. `environment` wins over
      # `env_file`, so the compose stack reaches the Engine by service name.
      # `engine` is not unique when another Compose project from this repo is
      # attached to the shared external networks (for example the isolated
      # test stack). Docker DNS then returns either container at random. A
      # project-qualified alias keeps each BE pinned to its own Engine.
      ENGINE_URL: http://${COMPOSE_PROJECT_NAME:-ai-bed}-engine:8000
      ENGINE_TIMEOUT_MS: ${ENGINE_TIMEOUT_MS:-60000}
      ENGINE_API_KEY: ${ENGINE_API_KEY:-}
      # Same override reasoning as ENGINE_URL above: BE/.env's DATABASE_URL is
      # the host-development value (localhost:5432); inside the compose
      # network the core datasource reaches Postgres by service name.
      DATABASE_URL: postgresql://ai_bed:${POSTGRES_PASSWORD}@postgres:5432/ai_bed
    depends_on:
      engine:
        condition: service_healthy
      postgres:
        condition: service_healthy
```

- [ ] **Step 4: Add the `pg-data` named volume**

Modify `docker-compose.yml:141-142` — add `pg-data:` alongside the existing `be-data:` entry:

```yaml
volumes:
  be-data:
  pg-data:
```

- [ ] **Step 5: Add `DATABASE_URL` to the backend env example**

Modify `BE/.env.example` — add after the `LOCAL_DB_PATH` comment block (`BE/.env.example:39-42`):

```
# Postgres connection string for the `core` datasource (tenants,
# child_profiles, feedbacks, admin_users, dashboard tables). Host-development
# value below assumes `docker compose up -d postgres` with the port bound to
# 127.0.0.1:5432 (see docker-compose.yml). The compose `backend` service
# itself overrides this to the in-network `postgres:5432` form.
DATABASE_URL=postgresql://ai_bed:<POSTGRES_PASSWORD from your local .env>@localhost:5432/ai_bed
```

- [ ] **Step 6: Bring Postgres up and confirm it is healthy**

Run:
```bash
echo "POSTGRES_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")" >> .env
docker compose up -d postgres
docker compose ps postgres
```
Expected: `postgres` service shows `healthy` status within ~30s.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example BE/.env.example
git commit -m "feat: add postgres service to docker-compose"
```

---

### Task 3: Migration — core relational tables

**Files:**
- Create: `BE/src/database/migrations/1756166400001-CreateCoreTables.ts`

**Interfaces:**
- Consumes: `nowDefaultExpr` from `BE/src/database/now-default-expr.ts` (Task 1).
- Produces: `tenants` (with `storage_backend`/`migrated_at`, reserved for the follow-up dual-write plan), `child_profiles`, `feedbacks`, `admin_users` tables and their FKs, on whatever `DataSource` runs this migration.

- [ ] **Step 1: Write the migration**

Create `BE/src/database/migrations/1756166400001-CreateCoreTables.ts`:

```typescript
import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';
import { nowDefaultExpr } from '../now-default-expr';

export class CreateCoreTables1756166400001 implements MigrationInterface {
  name = 'CreateCoreTables1756166400001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const now = nowDefaultExpr(queryRunner);

    await queryRunner.createTable(
      new Table({
        name: 'tenants',
        columns: [
          { name: 'tenant_id', type: 'text', isPrimary: true },
          { name: 'name', type: 'text', default: `'anonymous'` },
          { name: 'auth_type', type: 'text', default: `'local'` },
          { name: 'auth_key', type: 'text', isNullable: true },
          { name: 'metadata', type: 'text', isNullable: true },
          { name: 'created_at', type: 'text', default: now },
          { name: 'updated_at', type: 'text', default: now },
          // Cutover control column for the `local` tables (stories,
          // story_sections, memory_items) — set and consumed by the
          // follow-up dual-write plan, unused until then.
          { name: 'storage_backend', type: 'text', default: `'sqlite'` },
          { name: 'migrated_at', type: 'text', isNullable: true },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'child_profiles',
        columns: [
          { name: 'child_id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text' },
          { name: 'child_name', type: 'text' },
          { name: 'age', type: 'integer' },
          { name: 'interests', type: 'text', isNullable: true },
          { name: 'preferred_characters', type: 'text', isNullable: true },
          { name: 'bedtime_goal', type: 'text', isNullable: true },
          { name: 'gender', type: 'text', isNullable: true },
          { name: 'language', type: 'text', default: `'vi'` },
          { name: 'is_active', type: 'integer', default: 1 },
          { name: 'created_at', type: 'text', default: now },
          { name: 'updated_at', type: 'text', default: now },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'child_profiles',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedTableName: 'tenants',
        referencedColumnNames: ['tenant_id'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'feedbacks',
        columns: [
          { name: 'feedback_id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text' },
          { name: 'story_id', type: 'text' },
          { name: 'child_id', type: 'text', isNullable: true },
          { name: 'listened_complete', type: 'integer', isNullable: true },
          { name: 'wants_more', type: 'integer', isNullable: true },
          { name: 'suitable', type: 'integer', isNullable: true },
          { name: 'rating', type: 'integer', isNullable: true },
          { name: 'note', type: 'text', isNullable: true },
          { name: 'created_at', type: 'text', default: now },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'feedbacks',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedTableName: 'tenants',
        referencedColumnNames: ['tenant_id'],
      }),
    );
    await queryRunner.createForeignKey(
      'feedbacks',
      new TableForeignKey({
        columnNames: ['child_id'],
        referencedTableName: 'child_profiles',
        referencedColumnNames: ['child_id'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'admin_users',
        columns: [
          { name: 'admin_id', type: 'text', isPrimary: true },
          { name: 'username', type: 'text', isUnique: true },
          { name: 'password_hash', type: 'text' },
          { name: 'created_at', type: 'text', default: now },
          { name: 'last_login_at', type: 'text', isNullable: true },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('admin_users', true);
    await queryRunner.dropTable('feedbacks', true);
    await queryRunner.dropTable('child_profiles', true);
    await queryRunner.dropTable('tenants', true);
  }
}
```

- [ ] **Step 2: Run the migration against local Postgres**

Run: `cd BE && npm run migration:run`
Expected: output includes `Migration CreateCoreTables1756166400001 has been executed successfully.`

- [ ] **Step 3: Verify the tables and FKs exist**

Run:
```bash
docker compose exec postgres psql -U ai_bed -d ai_bed -c "\d tenants" -c "\d child_profiles" -c "\d feedbacks" -c "\d admin_users"
```
Expected: `child_profiles` and `feedbacks` each show a `FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)` constraint; `feedbacks` additionally shows one referencing `child_profiles(child_id)`; `tenants` includes `storage_backend` and `migrated_at` columns.

- [ ] **Step 4: Revert and re-run to confirm `down()` works**

Run:
```bash
cd BE
npm run migration:revert
npm run migration:run
```
Expected: revert drops all four tables without error; re-run recreates them.

- [ ] **Step 5: Commit**

```bash
git add BE/src/database/migrations/1756166400001-CreateCoreTables.ts
git commit -m "feat: add core tables migration"
```

---

### Task 4: Migration — dashboard tables

**Files:**
- Create: `BE/src/database/migrations/1756166400002-CreateDashboardTables.ts`

**Interfaces:**
- Consumes: `nowDefaultExpr` from `BE/src/database/now-default-expr.ts` (Task 1).
- Produces: `traffic_event`, `traffic_hourly`, `llm_usage_event`, `llm_usage_hourly`, `ip_rules`, `ip_states`, `alerts`, `admin_settings` tables (no FKs — none exist at the entity level for these).

- [ ] **Step 1: Write the migration**

Create `BE/src/database/migrations/1756166400002-CreateDashboardTables.ts`:

```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';
import { nowDefaultExpr } from '../now-default-expr';

export class CreateDashboardTables1756166400002 implements MigrationInterface {
  name = 'CreateDashboardTables1756166400002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const now = nowDefaultExpr(queryRunner);

    await queryRunner.createTable(
      new Table({
        name: 'traffic_event',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'ip', type: 'varchar', length: '64' },
          { name: 'route', type: 'varchar', length: '64' },
          { name: 'method', type: 'varchar', length: '64' },
          { name: 'status', type: 'int' },
          { name: 'bytesIn', type: 'integer', default: 0 },
          { name: 'bytesOut', type: 'integer', default: 0 },
          { name: 'lat_ms', type: 'real', default: 0 },
          { name: 'ts', type: 'varchar', length: '25' },
        ],
      }),
      true,
    );
    await queryRunner.createIndex('traffic_event', new TableIndex({ columnNames: ['ts'] }));

    await queryRunner.createTable(
      new Table({
        name: 'traffic_hourly',
        columns: [
          { name: 'ip', type: 'varchar', length: '64', isPrimary: true },
          { name: 'hour_bucket', type: 'varchar', length: '19', isPrimary: true },
          { name: 'route', type: 'varchar', length: '128', isPrimary: true },
          { name: 'status_class', type: 'varchar', length: '8', isPrimary: true },
          { name: 'req_count', type: 'integer', default: 0 },
          { name: 'bytes_in', type: 'integer', default: 0 },
          { name: 'bytes_out', type: 'integer', default: 0 },
          { name: 'lat_avg_ms', type: 'real', default: 0 },
          { name: 'lat_p95_max_ms', type: 'real', default: 0 },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'llm_usage_event',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'provider', type: 'varchar', length: '32' },
          { name: 'model', type: 'varchar', length: '64' },
          { name: 'tenant_id', type: 'varchar', length: '64', isNullable: true },
          { name: 'prompt_tokens', type: 'integer', default: 0 },
          { name: 'completion_tokens', type: 'integer', default: 0 },
          { name: 'est_cost_usd', type: 'real', default: 0 },
          { name: 'latency_ms', type: 'real', default: 0 },
          { name: 'is_fallback', type: 'boolean', default: false },
          { name: 'ts', type: 'varchar', length: '25' },
        ],
      }),
      true,
    );
    await queryRunner.createIndex('llm_usage_event', new TableIndex({ columnNames: ['ts'] }));

    await queryRunner.createTable(
      new Table({
        name: 'llm_usage_hourly',
        columns: [
          { name: 'provider', type: 'varchar', length: '32', isPrimary: true },
          { name: 'model', type: 'varchar', length: '64', isPrimary: true },
          { name: 'hour_bucket', type: 'varchar', length: '19', isPrimary: true },
          { name: 'prompt_tokens', type: 'integer', default: 0 },
          { name: 'completion_tokens', type: 'integer', default: 0 },
          { name: 'requests', type: 'integer', default: 0 },
          { name: 'est_cost_usd', type: 'real', default: 0 },
          { name: 'lat_avg_ms', type: 'real', default: 0 },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'ip_rules',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'type', type: 'varchar', length: '8' },
          { name: 'pattern', type: 'varchar', length: '64' },
          { name: 'action', type: 'varchar', length: '8' },
          { name: 'tier', type: 'varchar', length: '32', default: `'default'` },
          { name: 'note', type: 'text', isNullable: true },
          { name: 'created_by', type: 'varchar', length: '64' },
          { name: 'created_at', type: 'varchar', length: '25', default: now },
          { name: 'enabled', type: 'boolean', default: true },
        ],
      }),
      true,
    );
    await queryRunner.createIndex('ip_rules', new TableIndex({ columnNames: ['enabled'] }));
    await queryRunner.createIndex('ip_rules', new TableIndex({ columnNames: ['pattern'] }));

    await queryRunner.createTable(
      new Table({
        name: 'ip_states',
        columns: [
          { name: 'ip', type: 'varchar', length: '64', isPrimary: true },
          { name: 'status', type: 'varchar', length: '16', default: `'ok'` },
          { name: 'tier', type: 'varchar', length: '32', default: `'default'` },
          { name: 'score', type: 'real', default: 0 },
          { name: 'blocked_until', type: 'varchar', length: '25', isNullable: true },
          { name: 'auto_blocked', type: 'boolean', default: false },
          { name: 'reason', type: 'text', isNullable: true },
          { name: 'updated_at', type: 'varchar', length: '25', default: now },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'alerts',
        columns: [
          { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
          { name: 'type', type: 'varchar', length: '64' },
          { name: 'severity', type: 'varchar', length: '16' },
          { name: 'ip', type: 'varchar', length: '64', isNullable: true },
          { name: 'provider', type: 'varchar', length: '32', isNullable: true },
          { name: 'detail_json', type: 'text' },
          { name: 'resolved', type: 'boolean', default: false },
          { name: 'created_at', type: 'varchar', length: '25', default: now },
          { name: 'resolved_at', type: 'varchar', length: '25', isNullable: true },
        ],
      }),
      true,
    );
    await queryRunner.createIndex('alerts', new TableIndex({ columnNames: ['resolved', 'created_at'] }));

    await queryRunner.createTable(
      new Table({
        name: 'admin_settings',
        columns: [
          { name: 'key', type: 'varchar', length: '128', isPrimary: true },
          { name: 'value', type: 'text' },
          { name: 'updated_at', type: 'varchar', length: '25', default: now },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('admin_settings', true);
    await queryRunner.dropTable('alerts', true);
    await queryRunner.dropTable('ip_states', true);
    await queryRunner.dropTable('ip_rules', true);
    await queryRunner.dropTable('llm_usage_hourly', true);
    await queryRunner.dropTable('llm_usage_event', true);
    await queryRunner.dropTable('traffic_hourly', true);
    await queryRunner.dropTable('traffic_event', true);
  }
}
```

- [ ] **Step 2: Run the migration**

Run: `cd BE && npm run migration:run`
Expected: output includes `Migration CreateDashboardTables1756166400002 has been executed successfully.`

- [ ] **Step 3: Verify indexes**

Run: `docker compose exec postgres psql -U ai_bed -d ai_bed -c "\di"`
Expected: lists an index on `traffic_event(ts)`, `llm_usage_event(ts)`, `ip_rules(enabled)`, `ip_rules(pattern)`, and `alerts(resolved, created_at)`.

- [ ] **Step 4: Revert and re-run to confirm `down()` works**

Run:
```bash
cd BE
npm run migration:revert
npm run migration:run
```
Expected: revert drops all eight tables without error; re-run recreates them.

- [ ] **Step 5: Commit**

```bash
git add BE/src/database/migrations/1756166400002-CreateDashboardTables.ts
git commit -m "feat: add dashboard tables migration"
```

---

### Task 5: Migration — local tables

**Files:**
- Create: `BE/src/database/migrations/1756166400003-CreateLocalTables.ts`

**Interfaces:**
- Consumes: `nowDefaultExpr` from `BE/src/database/now-default-expr.ts` (Task 1).
- Produces: `stories`, `story_sections` (FK to `stories`), `memory_items` tables. No FK from these tables to `tenants` yet — deferred to the follow-up dual-write plan (spec §7 open items), since `local` data isn't backfilled until that plan's per-tenant sync script runs.

- [ ] **Step 1: Write the migration**

Create `BE/src/database/migrations/1756166400003-CreateLocalTables.ts`:

```typescript
import { MigrationInterface, QueryRunner, Table, TableForeignKey } from 'typeorm';
import { nowDefaultExpr } from '../now-default-expr';

export class CreateLocalTables1756166400003 implements MigrationInterface {
  name = 'CreateLocalTables1756166400003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const now = nowDefaultExpr(queryRunner);

    await queryRunner.createTable(
      new Table({
        name: 'stories',
        columns: [
          { name: 'story_id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text' },
          { name: 'child_id', type: 'text', isNullable: true },
          { name: 'request_id', type: 'text', isNullable: true },
          { name: 'title', type: 'text' },
          { name: 'content', type: 'text' },
          { name: 'structure_json', type: 'text', isNullable: true },
          { name: 'theme', type: 'text' },
          { name: 'goal', type: 'text', isNullable: true },
          { name: 'mood', type: 'text', isNullable: true },
          { name: 'language', type: 'text', default: `'vi'` },
          { name: 'safety_status', type: 'text', default: `'PENDING'` },
          { name: 'llm_calls', type: 'integer', default: 0 },
          { name: 'retry_count', type: 'integer', default: 0 },
          { name: 'total_latency_ms', type: 'integer', isNullable: true },
          { name: 'word_count', type: 'integer', isNullable: true },
          { name: 'is_fallback', type: 'integer', default: 0 },
          { name: 'is_saved', type: 'integer', default: 0 },
          { name: 'created_at', type: 'text', default: now },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'story_sections',
        columns: [
          { name: 'section_id', type: 'text', isPrimary: true },
          { name: 'story_id', type: 'text' },
          { name: 'tenant_id', type: 'text' },
          { name: 'section_type', type: 'text' },
          { name: 'content', type: 'text' },
          { name: 'order_index', type: 'integer' },
          { name: 'interaction_prompt', type: 'text', isNullable: true },
          { name: 'interaction_options', type: 'text', isNullable: true },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'story_sections',
      new TableForeignKey({
        columnNames: ['story_id'],
        referencedTableName: 'stories',
        referencedColumnNames: ['story_id'],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'memory_items',
        columns: [
          { name: 'memory_id', type: 'text', isPrimary: true },
          { name: 'tenant_id', type: 'text' },
          { name: 'child_id', type: 'text', isNullable: true },
          { name: 'story_id', type: 'text', isNullable: true },
          { name: 'memory_type', type: 'text' },
          { name: 'memory_key', type: 'text' },
          { name: 'memory_value', type: 'text' },
          { name: 'confidence', type: 'real', default: 0.5 },
          { name: 'source_text', type: 'text', isNullable: true },
          { name: 'source', type: 'text', isNullable: true },
          { name: 'last_reinforced_at', type: 'text', isNullable: true },
          { name: 'is_active', type: 'integer', default: 1 },
          { name: 'expires_at', type: 'text', isNullable: true },
          { name: 'created_at', type: 'text', default: now },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('memory_items', true);
    await queryRunner.dropTable('story_sections', true);
    await queryRunner.dropTable('stories', true);
  }
}
```

- [ ] **Step 2: Run the migration**

Run: `cd BE && npm run migration:run`
Expected: output includes `Migration CreateLocalTables1756166400003 has been executed successfully.`; `npm run migration:show` lists all three migrations with `[X]` (applied).

- [ ] **Step 3: Verify the FK**

Run: `docker compose exec postgres psql -U ai_bed -d ai_bed -c "\d story_sections"`
Expected: shows a `FOREIGN KEY (story_id) REFERENCES stories(story_id)` constraint.

- [ ] **Step 4: Revert and re-run to confirm `down()` works**

Run:
```bash
cd BE
npm run migration:revert
npm run migration:run
```
Expected: revert drops all three tables without error; re-run recreates them; `npm run migration:show` again lists all three as applied.

- [ ] **Step 5: Commit**

```bash
git add BE/src/database/migrations/1756166400003-CreateLocalTables.ts
git commit -m "feat: add local tables migration"
```

---

### Task 6: Orphan-row check script

**Files:**
- Create: `BE/scripts/check-core-orphans.ts`
- Modify: `BE/package.json`

**Interfaces:**
- Consumes: existing SQLite `core.db` (via `CORE_DB_PATH` env var, default `data/core.db`, same convention as `BE/scripts/create-admin.ts:44`).
- Produces: a printed report and a process exit code (`0` = clean, `1` = orphans found) — read by whoever runs Task 7's copy script as the go/no-go gate (spec §4 Phase 1 step 1). Nothing else in this plan calls it programmatically.

- [ ] **Step 1: Write the script**

Create `BE/scripts/check-core-orphans.ts`:

```typescript
/**
 * Read-only check for rows that reference a tenant/child that doesn't exist.
 * Run before BE/scripts/migrate-core-to-postgres.ts, which adds FK
 * constraints that these rows would violate.
 *
 *   npm run check:core-orphans
 */
import { DataSource } from 'typeorm';
import 'dotenv/config';

interface OrphanCheck {
  label: string;
  sql: string;
}

const CHECKS: OrphanCheck[] = [
  {
    label: 'child_profiles.tenant_id -> tenants.tenant_id',
    sql: `
      SELECT cp.child_id, cp.tenant_id
      FROM child_profiles cp
      LEFT JOIN tenants t ON t.tenant_id = cp.tenant_id
      WHERE t.tenant_id IS NULL
    `,
  },
  {
    label: 'feedbacks.tenant_id -> tenants.tenant_id',
    sql: `
      SELECT f.feedback_id, f.tenant_id
      FROM feedbacks f
      LEFT JOIN tenants t ON t.tenant_id = f.tenant_id
      WHERE t.tenant_id IS NULL
    `,
  },
  {
    label: 'feedbacks.child_id -> child_profiles.child_id',
    sql: `
      SELECT f.feedback_id, f.child_id
      FROM feedbacks f
      LEFT JOIN child_profiles cp ON cp.child_id = f.child_id
      WHERE f.child_id IS NOT NULL AND cp.child_id IS NULL
    `,
  },
];

async function main(): Promise<void> {
  const database = process.env.CORE_DB_PATH || 'data/core.db';
  const ds = new DataSource({ type: 'sqlite', database });
  await ds.initialize();

  let totalOrphans = 0;
  for (const check of CHECKS) {
    const rows: unknown[] = await ds.query(check.sql);
    console.log(`${check.label}: ${rows.length} orphan row(s)`);
    if (rows.length > 0) {
      console.log(JSON.stringify(rows, null, 2));
      totalOrphans += rows.length;
    }
  }

  await ds.destroy();

  if (totalOrphans > 0) {
    console.error(`\n${totalOrphans} orphan row(s) found in ${database}. Resolve before migrating.`);
    process.exit(1);
  }
  console.log(`\nNo orphans found in ${database}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

Modify `BE/package.json` — add next to `"admin:create"` (`BE/package.json:14`):

```json
    "check:core-orphans": "ts-node -P tsconfig.json scripts/check-core-orphans.ts"
```

- [ ] **Step 3: Run it against the existing dev `core.db`**

Run: `cd BE && npm run check:core-orphans`
Expected: exits 0 with `No orphans found in data/core.db.` (per the earlier repo survey, dev data — 6 tenants, 3 child profiles, 1 feedback — has no known orphans; if the script instead reports orphans, stop and resolve them manually before Task 7, per spec §4 Phase 1 step 1 — do not delete rows automatically).

- [ ] **Step 4: Commit**

```bash
git add BE/scripts/check-core-orphans.ts BE/package.json
git commit -m "feat: add core orphan-row check script"
```

---

### Task 7: One-shot core data migration script

**Files:**
- Create: `BE/scripts/migrate-core-to-postgres.ts`
- Modify: `BE/package.json`

**Interfaces:**
- Consumes: `PostgresDataSource` from `BE/src/database/postgres-data-source.ts` (Task 1) as the write target; a separate read-only SQLite `DataSource` (same entities) as the source. Requires Task 3's `child_profiles`/`feedbacks`/`tenants`/`admin_users` migration to have already run against the target (Task 6's orphan check should also have passed).
- Produces: populated `tenants`, `child_profiles`, `admin_users`, `feedbacks`, and the 8 dashboard tables in Postgres; nothing downstream in this plan consumes its output programmatically — Task 8's cutover is a manual step performed after this script reports success.

- [ ] **Step 1: Write the script**

Create `BE/scripts/migrate-core-to-postgres.ts`:

```typescript
/**
 * One-shot, idempotent copy of the `core` datasource (tenants,
 * child_profiles, admin_users, feedbacks, 8 dashboard tables) from SQLite
 * into Postgres. Safe to re-run — every table is upserted by primary key.
 * Never writes to the SQLite source.
 *
 *   npm run migrate:core            # copies and verifies row counts
 *   npm run migrate:core -- --dry-run   # reports source counts only
 */
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import 'dotenv/config';
import { PostgresDataSource } from '../src/database/postgres-data-source';
import { Tenant } from '../src/modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../src/modules/child/entities/child-profile.entity';
import { Feedback } from '../src/modules/feedback/entities/feedback.entity';
import { AdminUser } from '../src/modules/admin/entities/admin-user.entity';
import {
  TrafficEvent,
  TrafficHourly,
  LlmUsageEvent,
  LlmUsageHourly,
  IpRule,
  IpState,
  Alert,
  AdminSetting,
} from '../src/modules/admin/dashboard/entities';

interface TableSpec {
  entity: EntityTarget<ObjectLiteral>;
  label: string;
  conflictColumns: string[];
}

// Order matters: FK-referenced tables (tenants, child_profiles) must be
// copied before the tables that reference them (feedbacks).
const CORE_TABLES: TableSpec[] = [
  { entity: Tenant, label: 'tenants', conflictColumns: ['tenantId'] },
  { entity: ChildProfile, label: 'child_profiles', conflictColumns: ['childId'] },
  { entity: AdminUser, label: 'admin_users', conflictColumns: ['adminId'] },
  { entity: Feedback, label: 'feedbacks', conflictColumns: ['feedbackId'] },
  { entity: TrafficEvent, label: 'traffic_event', conflictColumns: ['id'] },
  { entity: TrafficHourly, label: 'traffic_hourly', conflictColumns: ['ip', 'hourBucket', 'route', 'statusClass'] },
  { entity: LlmUsageEvent, label: 'llm_usage_event', conflictColumns: ['id'] },
  { entity: LlmUsageHourly, label: 'llm_usage_hourly', conflictColumns: ['provider', 'model', 'hourBucket'] },
  { entity: IpRule, label: 'ip_rules', conflictColumns: ['id'] },
  { entity: IpState, label: 'ip_states', conflictColumns: ['ip'] },
  { entity: Alert, label: 'alerts', conflictColumns: ['id'] },
  { entity: AdminSetting, label: 'admin_settings', conflictColumns: ['key'] },
];

function makeSqliteSource(): DataSource {
  const database = process.env.CORE_DB_PATH || 'data/core.db';
  return new DataSource({
    type: 'sqlite',
    database,
    entities: CORE_TABLES.map((t) => t.entity),
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const sqlite = makeSqliteSource();
  await sqlite.initialize();
  await PostgresDataSource.initialize();

  let mismatches = 0;
  for (const table of CORE_TABLES) {
    const sourceRepo = sqlite.getRepository(table.entity);
    const rows = await sourceRepo.find();

    if (dryRun) {
      console.log(`[dry-run] ${table.label}: ${rows.length} row(s) would be copied`);
      continue;
    }

    if (rows.length > 0) {
      const targetRepo = PostgresDataSource.getRepository(table.entity);
      await targetRepo.upsert(rows, table.conflictColumns);
    }

    const sourceCount = rows.length;
    const targetCount = await PostgresDataSource.getRepository(table.entity).count();
    const status = sourceCount === targetCount ? 'OK' : 'MISMATCH';
    if (status === 'MISMATCH') mismatches += 1;
    console.log(`${table.label}: source=${sourceCount} target=${targetCount} ${status}`);
  }

  await sqlite.destroy();
  await PostgresDataSource.destroy();

  if (dryRun) return;

  if (mismatches > 0) {
    console.error(`\n${mismatches} table(s) have mismatched row counts. Investigate before cutting over.`);
    process.exit(1);
  }
  console.log('\nAll core tables copied; row counts match.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

Modify `BE/package.json` — add next to `"check:core-orphans"`:

```json
    "migrate:core": "ts-node -P tsconfig.json scripts/migrate-core-to-postgres.ts"
```

- [ ] **Step 3: Dry-run against the dev SQLite data**

Run: `cd BE && npm run migrate:core -- --dry-run`
Expected: prints one `[dry-run] <table>: N row(s) would be copied` line per table, matching the counts from the earlier repo survey (tenants=6, admin_users=1, child_profiles=3, feedbacks=1, all 8 dashboard tables=0).

- [ ] **Step 4: Run it for real against local Postgres**

Run: `cd BE && npm run migrate:core`
Expected: prints `<table>: source=N target=N OK` for all 12 tables; ends with `All core tables copied; row counts match.`; exits 0.

- [ ] **Step 5: Re-run to confirm idempotency**

Run: `cd BE && npm run migrate:core`
Expected: same output, same `OK` status on every table (upsert makes re-running a no-op on row count).

- [ ] **Step 6: Commit**

```bash
git add BE/scripts/migrate-core-to-postgres.ts BE/package.json
git commit -m "feat: add one-shot core data migration script"
```

---

### Task 8: Cut the `core` datasource over to Postgres

**Files:**
- Modify: `BE/src/app.module.ts:55-66`

**Interfaces:**
- Consumes: `DATABASE_URL` env var (Task 2).
- Produces: the running app's `core` `TypeOrmModule` connection now points at Postgres; every module injecting the `'core'` datasource token (Tenant/Child/Feedback/Admin/Analytics modules) is unaffected at the code level — only the underlying connection changes.

- [ ] **Step 1: Switch the `core` connection's driver**

Modify `BE/src/app.module.ts:55-66`:

```typescript
    TypeOrmModule.forRootAsync({
      name: 'core',
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [Tenant, ChildProfile, Feedback, AdminUser,
          TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
          IpRule, IpState, Alert, AdminSetting],
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
```

(This replaces the `type: 'sqlite'` / `database: config.get('CORE_DB_PATH', ...)` / `synchronize: config.get('NODE_ENV') === 'development'` lines. The `local` connection block directly below, `BE/src/app.module.ts:67-76`, is untouched.)

- [ ] **Step 2: Start the app against Postgres**

Run:
```bash
cd BE
npm run start:dev
```
Expected: app boots without connection errors; logs show the `core` connection established (no SQLite file-lock messages for `core.db`).

- [ ] **Step 3: Smoke-test a `core`-backed endpoint**

Run (with the app still running from Step 2, in another shell):
```bash
curl -s http://localhost:3001/health
```
Expected: `200 OK`. Then exercise one tenant-creating request per the existing manual test flow documented in the repo (e.g. the `/tenant/init` flow referenced in `docs/superpowers/plans/2026-07-27-phase1-mvp-plan.md:867`) and confirm the new row appears via `docker compose exec postgres psql -U ai_bed -d ai_bed -c "select tenant_id, storage_backend from tenants order by created_at desc limit 1"`.

- [ ] **Step 4: Stop the dev server, run the existing automated test suite**

Run: `cd BE && npm test`
Expected: passes unchanged — the test suite's `test-db.ts` (`BE/src/common/__tests__/test-db.ts`) builds its own in-memory SQLite `core`/`local` data sources independent of `app.module.ts`'s runtime config, so this cutover does not affect it.

- [ ] **Step 5: Commit**

```bash
git add BE/src/app.module.ts
git commit -m "feat: cut core datasource over to postgres"
```

---

### Task 9: Migration schema smoke test (testcontainers)

**Files:**
- Create: `BE/src/database/__tests__/migrations.spec.ts`

**Interfaces:**
- Consumes: `PostgresDataSource` (Task 1), the three migration files (Tasks 3-5), `@testcontainers/postgresql`'s `PostgreSqlContainer`.
- Produces: nothing consumed elsewhere — this is a standalone regression test that runs in CI (or locally) without any manually-started `docker compose` Postgres, verifying the migrations are self-contained and correct independent of the dev environment set up in Task 2.

- [ ] **Step 1: Write the test**

Create `BE/src/database/__tests__/migrations.spec.ts`:

```typescript
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../../modules/child/entities/child-profile.entity';
import { Feedback } from '../../modules/feedback/entities/feedback.entity';
import { AdminUser } from '../../modules/admin/entities/admin-user.entity';
import { Story } from '../../modules/story/entities/story.entity';
import { StorySection } from '../../modules/story/entities/story-section.entity';
import { MemoryItem } from '../../modules/memory/entities/memory-item.entity';
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

const EXPECTED_TABLES = [
  'tenants', 'child_profiles', 'feedbacks', 'admin_users',
  'traffic_event', 'traffic_hourly', 'llm_usage_event', 'llm_usage_hourly',
  'ip_rules', 'ip_states', 'alerts', 'admin_settings',
  'stories', 'story_sections', 'memory_items',
];

describe('Postgres migrations', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [
        Tenant, ChildProfile, Feedback, AdminUser,
        TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
        IpRule, IpState, Alert, AdminSetting,
        Story, StorySection, MemoryItem,
      ],
      migrations: [__dirname + '/../migrations/*.ts'],
      synchronize: false,
    });
    await dataSource.initialize();
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  it('creates all 15 tables', async () => {
    await dataSource.runMigrations();

    const rows: { table_name: string }[] = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tableNames = rows.map((r) => r.table_name).sort();

    expect(tableNames).toEqual([...EXPECTED_TABLES].sort());
  });

  it('creates the expected foreign keys', async () => {
    const rows: { table_name: string; constraint_name: string }[] = await dataSource.query(`
      SELECT tc.table_name, tc.constraint_name
      FROM information_schema.table_constraints tc
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);
    const tablesWithFks = rows.map((r) => r.table_name).sort();

    expect(tablesWithFks).toEqual(['child_profiles', 'feedbacks', 'feedbacks', 'story_sections'].sort());
  });

  it('reverts all migrations cleanly', async () => {
    await dataSource.undoLastMigration();
    await dataSource.undoLastMigration();
    await dataSource.undoLastMigration();

    const rows: { table_name: string }[] = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(rows.map((r) => r.table_name)).not.toEqual(expect.arrayContaining(EXPECTED_TABLES));

    // Restore schema so a re-run of this file (e.g. --watch) starts clean.
    await dataSource.runMigrations();
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd BE && npx jest src/database/__tests__/migrations.spec.ts --runInBand`
Expected: 3 passing tests. Requires a local Docker daemon (testcontainers starts its own throwaway Postgres container — it does not use the `docker compose` Postgres from Task 2).

- [ ] **Step 3: Commit**

```bash
git add BE/src/database/__tests__/migrations.spec.ts
git commit -m "test: add postgres migration schema smoke test"
```

---

## Self-review notes

- **Spec coverage:** Phase 0 (foundation, migrations, docker-compose) → Tasks 1-5. Phase 1 (orphan check, FK constraints, one-shot copy script, `storage_backend`/`migrated_at` columns, cutover) → Tasks 3, 6, 7, 8. Phase 1's testing requirement ("migration files get a test that runs them against a throwaway Postgres database and asserts all 15 tables and FK constraints exist") → Task 9. Phases 2-4 and the broader testcontainers migration of the existing test suite (spec §6) are explicitly out of scope for this plan (see "Not in this plan") and will be their own plan once this one is merged and exercised.
- **Type/name consistency checked:** `nowDefaultExpr` signature matches its one call site pattern across Tasks 3-5; `PostgresDataSource` export name and entity list match between Task 1's `postgres-data-source.ts`, Task 7's copy script import, and Task 9's expected-table list; migration class names (`CreateCoreTables1756166400001`, `CreateDashboardTables1756166400002`, `CreateLocalTables1756166400003`) match their file name prefixes, which TypeORM's CLI requires.
- **No placeholders:** every step has concrete code or an exact command; no "add error handling" or "similar to Task N" steps.
