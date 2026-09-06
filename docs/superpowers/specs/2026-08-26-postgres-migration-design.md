# SQLite → PostgreSQL Migration Design

**Date:** 2026-08-26
**Status:** Approved (design), pending implementation plan

> **Superseded (2026-09-03):** Phases 0 and 1 shipped. Phases 2, 3, and 4
> (per-tenant dual-write for the `local` tables, `sync-tenant-to-postgres.ts`,
> and the deferred cleanup) were **dropped** — the only SQLite data was
> throwaway dev data, so the parallel-run cutover had nothing to protect.
> See [2026-09-03-drop-sqlite-design.md](2026-09-03-drop-sqlite-design.md).

**Branch:** `feat/infra-postgres` (off `master`)

## 1. Context

Backend (`BE/`, NestJS 11 + TypeORM 0.3) currently persists data in two SQLite
files, both on the same host/container:

- `core` datasource → `BE/data/core.db` (12 tables: `tenants`, `child_profiles`,
  `feedbacks`, `admin_users`, and 8 admin-dashboard tables — `traffic_event`,
  `traffic_hourly`, `llm_usage_event`, `llm_usage_hourly`, `ip_rules`,
  `ip_states`, `alerts`, `admin_settings`)
- `local` datasource → `BE/data/local.db` (3 tables: `stories`,
  `story_sections`, `memory_items`)

Despite the name, `local.db` is **not** client/browser storage. Per
`docs/02-architecture-document.md:136-255`, the two-file split exists only to
separate schema namespaces on the same server; there is no cloud sync, no
per-device instance. The only real client-side storage today is a plain
`localStorage` cache in the frontend (`bsc_tenant_id`, `bedtime_saved_stories`,
etc. — see `FE/src/App.tsx`, `FE/src/utils/api.ts`) used as an offline
fallback, not a source of truth. This spec does not touch that cache.

Key risks found during investigation:

- **No TypeORM migration files exist anywhere in the repo.** Schema is
  produced by `synchronize: true` when `NODE_ENV=development`
  (`BE/src/app.module.ts:63,73`) plus a partial manual script
  (`BE/scripts/create-all-tables.js`, only 7 of 15 tables). This is the
  primary blocker to any safe schema change and must be fixed first,
  independent of the Postgres move.
- **No FK constraints exist at the DB layer.** Columns like `tenant_id`,
  `child_id`, `story_id` are plain TEXT columns; referential integrity is
  enforced only in application code (one exception: `Story.sections` /
  `StorySection.story`, which does use `@ManyToOne`/`@JoinColumn`, both within
  the `local` datasource).
- Current data volume is tiny (dev/test only): 6 tenants, 1 admin user, 3
  child profiles, 1 feedback, 3 stories, 9 story sections; all 8
  dashboard tables have 0 rows.
- No CI/CD pipeline exists in the repo today (no `.github/workflows`,
  no `.gitlab-ci*`).

## 2. Goals

1. Establish a proper, version-controlled TypeORM migration system for all
   15 tables, replacing `synchronize: true`.
2. Move all data to a single PostgreSQL database, schema `public`.
3. Add real FK constraints for the logical relationships that currently
   exist only in application code, after verifying no orphaned rows.
4. Support a **parallel-run, per-tenant cutover** for the `local` tables
   (`stories`, `story_sections`, `memory_items`) rather than a single
   big-bang switch, so individual tenants can be verified and cut over
   independently.
5. Update local dev infrastructure (docker-compose) to run Postgres.

## 3. Non-goals

- Changing the frontend's `localStorage` fallback cache — out of scope.
- Building true offline-first / client-side database support — no such
  system exists today; not introduced by this spec.
- Zero-downtime cutover for the `core` tables — data volume there is small
  and centrally managed, so a single one-shot migration is sufficient (see
  §4, Phase 1).
- Automatic runtime expiry of the dual-write mechanism. Cleanup is a manual
  step (§4, Phase 4), not a timer.

## 4. Design

### Phase 0 — Foundation (schema, no data movement)

- Add `pg` driver and Postgres TypeORM config, configured via `DATABASE_URL`.
- Write TypeORM migration files covering all 15 tables (the 7 already in
  `create-all-tables.js` plus the 8 dashboard tables currently only produced
  by `synchronize`). Migrations must be runnable against both a fresh
  Postgres database and (for parity testing) SQLite.
- Set `synchronize: false` unconditionally (remove the `NODE_ENV` branch at
  `BE/src/app.module.ts:63,73`).
- Add a `postgres` service to `docker-compose.yml` (image `postgres:16-alpine`,
  named volume) running alongside the existing SQLite-backed `backend`
  service. Do not remove the SQLite volume yet.
- App continues running fully on SQLite; nothing user-facing changes.

**Exit criteria:** migrations create all 15 tables cleanly on an empty
Postgres instance; app still works unchanged on SQLite.

### Phase 1 — One-shot cutover of the `core` datasource

The `core` tables (`tenants`, `child_profiles`, `admin_users`, `feedbacks`,
and the 8 dashboard tables) are administrative/low-volume and not
tenant-partitioned in a way that benefits from incremental cutover, so they
move in a single step:

