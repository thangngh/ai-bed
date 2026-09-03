# Drop SQLite — Complete the Postgres Cutover

**Date:** 2026-09-03
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/drop-sqlite-storage` (off `master`)
**Supersedes:** Phases 2, 3, and 4 of
[2026-08-26-postgres-migration-design.md](2026-08-26-postgres-migration-design.md)

## 1. Context

The 2026-08-26 spec's Phase 0 (migrations, `synchronize: false`, Postgres in
docker-compose) and Phase 1 (one-shot cutover of the `core` datasource) have
landed on `master`. What is left is SQLite residue spread across runtime code,
scripts, the container image, the test suite, and the docs.

State found on 2026-09-03, on this branch:

- **The BE does not boot on any path.** `app.module.ts` has an uncommitted
  change removing the `name: 'local'` `TypeOrmModule.forRootAsync` block, but
  `StoryModule`, `MemoryModule`, and `AnalyticsModule` still call
  `forFeature([...], 'local')`, so Nest cannot resolve `LOCAL_TOKEN`.
  (Read from the code; not verified by an actual boot.)
- **The `sqlite3` native binding is not built** in the current
  `node_modules`. Running
  `BE/src/modules/tenant/__tests__/tenant.service.spec.ts` fails with
  `Could not locate the bindings file`, 4/4 tests failing. The likely cause is
  the repo's recent move to pnpm (both `package-lock.json` and an untracked
  `pnpm-lock.yaml` are present) — pnpm does not run native build scripts
  without explicit approval. So the **17 spec files that use the SQLite
  `:memory:` fixture are already red**, independent of this work.
- **The dev Postgres database is empty.** The `postgres:16-alpine` container is
  up and healthy, but `\dt` reports "Did not find any relations" — migrations
  have never been run against it.
- 14 entity columns still declare `default: () => "datetime('now')"`, a SQLite
  function. Harmless today only because `synchronize` is `false` everywhere
  (TypeORM omits undefined columns on insert and the migration-created DB-side
  default applies). It becomes a live bug the moment anyone enables
  `synchronize`.
- `tenants.storage_backend` and `tenants.migrated_at` exist in
  `1756166400001-CreateCoreTables.ts` purely to drive the dual-write phases.
  No code reads either column.

## 2. Goals

1. Remove every SQLite code path, dependency, script, config key, volume, and
   doc reference from the repo.
2. Collapse the two TypeORM datasources into one Postgres datasource holding
   all 16 tables.
3. Move the test suite onto real Postgres so tests run against the production
   dialect.
4. Leave the BE bootable and the full test suite green.

## 3. Non-goals

- Migrating the existing `BE/data/core.db` / `local.db` rows. That data is
  dev-only throwaway (6 tenants, 3 child profiles, 3 stories, 9 sections, 1
  admin, 1 feedback; all 8 dashboard tables empty). Decision: discard, and
  recreate the admin user with `admin:create`.
- The npm/pnpm dual-lockfile situation. Explicitly out of scope; once `sqlite3`
  is gone, the missing native binding stops mattering, so the two lockfiles are
  a separate (still real) problem.
- The frontend's `localStorage` fallback cache.
- Optimizing `admin-feedback.service.ts` to join story titles in one query.
  Now possible with a single datasource, but it is a behavior change, not
  SQLite removal — deferred to a follow-up.
- A CI pipeline. None exists in the repo.

## 4. Design

### 4.1 Resulting architecture

One Postgres database, one TypeORM datasource named `core`, holding all 16
tables. Migrations are the single source of schema truth — no
`create-all-tables.js`, and no `synchronize: true` anywhere including tests.
No dual-write and no `storage_backend` routing: because the old dev data is
discarded, the 2026-08-26 spec's per-tenant parallel-run cutover has nothing
left to protect and is dropped.

The datasource keeps the name `core` rather than becoming the unnamed default
connection. `core` is a poor name for a sole datasource, but renaming would
touch every `forFeature` call and every `getDataSourceToken` in the tests, and
a missed one fails at boot with no compile-time signal. Not worth the risk in
the same change that rewrites the whole test harness.

### 4.2 Runtime code

| File | Change |
|---|---|
| `BE/src/app.module.ts` | Single `forRootAsync({ name: 'core' })`; add `Story`, `StorySection`, `MemoryItem` to `entities`; add `migrations` + `migrationsRun: true`. The already-removed `local` block stays removed. |
| `BE/src/modules/story/story.module.ts` | `forFeature([Story, StorySection], 'local')` → `'core'` |
| `BE/src/modules/memory/memory.module.ts` | `forFeature([MemoryItem], 'local')` → `'core'` |
| `BE/src/modules/analytics/analytics.module.ts` | Three `forFeature` calls collapse to one on `'core'`; `analytics.service.ts` drops its second-datasource references |
| `BE/src/database/now-default-expr.ts` | Drop the SQLite branch; export a constant `NOW_UTC_TEXT_EXPR`. The Postgres expression is unchanged, so a fresh DB gets a byte-identical schema and environments where the migrations already ran stay compatible. |
| 14 entity columns | `default: () => "datetime('now')"` → the shared constant above |
| `BE/src/config/app.config.ts` | Delete `coreDbPath` and `localDbPath` |
| New migration `...005-DropStorageBackend` | Drop `tenants.storage_backend` and `tenants.migrated_at` |

`BE/src/common/time/vietnam-time.ts` and `analytics.service.ts:57` keep parsing
the `'YYYY-MM-DD HH:MM:SS'` text format — the migrations deliberately reproduce
that exact shape on Postgres via
`to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`, so the logic
stays correct. Only their "SQLite" comments are updated, so a future reader
does not conclude the code is dead.

### 4.3 Scripts

| Script | Disposition |
|---|---|
| `create-all-tables.js` | Delete — competing source of schema truth, raw `sqlite3` |
| `create-tenants.js` | Delete — duplicate of the `.ts` version |
| `migrate-core-to-postgres.ts` | Delete — one-shot, no longer migrating anything |
| `check-core-orphans.ts` | Delete — only meaningful before a SQLite→PG copy |
| `create-admin.ts` | Rewrite against `DATABASE_URL`; still needed to recreate the admin user |
| `create-tenants.ts` | Rewrite against `DATABASE_URL`; dev seed |

`package.json` then drops `sqlite3` from `dependencies` and drops the
`db:init`, `migrate:core`, and `check:core-orphans` scripts.

### 4.4 Test harness

Shared infrastructure, using one container and a template database:

- **`jest.globalSetup`** starts one `PostgreSqlContainer`, runs the migrations
  into a database named `tpl`, closes every connection to `tpl` (Postgres
  refuses `CREATE DATABASE ... TEMPLATE` while any session is attached), and
  publishes the connection URI for the workers.
- **`makeTestDataSource()`** issues `CREATE DATABASE test_<random> TEMPLATE
  tpl` — Postgres copies the files, so this is near-instant and pays the
  migration cost only once — and returns a `DataSource` pointed at it.
  Teardown `destroy()`s and drops the database.
- `BE/src/common/__tests__/test-db.ts` is rewritten: `openTestDataSources()`
  becomes `openTestDataSource()` returning one datasource; `LOCAL_TOKEN` and
  `makeDataSource` are deleted.
- The 17 affected spec files move to the new API. `datasource.spec.ts` changes
  from asserting "two datasources exist" to "one datasource with all 16
  entities registered".
- `jest.testTimeout` rises to cover container startup and `CREATE DATABASE`,
  with a separate longer timeout for `globalSetup`.
- `@testcontainers/postgresql` becomes a dev dependency of the whole suite
  rather than CLI/smoke-test-only.

**Known risk, stated up front:** those 17 spec files are already failing, so
switching them to real Postgres will likely surface assertions that only
passed because SQLite was permissive — result ordering without an explicit
`ORDER BY`, type coercion between text and integer, `LIKE` case sensitivity.
It cannot be promised that swapping the fixture is sufficient. The
implementation plan therefore carries a separate task for "fix the tests that
the dialect change exposes", with an unknown count going in.

### 4.5 Docker and infrastructure

- `BE/Dockerfile`: drop `apk add python3 make g++` and the `.build-deps`
  virtual package (they exist only to compile `sqlite3`); drop the
  `create-all-tables.js` `COPY`; drop `mkdir -p data`; `CMD` becomes
  `node dist/main`. Re-enable `read_only` for the backend service if nothing
  else writes under `/app` — to be verified during implementation, not
  assumed.
- `docker-compose.yml`: remove the `be-data:/app/data` mount and the `be-data`
  volume, and the "Not read_only: SQLite needs to write…" comment.
- `BE/.env.example`: remove `CORE_DB_PATH` and `LOCAL_DB_PATH`.
- `BE/.dockerignore`, `.gitignore`, `BE/.gitignore`: remove the `*.db` entries.
- Delete `BE/data/core.db` and `BE/data/local.db`. These are gitignored and
  untracked, so deletion is a local-filesystem action, not a commit. Both files
  were copied to the session scratchpad first.
- The commented-out `networks:` blocks in `docker-compose.yml` are an unrelated
  uncommitted local change. They are left exactly as found — not reverted, not
  committed as part of this work.

### 4.6 Documentation

- `README.md` lines 39, 151, 221, 262 and `docs/02-architecture-document.md`
  still describe "SQLite (dual: core.db + local.db)" — update to the single
  Postgres datasource.
- Add a note to `2026-08-26-postgres-migration-design.md` recording that its
  Phases 2-4 are superseded by this spec.

## 5. Verification

Every item must be run, with output checked — no claim of completion from
inspection alone.

1. `docker compose up -d postgres`, then `npm run migration:run`; `psql \dt`
   shows all 16 tables.
2. `npm run lint` (`tsc --noEmit`) clean.
3. `npm test` fully green, and
   `grep -ri sqlite BE/src BE/scripts BE/package.json` returns nothing beyond
   deliberate historical notes inside migration files.
4. `docker compose build backend && docker compose up -d`; `/health` returns
   200 and the logs show no migration error.
5. Destroy the `pg-data` volume and bring the stack up again: the app creates
   the schema itself via `migrationsRun` and boots. This is the proof that
   auto-migrate-on-boot actually replaces `create-all-tables.js`.
6. `npm run admin:create` creates an admin in Postgres and that admin can log
   in to `/admin`.

## 6. Rollback

There is no "point the config back at SQLite" any more. Rollback is
`git revert` of this work. The old dev data survives only as the scratchpad
copies of the two `.db` files. This is the intended outcome, but it means the
change is one-way once the branch merges.

## 7. Open items for the implementation plan

- Whether the `backend` service can actually run `read_only: true` once the
  data volume is gone — depends on whether anything else writes under `/app`
  at runtime. Verify, do not assume.
- How many of the 17 spec files need real assertion fixes (not just fixture
  swaps) after moving to Postgres. Unknown until the harness lands; the plan
  should sequence the harness first so this becomes measurable early.
- Whether `migrationsRun: true` needs a Postgres advisory lock before the
  stack ever runs more than one backend replica. Single container today, so
  out of scope here, but the code should carry a comment saying so.
