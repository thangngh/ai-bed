# Schema / DB Document — Bedtime Story Companion (MVP)

> **Version:** 3.0
> **Ngày:** 2026-09-04
> **DB Engine:** PostgreSQL 16 — one database
> **ORM:** TypeORM, one datasource (`core`), schema owned by migrations (`synchronize: false`)

---

## 1. Overview

The BE talks to a single PostgreSQL 16 database through one TypeORM
datasource named `core`. All 16 application tables live in it — there is no
split between a "private" and a "user-visible" database any more.

> **History note:** the MVP design (v2.0 of this document) ran two SQLite
> files, `core.db` and `local.db`, on the same host. That split was never
> about client-side or browser storage — both files sat on the BE's own
> disk — it was schema namespacing to avoid exposing internal table design
> through a public API. The frontend's `localStorage` tenant-id cache is a
> separate, unrelated thing and was not touched by the move to Postgres.
> Both files are gone; the tables they held now live together in `core`.

Schema is created and evolved exclusively by five TypeORM migrations under
`BE/src/database/migrations/`, which run automatically at boot
(`migrationsRun: true` in `BE/src/app.module.ts`). `synchronize` is `false`
everywhere, including tests, so the migrations are the only source of schema
truth — entity `@Column` decorators describe the shape TypeORM maps rows
into, not what creates them.

The 16 tables, grouped by what they are for:

| Group | Tables |
|---|---|
| Tenant & core domain | `tenants`, `child_profiles`, `feedbacks`, `admin_users`, `tenant_sessions` |
| Story content | `stories`, `story_sections`, `memory_items` |
| Admin dashboard / analytics | `traffic_event`, `traffic_hourly`, `llm_usage_event`, `llm_usage_hourly`, `ip_rules`, `ip_states`, `alerts`, `admin_settings` |

---

## 2. Timestamp convention

Every `*_at` column is a Postgres `text` column, not a native `timestamp`.
Columns with a DB-side default use the same expression, exported as
`NOW_UTC_TEXT_EXPR` from `BE/src/database/now-default-expr.ts`:

```sql
to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
```

This reproduces the exact `'YYYY-MM-DD HH:MM:SS'` UTC string shape the old
SQLite schema produced with `datetime('now')`. The shape is load-bearing:
`BE/src/common/time/vietnam-time.ts` and `analytics.service.ts` parse these
columns as plain strings in that format to convert between UTC storage and
Vietnam calendar dates. Application code never writes these columns itself —
TypeORM omits them on insert and lets the DB-side default fill them in.

---

## 3. Core Domain Tables

### 3.1 tenants

```sql
CREATE TABLE tenants (
    tenant_id   TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT 'anonymous',
    auth_type   TEXT NOT NULL DEFAULT 'local',   -- 'local' | 'google'
    auth_key    TEXT,                             -- Google `sub`, when auth_type = 'google'
    metadata    TEXT,
    created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    updated_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    email       TEXT                              -- added by AddTenantAuth1756166400004
);

-- Partial unique index: lets every pre-existing anonymous tenant keep a null
-- auth_key without colliding with each other.
CREATE UNIQUE INDEX idx_tenants_auth_provider_key
  ON tenants (auth_type, auth_key) WHERE auth_key IS NOT NULL;
```

`storage_backend` and `migrated_at` existed briefly to drive an abandoned
per-tenant SQLite→Postgres dual-write cutover. `DropStorageBackend1756166400005`
removed both; no application code ever read them.

### 3.2 child_profiles

```sql
CREATE TABLE child_profiles (
    child_id             TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL REFERENCES tenants(tenant_id),
    child_name           TEXT NOT NULL,
    age                  INTEGER NOT NULL,
    interests            TEXT,               -- JSON array, stored as text
    preferred_characters TEXT,               -- JSON array, stored as text
    bedtime_goal         TEXT,
    gender               TEXT,
    language             TEXT NOT NULL DEFAULT 'vi',
    is_active            INTEGER NOT NULL DEFAULT 1,
    created_at           TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    updated_at           TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
```

No `CHECK` on `age` and no DB-level uniqueness on `(tenant_id, child_name)` —
neither exists in the migration. Both are enforced only in the application
layer: DTO validation bounds `age`, and
`ChildService.findByName()` treats more than one match as ambiguous rather
than guessing, which is only possible because the DB *permits* duplicates.

### 3.3 feedbacks

```sql
CREATE TABLE feedbacks (
    feedback_id       TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL REFERENCES tenants(tenant_id),
    story_id          TEXT NOT NULL,        -- no FK: stories lives in the same DB now, but the constraint was never added
    child_id          TEXT REFERENCES child_profiles(child_id),
    listened_complete INTEGER,
    wants_more        INTEGER,
    suitable          INTEGER,
    rating            INTEGER,
    note              TEXT,
    created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
```

### 3.4 admin_users