1. Run an orphan-row check (script, read-only) across the FK relationships
   implied by application code (e.g. `feedbacks.child_id` → `child_profiles.id`,
   `child_profiles.tenant_id` → `tenants.id`). Report findings; do not delete
   anything automatically. If orphans are found, surface them for a manual
   decision before proceeding.
2. Add real FK constraints for these relationships in the Postgres migration.
3. Run a one-shot migration script (`BE/scripts/migrate-core-to-postgres.ts`,
   Node/TypeScript, reusing TypeORM entities) that copies all `core` rows into
   Postgres. Idempotent (upsert by primary key) so it can be re-run safely
   during testing.
4. Add `storage_backend` (`'sqlite' | 'dual' | 'postgres'`, default
   `'sqlite'`) and `migrated_at` (nullable timestamp) columns to the
   `tenants` table in Postgres. These control Phase 2/3.
5. Switch the app's `core` datasource to Postgres. SQLite's `core.db` is no
   longer read or written after this point.

**Exit criteria:** app reads/writes all `core` tables via Postgres; row
counts match between the old SQLite `core.db` and Postgres for every table.

### Phase 2 — Dual-write support for the `local` tables

Modify the repository/service layer for `stories`, `story_sections`, and
`memory_items` to route based on the owning tenant's `storage_backend`
(read from the now-Postgres `tenants` table):

- **`sqlite`** (default): read and write SQLite only — current behavior,
  unchanged.
- **`dual`**: write to both SQLite (authoritative — request success/failure
  follows SQLite) and Postgres (best-effort; failures are logged and queued
  for reconciliation, and never fail the user-facing request). Reads
  continue to come from SQLite.
- **`postgres`**: read and write Postgres only; SQLite is no longer touched
  for this tenant.

This is additive to the existing code path — tenants stay on `sqlite`
(i.e. today's behavior) until explicitly moved by the Phase 3 script.

**Exit criteria:** with a tenant manually flipped to `dual` in a test
environment, writes appear in both databases and a Postgres write failure
does not break the request.

### Phase 3 — Per-tenant sync and cutover script

`BE/scripts/sync-tenant-to-postgres.ts`, idempotent, run per tenant (or for
all tenants still on `sqlite`):

1. Backfill: copy all existing `local` rows for the tenant from SQLite into
   Postgres (upsert by primary key).
2. Set `storage_backend = 'dual'` for the tenant.
3. Reconciliation check: compare row counts (and a content hash per row) for
   the tenant's `local` tables between SQLite and Postgres.
4. If reconciliation passes, set `storage_backend = 'postgres'` (cuts SQLite
   for this tenant) and set `migrated_at`. If it fails, leave the tenant on
   `dual` and report the mismatch — do not cut over automatically.

Script is safe to re-run at any point in this sequence.

**Exit criteria:** running the script for a tenant moves it from `sqlite` →
`dual` → `postgres` with matching data at each check; re-running after
completion is a no-op.

### Phase 4 — Cleanup (manual, ≥15 days after the last tenant cuts over)

Once every tenant is on `storage_backend = 'postgres'` and has been stable
for at least 15 days, a separate cleanup PR:

- Removes the dual-write code path and the `storage_backend`/`migrated_at`
  columns and routing logic.
- Removes the SQLite `local` datasource config from `app.module.ts`.
- Removes the SQLite volume/mount from `docker-compose.yml`.
- Deletes the SQLite `.db` files.

This is a manual milestone, not an automated timer — nothing in the code
self-disables after 15 days.

## 5. Rollback

- **Phase 0/1:** SQLite files are never modified by the migration scripts
  (read-only source). Rolling back means pointing the `core` datasource
  config back at SQLite; no data restore needed.
- **Phase 2/3, tenant on `dual`:** SQLite remains authoritative, so rollback
  is simply setting `storage_backend` back to `'sqlite'` for that tenant.
- **Phase 2/3, tenant on `postgres`:** rollback requires restoring that
  tenant's SQLite writes from the last known-good backfill plus replaying
  any Postgres-only writes since cutover; this is the one case that is not
  free, which is why reconciliation in Phase 3 step 3 must pass before
  cutover.
- **Phase 4:** not reversible (SQLite files deleted) — only performed after
  the 15-day stability window.

## 6. Testing

- Replace SQLite `:memory:` test fixtures with Postgres via testcontainers
  for tests covering `core` and `local` entities.
- Add tests specific to the `dual` storage path: writes land in both stores;
  a simulated Postgres failure during `dual` does not fail the request;
  reconciliation correctly detects a mismatched row.
- Migration files themselves get a test that runs them against a throwaway
  Postgres database and asserts all 15 tables and the expected FK
  constraints exist.

## 7. Open items for the implementation plan

- Exact reconciliation strategy for Phase 3 step 3 (row count only vs.
  content hash per row) — content hash recommended given the low row counts
  involved.
- Whether `BE/scripts/create-all-tables.js` should be deleted once the
  TypeORM migrations cover the same 7 tables (recommended: yes, to avoid two
  competing sources of schema truth).