```sql
CREATE TABLE admin_users (
    admin_id       TEXT PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
    last_login_at  TEXT
);
```

### 3.5 tenant_sessions

Added by `AddTenantAuth1756166400004` to back parent Google sign-in with
refresh-token sessions.

```sql
CREATE TABLE tenant_sessions (
    session_id  TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,   -- SHA-256 of the refresh token; the raw token is never stored
    expires_at  TEXT NOT NULL,
    revoked_at  TEXT,
    created_ip  TEXT,
    created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX idx_tenant_sessions_tenant ON tenant_sessions (tenant_id);
```

This is the one foreign key in the schema with non-default delete behavior:
deleting a tenant cascades to its sessions. Every other FK uses Postgres's
default `NO ACTION`.

---

## 4. Story Content Tables

### 4.1 stories

```sql
CREATE TABLE stories (
    story_id          TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL,     -- no FK declared
    child_id          TEXT,              -- no FK declared
    request_id        TEXT,
    title             TEXT NOT NULL,
    content           TEXT NOT NULL,     -- JSON, stored as text
    structure_json    TEXT,
    theme             TEXT NOT NULL,
    goal              TEXT,
    mood              TEXT,
    language          TEXT NOT NULL DEFAULT 'vi',
    safety_status     TEXT NOT NULL DEFAULT 'PENDING',
    llm_calls         INTEGER NOT NULL DEFAULT 0,
    retry_count       INTEGER NOT NULL DEFAULT 0,
    total_latency_ms  INTEGER,
    word_count        INTEGER,
    is_fallback       INTEGER NOT NULL DEFAULT 0,
    is_saved          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
```

No `CHECK` on `safety_status` and no uniqueness on `request_id` — both are
plain, unconstrained text columns at the DB level; validity is an
application-layer concern.

### 4.2 story_sections

```sql
CREATE TABLE story_sections (
    section_id           TEXT PRIMARY KEY,
    story_id             TEXT NOT NULL REFERENCES stories(story_id),
    tenant_id            TEXT NOT NULL,   -- no FK declared
    section_type         TEXT NOT NULL,
    content              TEXT NOT NULL,
    order_index          INTEGER NOT NULL,
    interaction_prompt   TEXT,
    interaction_options  TEXT
);
```

### 4.3 memory_items

```sql
CREATE TABLE memory_items (
    memory_id            TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL,   -- no FK declared
    child_id             TEXT,
    story_id             TEXT,            -- no FK declared, despite the name
    memory_type          TEXT NOT NULL,
    memory_key           TEXT NOT NULL,
    memory_value         TEXT NOT NULL,
    confidence           REAL NOT NULL DEFAULT 0.5,
    source_text          TEXT,
    source               TEXT,
    last_reinforced_at   TEXT,
    is_active            INTEGER NOT NULL DEFAULT 1,
    expires_at           TEXT,
    created_at           TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);
```

---

## 5. Admin Dashboard & Analytics Tables

Added by `CreateDashboardTables1756166400002`, entirely independent of the
core/content tables above — they back the admin console's traffic and LLM
usage dashboards, IP allow/deny rules, and alerting, and none of them carry
a foreign key.

| Table | Purpose | Key columns |
|---|---|---|
| `traffic_event` | One row per HTTP request (raw log) | `id` (serial PK), `ip`, `route`, `method`, `status`, `bytesIn`, `bytesOut`, `lat_ms`, `ts`. Indexed on `ts`. |
| `traffic_hourly` | Hourly rollup of `traffic_event` | Composite PK `(ip, hour_bucket, route, status_class)`; `req_count`, `bytes_in`, `bytes_out`, `lat_avg_ms`, `lat_p95_max_ms`. |
| `llm_usage_event` | One row per LLM call (raw log) | `id` (serial PK), `provider`, `model`, `tenant_id`, `prompt_tokens`, `completion_tokens`, `est_cost_usd`, `latency_ms`, `is_fallback`, `ts`. Indexed on `ts`. |
| `llm_usage_hourly` | Hourly rollup of `llm_usage_event` | Composite PK `(provider, model, hour_bucket)`; token/cost/latency aggregates. |
| `ip_rules` | Admin-managed allow/deny/tier rules | `id` (serial PK), `type`, `pattern`, `action`, `tier`, `enabled`. Indexed on `enabled` and `pattern`. |
| `ip_states` | Current computed state per IP | `ip` (PK), `status`, `tier`, `score`, `blocked_until`, `auto_blocked`, `reason`, `updated_at`. |
| `alerts` | Raised admin alerts | `id` (serial PK), `type`, `severity`, `ip`, `provider`, `detail_json`, `resolved`, `created_at`, `resolved_at`. Indexed on `(resolved, created_at)`. |
| `admin_settings` | Admin console key/value settings | `key` (PK), `value`, `updated_at`. |

`ts`, `created_at`, `updated_at`, `blocked_until`, and `resolved_at` in this
group are all `varchar` rather than the plain `text` used elsewhere, but hold
the same UTC string shape from `NOW_UTC_TEXT_EXPR` where they default DB-side.

---

## 6. Foreign Keys

Five foreign keys exist in the whole schema. All except one use Postgres's
default `NO ACTION` on delete/update — deleting a referenced row is refused
if any of these still reference it:

| Table.column | References | On delete |
|---|---|---|
| `child_profiles.tenant_id` | `tenants.tenant_id` | NO ACTION |
| `feedbacks.tenant_id` | `tenants.tenant_id` | NO ACTION |
| `feedbacks.child_id` | `child_profiles.child_id` | NO ACTION |
| `story_sections.story_id` | `stories.story_id` | NO ACTION |
| `tenant_sessions.tenant_id` | `tenants.tenant_id` | **CASCADE** |

Everything else that looks like a relationship in the tables above
(`feedbacks.story_id`, `stories.tenant_id`, `stories.child_id`,
`memory_items.story_id`, and the dashboard tables' `tenant_id` columns) is a
plain column with no DB-enforced constraint — integrity there is an
application-level concern, same as before the Postgres cutover.

---

## 7. Connection Management

The BE opens one TypeORM datasource, named `core`, configured from a single
environment variable:

```typescript
// BE/src/app.module.ts
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
    migrationsRun: true,
    synchronize: false,
  }),
  inject: [ConfigService],
}),
```

`DATABASE_URL` is a standard `postgresql://user:password@host:port/db`
connection string (see `BE/.env.example`); there is no default, and the BE
refuses to boot without it. There is no `DB_PATH`, `CORE_DB_PATH`, or
`LOCAL_DB_PATH` any more — `BE/data/` holds only `.gitkeep`.

`migrationsRun: true` applies any pending migration on every boot, so a
fresh database gets the full schema and an already-migrated one is a no-op.
This is safe only because exactly one backend container runs today; running
a second replica without a Postgres advisory lock around this step would let
two boots race the same migration.

---

## 8. Migrations

Schema is owned entirely by five migrations in
`BE/src/database/migrations/`, applied in order:

| Migration | Creates |
|---|---|
| `1756166400001-CreateCoreTables` | `tenants`, `child_profiles`, `feedbacks`, `admin_users` |
| `1756166400002-CreateDashboardTables` | `traffic_event`, `traffic_hourly`, `llm_usage_event`, `llm_usage_hourly`, `ip_rules`, `ip_states`, `alerts`, `admin_settings` |
| `1756166400003-CreateLocalTables` | `stories`, `story_sections`, `memory_items` |
| `1756166400004-AddTenantAuth` | `tenants.email`, the partial unique index on `(auth_type, auth_key)`, and `tenant_sessions` |
| `1756166400005-DropStorageBackend` | Drops `tenants.storage_backend` and `tenants.migrated_at` (dead columns from an abandoned cutover plan) |

Each migration's `down()` reverses it, so the chain is replayable from an
empty database in either direction.

---

## 9. Constraints & Validation

The database enforces almost none of the MVP-era business rules that the
v2.0 SQLite schema described as `CHECK` constraints — none of those
constraints exist in the current migrations. What the DB *does* enforce:

| Constraint | Table | Kind |
|---|---|---|
| `username` unique | `admin_users` | Column-level `UNIQUE` |
| `token_hash` unique | `tenant_sessions` | Column-level `UNIQUE` |
| `(auth_type, auth_key)` unique when `auth_key` is set | `tenants` | Partial unique index |
| Five foreign keys | see §6 | Referential integrity |

Everything else — child age range, feedback rating range, `safety_status`
and `section_type` enums, memory `confidence` range, no-duplicate-child-name
lookups — is validated in the application layer (DTOs with
`class-validator`, and service-level checks like `ChildService.findByName`),
not by the database.

---

## 10. Indexing

The only indexes in the schema are the ones migrations create explicitly.
Primary keys and `UNIQUE` columns get an index automatically; nothing else
does — in particular, none of `child_profiles.tenant_id`,
`feedbacks.tenant_id`, `feedbacks.story_id`, `stories.tenant_id`,
`stories.child_id`, or `memory_items.tenant_id` has an index, despite being
common lookup columns.

| Index | Table | Columns |
|---|---|---|
| `idx_tenants_auth_provider_key` | `tenants` | `(auth_type, auth_key)`, partial unique |
| `idx_tenant_sessions_tenant` | `tenant_sessions` | `tenant_id` |
| (unnamed) | `traffic_event` | `ts` |
| (unnamed) | `llm_usage_event` | `ts` |
| (unnamed) | `ip_rules` | `enabled` |
| (unnamed) | `ip_rules` | `pattern` |
| (unnamed) | `alerts` | `(resolved, created_at)` |
