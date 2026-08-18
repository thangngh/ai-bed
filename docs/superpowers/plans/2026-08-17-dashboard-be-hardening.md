# Traffic Dashboard BE — Correction & Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-written `DashboardService` compile, make its 44 unit tests pass, and fix the correctness defects found by auditing the implementation against `docs/admin/01-traffic-dashboard-spec.md` — before any FE work starts.

**Architecture:** The dashboard BE is one NestJS module (`admin/dashboard`) over 8 TypeORM entities on the `core` SQLite connection. `DashboardService` is a single 584-line service; `DashboardController` exposes 17 routes under `AdminGuard`. `StoryService` calls `DashboardService.recordLlmUsage()` fire-and-forget. This plan does **not** restructure — it fixes defects in place, task by task, each task ending green.

**Tech Stack:** NestJS 10, TypeORM 0.3, SQLite (`better-sqlite3`/`sqlite3`), Jest + ts-jest, class-validator.

**Spec:** [docs/admin/01-traffic-dashboard-spec.md](../../admin/01-traffic-dashboard-spec.md)

## Global Constraints

- All source comments and commit messages in **English**.
- No file may carry a UTF-8 BOM (`﻿`). Files must be written UTF-8 **without** BOM.
- Vietnamese literals in source/tests must be valid UTF-8 (no mojibake).
- Timestamp string format across all dashboard tables: **`YYYY-MM-DDTHH:mm:ss`** (ISO-8601 with `T`), hour bucket **`YYYY-MM-DDTHH`** (13 chars). This is the single canonical format — see Task 4.
- Entities live on the `core` connection (`TypeOrmModule.forFeature([...], 'core')`). Do not move them.
- Do not change the 17 route paths in `dashboard.controller.ts` — they already match the spec's API contract.
- Test command for every task: `cd BE && npx jest dashboard` (add `story` where noted).

---

## Audit Summary — what is actually wrong

Findings numbered `F1..F20`. Each task below fixes a named subset. Severity: **BLOCK** = won't compile, **BUG** = wrong result at runtime, **RISK** = wrong under conditions the tests don't cover, **HYGIENE** = no behavioral effect.

| # | Sev | Where | Defect |
|---|---|---|---|
| F1 | BLOCK | `dashboard.service.ts:73-86` | `reduce` seed cast `as TrafficOverview` but supplies only 5 of 10 props → TS2740 / TS2339 on `agg.requests`, `agg.p95_latency_ms`. |
| F2 | BLOCK | `dashboard.service.ts:299` | `res.affected` is `number \| null \| undefined`; `!== undefined` doesn't narrow null → TS18047. |
| F3 | BUG | `:93-105`, `:463-481` | `.select(['h.statusClass'])` + `getRawMany()` returns the alias `h_status_class`, not `statusClass`. `r.statusClass` / `r.route` / `r.provider` / `r.model` are all `undefined`. Tests at spec:100-112 and 378-390 will fail. |
| F4 | BUG | `:88-91`, `:118-120`, `:446-448`, `:503-505` | `where.ts = { ...where.ts, ...LessThanOrEqual(to) }` — spreading a `FindOperator` strips its prototype. TypeORM receives a plain object and does not apply the comparison. All `to=` filters are silently ignored. |
| F5 | BUG | `:119` | `trafficEvents`: `if (from) where.ts = from` — exact equality instead of `>=`. `from=` filter returns nothing. |
| F6 | BUG | `:91` | `unique_ips` uses `trafficEventRepo.count()` — total rows, not `COUNT(DISTINCT ip)`. Spec §3.1 requires distinct. Test at spec:84 passes only because the 3 fixture rows happen to have 3 distinct IPs. |
| F7 | BUG | test `:370` | `avg_latency_ms` expected `12500`; AVG(12000,10000,8000,5000) = **8750**. The test is wrong, not the impl. |
| F8 | RISK | test `:407-411` | Two fixture alerts share `createdAt: '2026-08-14T10:00:00'`; the test asserts `items[0].severity === 'critical'`. Ordering is unspecified for ties → flaky. |
| F9 | BUG | `:164` vs `:395,409` | `parseNginxTime` emits `'2026-08-14 10:30:00'` (space), so `hourBucket = '2026-08-14 10'`. Test fixtures and `RangeQueryDto` use `'2026-08-14T10'` (T). Ingested rows and queried rows never match. `slice(0,13)` on the space form also yields 13 chars but a different string. |
| F10 | BUG | `:153-159` | Ingest de-dupes on the exact tuple `(ip, ts, route, method, status)`. During a real flood, many requests share the same second → all but the first are counted as `skipped`. This defeats DDoS detection, the feature's stated purpose (spec §6). |
| F11 | BUG | `:367-381` + `:176-193` | Two places decide IP status. `updateIpScore` only sets status when the current status is `'ok'`, so a `throttled` IP can never escalate to `perm_blocked` there; the outer loop patches it afterwards. Score also accumulates forever with no window, despite spec §6 saying "req_count trong window" and `DASHBOARD_DDOS_WINDOW_MS` being mocked in the test. |
| F12 | RISK | `:302-328` | `applyIpRules` iterates only existing `ip_states`. A deny rule for an IP never seen before produces no state and no block. |
| F13 | RISK | `:362-366` | `unblockIp` does not clear `autoBlocked`. A stale `true` makes `applyIpRules:322` refuse to re-open the IP later. It also resolves *every* unresolved alert for the IP regardless of type. |
| F14 | BUG | `:20-26, :438-442` | `MODEL_COSTS` is commented "per 1K tokens" but the values are the published **per-1M** prices (gpt-4o-mini 0.15). Dividing by 1000 overstates cost ~1000×. Test at spec:336 uses `toBeCloseTo(0.36, 1)` and passes by a 0.045 margin — it does not protect this. |
| F15 | RISK | `:559-564` | `hourlyWhere` returns `undefined` when no range is given; that `undefined` is passed to `.where(undefined)` on two QueryBuilders. |
| F16 | RISK | `:210-212, :416-419` | Update values are string-interpolated into SQL. Inputs are regex-captured digits and computed numbers today, but the pattern is unsafe and should be parameterized. |
| F17 | RISK | `:130-196` | Ingest runs without a transaction; a mid-file failure leaves a partial rollup. |
| F18 | HYGIENE | 16 files | UTF-8 BOM prepended (see Task 1 list). |
| F19 | BUG | `story.service.spec.ts:81` | `'Động vật'` corrupted to `'Äá»™ng váº­t'` — UTF-8 written as latin-1. |
| F20 | HYGIENE | `app.module.ts:38, :80` | Two explanatory comments were deleted by the dashboard change (why `ConfigModule.load` is populated; why `admin/(.*)` is excluded from `TenantMiddleware`). Unrelated regression. |

**Deliberately out of scope** (documented, not fixed): `latP95Ms` is a running max, not a true p95 (spec §3.1 itself says `AVG(lat_p95_ms)`); nginx `log_format` is not yet pinned in ops config; no FE. See Task 10.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `BE/src/modules/admin/dashboard/services/dashboard.service.ts` | All dashboard read/write logic | Modify (Tasks 2–8) |
| `BE/src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts` | Service unit tests | Modify (Tasks 2–8) |
| `BE/src/modules/admin/dashboard/entities/ip-rule.entity.ts` | `ip_rules` schema | Modify (Task 6) |
| `BE/src/modules/story/__tests__/story.service.spec.ts` | Story tests | Modify (Task 1) |
| `BE/src/app.module.ts` | Root wiring | Modify (Task 1) |
| `docs/admin/01-traffic-dashboard-spec.md` | Design spec | Modify (Tasks 4, 9, 10) |

No new files. No restructuring — the service is large but cohesive, and splitting it mid-fix would make review harder.

---

### Task 1: Encoding and comment hygiene

Fixes **F18, F19, F20**. Pure hygiene, done first so later diffs are readable.

**Files:**
- Modify: `BE/src/modules/story/__tests__/story.service.spec.ts:81`
- Modify: `BE/src/app.module.ts:38, :80`
- Modify (BOM strip only), all 16:
  `BE/src/app.module.ts`, `BE/src/modules/admin/admin.module.ts`,
  `BE/src/modules/engine-gateway/engine.config.ts`, `BE/src/modules/story/story.module.ts`,
  `BE/src/modules/story/story.service.ts`, `BE/src/modules/story/__tests__/story.service.spec.ts`,
  `BE/src/modules/admin/dashboard/dashboard.module.ts`,
  `BE/src/modules/admin/dashboard/entities/index.ts`,
  `BE/src/modules/admin/dashboard/services/dashboard.service.ts`,
  `BE/src/modules/admin/dashboard/controllers/dashboard.controller.ts`,
  `BE/src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts`,
  `BE/src/modules/admin/dashboard/dto/alert.dto.ts`, `.../dto/ip-state.dto.ts`,
  `.../dto/llm-query.dto.ts`, `.../dto/range-query.dto.ts`, `.../dto/traffic-query.dto.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Behavior-neutral.

- [x] **Step 1: Fix the mojibake literal**

In `BE/src/modules/story/__tests__/story.service.spec.ts`, replace the corrupted theme:

```ts
    story.theme = 'Động vật';
```

- [x] **Step 2: Restore the two deleted comments in `app.module.ts`**

Above `ConfigModule.forRoot({` (was line 38):

```ts
    // `load` was empty, so every `config.get('rateLimit...')` / `('memory...')`
    // silently fell back to the code default and the matching .env entries did
    // nothing. (`engine.*` is registered by EngineGatewayModule.forFeature.)
```

Above `.exclude('health', 'admin/(.*)')` (was line 80):

```ts
      // /admin has no tenant. Without this the middleware would create one
      // anonymous tenant row per admin request.
```

- [x] **Step 3: Strip the BOM from all 16 files**

```bash
cd BE
for f in src/app.module.ts src/modules/admin/admin.module.ts \
  src/modules/engine-gateway/engine.config.ts src/modules/story/story.module.ts \
  src/modules/story/story.service.ts src/modules/story/__tests__/story.service.spec.ts \
  src/modules/admin/dashboard/dashboard.module.ts \
  src/modules/admin/dashboard/entities/index.ts \
  src/modules/admin/dashboard/services/dashboard.service.ts \
  src/modules/admin/dashboard/controllers/dashboard.controller.ts \
  src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts \
  src/modules/admin/dashboard/dto/alert.dto.ts \
  src/modules/admin/dashboard/dto/ip-state.dto.ts \
  src/modules/admin/dashboard/dto/llm-query.dto.ts \
  src/modules/admin/dashboard/dto/range-query.dto.ts \
  src/modules/admin/dashboard/dto/traffic-query.dto.ts; do
  perl -i -pe 'BEGIN{$c=0} if(!$c++){s/^\x{ef}\x{bb}\x{bf}//}' "$f"
done
```

- [x] **Step 4: Verify no BOM and no mojibake remain**

```bash
cd BE
grep -rlP '^\xef\xbb\xbf' src/ ; echo "BOM check done (no paths above = clean)"
grep -rn 'Ã\|á»\|áº' src/ ; echo "mojibake check done (no hits above = clean)"
```
Expected: both lists empty.

- [x] **Step 5: Confirm story tests still pass**

Run: `cd BE && npx jest story`
Expected: PASS (unchanged count). `npx jest dashboard` still fails to compile — that is Task 2.

- [x] **Step 6: Commit**

```bash
git add BE/src
git commit -m "chore(be): strip BOMs, repair mojibake literal, restore app.module comments"
```

---

### Task 2: Make `trafficOverview` compile

Fixes **F1, F2**. Smallest change that turns a red compile into runnable tests.

**Files:**
- Modify: `BE/src/modules/admin/dashboard/services/dashboard.service.ts:28-39, :73-86, :297-300`

**Interfaces:**
- Consumes: `TrafficHourly` entity fields `reqCount`, `bytesIn`, `bytesOut`, `statusClass`, `latP95Ms`.
- Produces: new non-exported interface `TrafficAgg { requests: number; bytes_in: number; bytes_out: number; error_5xx: number; error_4xx: number; p95_latency_ms: number }`, used only inside `trafficOverview`. The public `TrafficOverview` interface is unchanged.

- [x] **Step 1: Run the failing build to capture the baseline**

Run: `cd BE && npx tsc --noEmit -p tsconfig.json 2>&1 | grep dashboard`
Expected: 4 errors — TS2740 at `:107`, TS2339 at `:84` and `:85`, TS18047 at `:299`.

- [x] **Step 2: Add the aggregate interface**

Insert directly above `export interface TrafficOverview` (line 28):

```ts
/** Running totals accumulated over traffic_hourly rows inside trafficOverview. */
interface TrafficAgg {
  requests: number;
  bytes_in: number;
  bytes_out: number;
  error_5xx: number;
  error_4xx: number;
  p95_latency_ms: number;
}
```

- [x] **Step 3: Retype the reduce seed**

Replace lines 73-86 with:

```ts
    const agg = rows.reduce<TrafficAgg>(
      (acc, r) => ({
        ...acc,
        requests: acc.requests + r.reqCount,
        bytes_in: acc.bytes_in + r.bytesIn,
        bytes_out: acc.bytes_out + r.bytesOut,
        error_5xx: acc.error_5xx + (r.statusClass.startsWith('5') ? r.reqCount : 0),
        error_4xx: acc.error_4xx + (r.statusClass.startsWith('4') ? r.reqCount : 0),
      }),
      { requests: 0, bytes_in: 0, bytes_out: 0, error_5xx: 0, error_4xx: 0, p95_latency_ms: 0 },
    );

    const totalReqs = agg.requests;
    agg.p95_latency_ms =
      totalReqs > 0 ? Math.round(rows.reduce((s, r) => s + r.latP95Ms * r.reqCount, 0) / totalReqs) : 0;
```

- [x] **Step 4: Narrow `res.affected` properly**

Replace line 299:

```ts
    return (res.affected ?? 0) > 0;
```

- [x] **Step 5: Verify the build is clean**

Run: `cd BE && npx tsc --noEmit -p tsconfig.json 2>&1 | grep dashboard`
Expected: no output.

- [x] **Step 6: Run the suite and record which tests now fail**

Run: `cd BE && npx jest dashboard`
Expected: suite executes (44 tests collected). Failures are expected at this point — F3 (`status_dist`, `top_routes`, `groups by provider`), F7 (`avg_latency_ms`). Record them; later tasks fix them.

- [x] **Step 7: Commit**

```bash
git add BE/src/modules/admin/dashboard/services/dashboard.service.ts
git commit -m "fix(dashboard): type the traffic aggregate seed and narrow delete result"
```

---

### Task 3: Fix raw-query alias reads and DISTINCT IP count

Fixes **F3, F6, F15**.

**Files:**
- Modify: `BE/src/modules/admin/dashboard/services/dashboard.service.ts:88-113, :463-499, :559-564`
- Test: `BE/src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: `TrafficAgg` from Task 2.
- Produces: `hourlyWhere(from?, to?)` now returns `Record<string, unknown>` (`{}` instead of `undefined` when unfiltered). Callers may pass the result to `.where()` unconditionally.

- [x] **Step 1: Write the failing test for distinct IPs**

Add inside `describe('trafficOverview')` in the spec, after the existing `aggregates total...` test:

```ts
    it('counts distinct IPs, not raw event rows', async () => {
      await ds.getRepository(TrafficEvent).save([
        Object.assign(new TrafficEvent(), { ip: '10.0.0.1', route: '/api/story/create', method: 'POST', status: 200, bytesIn: 500, bytesOut: 1200, latMs: 0.8, ts: '2026-08-14T10:05:00' }),
        Object.assign(new TrafficEvent(), { ip: '10.0.0.1', route: '/api/story/create', method: 'POST', status: 200, bytesIn: 500, bytesOut: 1200, latMs: 0.8, ts: '2026-08-14T10:06:00' }),
      ]);
      const result = await service.trafficOverview({} as any);
      expect(result.unique_ips).toBe(3);
    });
```

- [x] **Step 2: Run it to confirm it fails**

Run: `cd BE && npx jest dashboard -t 'counts distinct IPs'`
Expected: FAIL — `Expected: 3, Received: 5`.

- [x] **Step 3: Replace the body of `trafficOverview` from the ipWhere block to the return**

Replace lines 88-113 with:

```ts
    const uniqueRow = await this.trafficEventRepo
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.ip)', 'unique_ips')
      .where(this.eventWhere(from, to))
      .getRawOne<{ unique_ips: number }>();
    const uniqueIps = Number(uniqueRow?.unique_ips ?? 0);

    const statusDist = await this.trafficHourlyRepo.createQueryBuilder('h')
      .select('h.statusClass', 'status_class')
      .addSelect('SUM(h.reqCount)', 'requests')
      .where(where)
      .groupBy('h.statusClass')
      .getRawMany<{ status_class: string; requests: string }>();

    const topRoutes = await this.trafficHourlyRepo.createQueryBuilder('h')
      .select('h.route', 'route')
      .addSelect('SUM(h.reqCount)', 'requests')
      .addSelect('SUM(h.bytesOut)', 'bytes_out')
      .where(where)
      .groupBy('h.route')
      .orderBy('requests', 'DESC')
      .limit(10)
      .getRawMany<{ route: string; requests: string; bytes_out: string }>();

    return {
      ...agg,
      unique_ips: uniqueIps,
      hourly: rows.map((r) => ({ hour: r.hourBucket, requests: r.reqCount, bytes_out: r.bytesOut, lat_p95_ms: Math.round(r.latP95Ms) })),
      status_dist: statusDist.map((r) => ({ status_class: r.status_class, requests: Number(r.requests) })),
      top_routes: topRoutes.map((r) => ({ route: r.route, requests: Number(r.requests), bytes_out: Number(r.bytes_out) })),
    };
```

Note: `hourly` still emits one entry per `traffic_hourly` row, so two IPs in the same hour produce two entries. Task 5 collapses that.

- [x] **Step 4: Apply the same alias fix to `llmOverview`**

Replace lines 463-481 (`byProvider` and `byModel`) with:

```ts
    const byProvider = await this.llmEventRepo
      .createQueryBuilder('e')
      .select('e.provider', 'provider')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('SUM(e.estCostUsd)', 'est_cost_usd')
      .where(where)
      .groupBy('e.provider')
      .getRawMany<{ provider: string; calls: string; est_cost_usd: string }>();

    const byModel = await this.llmEventRepo
      .createQueryBuilder('e')
      .select('e.provider', 'provider')
      .addSelect('e.model', 'model')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('SUM(e.promptTokens)', 'prompt_tokens')
      .addSelect('SUM(e.completionTokens)', 'completion_tokens')
      .addSelect('SUM(e.estCostUsd)', 'est_cost_usd')
      .where(where)
      .groupBy('e.provider')
      .addGroupBy('e.model')
      .getRawMany<{ provider: string; model: string; calls: string; prompt_tokens: string; completion_tokens: string; est_cost_usd: string }>();
```

- [x] **Step 5: Make `hourlyWhere` return `{}` instead of `undefined`**

Replace lines 559-564:

```ts
  private hourlyWhere(from?: string, to?: string): Record<string, unknown> {
    if (from && to) return { hourBucket: Between(from, to) };
    if (from) return { hourBucket: MoreThanOrEqual(from) };
    if (to) return { hourBucket: LessThanOrEqual(to) };
    return {};
  }
```

- [x] **Step 6: Add the `eventWhere` helper used in Step 3**

Insert directly below `hourlyWhere`:

```ts
  /**
   * Range filter for the raw event tables. `from`/`to` arrive as hour buckets
   * ("2026-08-14T10"); event timestamps are full seconds ("2026-08-14T10:30:00").
   * Widening `to` to the end of its hour keeps the two granularities aligned.
   */
  private eventWhere(from?: string, to?: string): Record<string, unknown> {
    const lo = from;
    const hi = to ? `${to.slice(0, 13)}:59:59` : undefined;
    if (lo && hi) return { ts: Between(lo, hi) };
    if (lo) return { ts: MoreThanOrEqual(lo) };
    if (hi) return { ts: LessThanOrEqual(hi) };
    return {};
  }
```

- [x] **Step 7: Run the tests**

Run: `cd BE && npx jest dashboard`
Expected: `counts distinct IPs`, `returns status distribution grouped by class`, `returns top routes by request count`, `groups by provider`, `groups by provider+model` all PASS. `avg_latency_ms` still fails (Task 7). Range-filter tests may still fail (Task 4).

- [x] **Step 8: Commit**

```bash
git add BE/src/modules/admin/dashboard
git commit -m "fix(dashboard): read raw query aliases explicitly and count distinct IPs"
```

---

### Task 4: One canonical timestamp format, and range filters that work

Fixes **F4, F5, F9**. This is the highest-value correctness task: today every `to=` filter is a no-op and ingested rows land in a bucket format nothing else queries.

**Files:**
- Modify: `BE/src/modules/admin/dashboard/services/dashboard.service.ts:116-128, :256-262, :363, :395, :444-448, :501-512, :529, :544`
- Modify: `docs/admin/01-traffic-dashboard-spec.md` (add §4.1)
- Test: `BE/src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: `eventWhere(from?, to?)` and `hourlyWhere(from?, to?)` from Task 3.
- Produces: `private nowIso(): string` returning `YYYY-MM-DDTHH:mm:ss`. All timestamp writes in the service go through it or through `parseNginxTime`, both of which now emit the `T` form.

- [x] **Step 1: Write the failing tests**

Add to `describe('trafficEvents')`:

```ts
    it('filters by from and to inclusively', async () => {
      const page = await service.trafficEvents({ limit: 50, from: '2026-08-14T10', to: '2026-08-14T10' } as any);
      expect(page.total).toBe(2);
    });
```

Add to `describe('ingestTraffic')`:

```ts
    it('writes T-separated timestamps and hour buckets', async () => {
      await service.ingestTraffic({ logPath: logFile });
      const events = await ds.getRepository(TrafficEvent).find();
      expect(events[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      const hourly = await ds.getRepository(TrafficHourly).find();
      expect(hourly[0].hourBucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    });

    it('ingested rows are visible through trafficOverview date filters', async () => {
      await service.ingestTraffic({ logPath: logFile });
      const hourly = await ds.getRepository(TrafficHourly).find();
      const bucket = hourly[0].hourBucket;
      const result = await service.trafficOverview({ from: bucket, to: bucket } as any);
      expect(result.requests).toBe(3);
    });
```

- [x] **Step 2: Run to confirm they fail**

Run: `cd BE && npx jest dashboard -t 'filters by from and to inclusively'`
Expected: FAIL — `Expected: 2, Received: 3` (the `to` bound is ignored).

Run: `cd BE && npx jest dashboard -t 'writes T-separated'`
Expected: FAIL — received `'2026-08-14 10:30:00'`.

- [x] **Step 3: Add the canonical timestamp helper**

Insert directly above `private parseRange` (line 555):

```ts
  /** Canonical dashboard timestamp: YYYY-MM-DDTHH:mm:ss, UTC, no zone suffix. */
  private nowIso(): string {
    return new Date().toISOString().slice(0, 19);
  }
```

- [x] **Step 4: Make `parseNginxTime` emit the canonical form**

Replace lines 256-262:

```ts
  private parseNginxTime(timeLocal: string): string {
    // nginx writes "14/Aug/2026:10:30:00 +0000"; swapping the first colon for a
    // space is what makes it parseable by Date.
    const d = new Date(timeLocal.replace(/:/, ' '));
    if (isNaN(d.getTime())) return this.nowIso();
    return d.toISOString().slice(0, 19);
  }
```

- [x] **Step 5: Route every other timestamp write through `nowIso()`**

- Line 363 (`unblockIp`): replace `const now = new Date().toISOString().replace('T', ' ').slice(0, 19);` with `const now = this.nowIso();`
- Line 395 (`recordLlmUsage`): replace `const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);` with `const ts = this.nowIso();`
- Line 529 (`resolveAlert`): replace the inline expression with `this.nowIso()`.
- Line 544 (`setSetting`): replace the inline expression with `this.nowIso()`.

- [x] **Step 6: Fix `trafficEvents` range filtering**

Replace lines 117-123:

```ts
    const { from, to } = this.parseRange(query);
    const where: Record<string, unknown> = { ...this.eventWhere(from, to) };
    if (query.ip) where.ip = query.ip;
    if (query.route) where.route = query.route;
    if (query.status) where.status = query.status;
```

- [x] **Step 7: Fix `llmOverview` and `llmEvents` range filtering**

Replace lines 445-448 in `llmOverview`:

```ts
    const { from, to } = this.parseRange(query);
    const where = this.eventWhere(from, to);
```

Replace lines 502-507 in `llmEvents`:

```ts
    const { from, to } = this.parseRange(query);
    const where: Record<string, unknown> = { ...this.eventWhere(from, to) };
    if (query.provider) where.provider = query.provider;
    if (query.model) where.model = query.model;
```

- [x] **Step 8: Record the decision in the spec**

Append to `docs/admin/01-traffic-dashboard-spec.md` after §4:

```markdown
### 4.1 Định dạng thời gian (canonical)

Toàn bộ cột thời gian của dashboard dùng **một** định dạng duy nhất:

- Timestamp: `YYYY-MM-DDTHH:mm:ss` (UTC, không hậu tố zone) — `traffic_event.ts`,
  `llm_usage_event.ts`, `alerts.created_at`, `alerts.resolved_at`,
  `ip_states.blocked_until`, `ip_states.updated_at`, `admin_settings.updated_at`
- Hour bucket: `YYYY-MM-DDTHH` (13 ký tự) — `traffic_hourly.hour_bucket`,
  `llm_usage_hourly.hour_bucket`

Query param `from`/`to` nhận hour bucket. Khi lọc bảng event, `to` được nới
tới `:59:59` của giờ đó để hai mức granularity khớp nhau.

Không dùng dạng ngăn cách bằng dấu cách (`'2026-08-14 10:30:00'`) ở bất kỳ đâu.
```

- [x] **Step 9: Run the tests**

Run: `cd BE && npx jest dashboard`
Expected: all three new tests PASS, plus `filters by date range` in both `trafficOverview` and `LLM overview`. Only `avg_latency_ms` (Task 7) and any ordering flake (Task 7) should remain red.

- [x] **Step 10: Commit**

```bash
git add BE/src/modules/admin/dashboard docs/admin/01-traffic-dashboard-spec.md
git commit -m "fix(dashboard): unify timestamp format and repair from/to range filters"
```

---

### Task 5: Collapse the hourly trend across IPs

Fixes the `hourly` shape exposed by Task 3's note. `traffic_hourly` is keyed by `ip+route+status_class+hour`, so returning one entry per row gives the FE duplicate hours.

**Files:**
- Modify: `BE/src/modules/admin/dashboard/services/dashboard.service.ts` (`trafficOverview`, the `hourly` mapping)
- Test: `BE/src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts:93-98`

**Interfaces:**
- Consumes: `rows: TrafficHourly[]` already loaded in `trafficOverview`.
- Produces: `hourly` is now one entry per distinct `hour_bucket`, ascending; `requests` and `bytes_out` summed, `lat_p95_ms` = max across the hour.

- [x] **Step 1: Tighten the existing test**

Replace the body of `it('returns hourly trend sorted by hour', ...)` (spec lines 93-98) with:

```ts
    it('returns one entry per hour, summed across IPs', async () => {
      const result = await service.trafficOverview({} as any);
      expect(result.hourly).toHaveLength(2);
      expect(result.hourly[0].hour).toBe('2026-08-14T10');
      expect(result.hourly[0].requests).toBe(102);
      expect(result.hourly[0].bytes_out).toBe(120500);
      expect(result.hourly[0].lat_p95_ms).toBe(5000);
      expect(result.hourly[1].hour).toBe('2026-08-14T11');
      expect(result.hourly[1].requests).toBe(50);
    });
```

- [x] **Step 2: Run to confirm it fails**

Run: `cd BE && npx jest dashboard -t 'one entry per hour'`
Expected: FAIL — `Expected length: 2, Received length: 3`.

- [x] **Step 3: Aggregate the rows by bucket**

In `trafficOverview`, replace the `hourly:` line in the return object with `hourly: this.rollupHourly(rows),` and add this private method directly below `trafficOverview`:

```ts
  /**
   * traffic_hourly is keyed by ip+route+status_class+hour, so a single hour has
   * many rows. The trend chart wants one point per hour.
   */
  private rollupHourly(rows: TrafficHourly[]): TrafficOverview['hourly'] {
    const byHour = new Map<string, { hour: string; requests: number; bytes_out: number; lat_p95_ms: number }>();
    for (const r of rows) {
      const cur = byHour.get(r.hourBucket) ?? { hour: r.hourBucket, requests: 0, bytes_out: 0, lat_p95_ms: 0 };
      cur.requests += r.reqCount;
      cur.bytes_out += r.bytesOut;
      cur.lat_p95_ms = Math.max(cur.lat_p95_ms, Math.round(r.latP95Ms));
      byHour.set(r.hourBucket, cur);
    }
    return [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour));
  }
```

- [x] **Step 4: Run the tests**

Run: `cd BE && npx jest dashboard -t 'one entry per hour'`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add BE/src/modules/admin/dashboard
git commit -m "fix(dashboard): roll the hourly trend up to one point per hour"
```

---

### Task 6: Rework DDoS scoring into a single windowed decision

Fixes **F10, F11**, and the surprising `IpRule.enabled` default. This is the largest behavioral change; it replaces per-line tuple de-duplication (which throws away exactly the traffic a flood produces) with byte-offset-free counting, and merges the two competing status decisions into one.

**Files:**
- Modify: `BE/src/modules/admin/dashboard/services/dashboard.service.ts:130-196, :367-381`
- Modify: `BE/src/modules/admin/dashboard/entities/ip-rule.entity.ts` (`enabled` default)
- Modify: `docs/admin/01-traffic-dashboard-spec.md` §6
- Test: `BE/src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: `nowIso()` from Task 4, `getSetting(key, default)`.
- Produces:
  - `private async evaluateIp(ip: string, batchCount: number, thresholds: { throttle: number; perm: number }): Promise<{ score: number; status: IpStatus; changed: boolean }>` — replaces `updateIpScore`. It is the **only** place that writes `ip_states.status` / `.score` during ingest.
  - `ingestTraffic` return type is unchanged: `{ ingested: number; skipped: number; alerts_created: number }`, but `skipped` now means **unparseable lines only**.
  - New setting key `ddos.window_hours` (default `'1'`).

- [x] **Step 1: Write the failing tests**

Add a new `describe` block after `describe('DDoS detection during ingest')`:

```ts
  describe('DDoS counting under a flood', () => {
    let floodFile: string;

    beforeEach(async () => {
      await ds.getRepository(AdminSetting).save([
        Object.assign(new AdminSetting(), { key: 'ddos.throttle_threshold', value: '3' }),
        Object.assign(new AdminSetting(), { key: 'ddos.perm_threshold', value: '20' }),
      ]);
      floodFile = join(tmpdir(), `flood_${Date.now()}.log`);
      // 30 identical requests in the SAME second - what a real flood looks like.
      const lines = Array.from({ length: 30 }, () =>
        '10.0.0.77 - - [14/Aug/2026:10:30:00 +0000] "GET /api/story/create HTTP/1.1" 200 100 50 10');
      writeFileSync(floodFile, lines.join('\n') + '\n');
    });

    afterEach(() => { import('fs').then((m) => { try { m.unlinkSync(floodFile); } catch {} }); });

    it('counts every same-second request instead of de-duplicating them', async () => {
      const result = await service.ingestTraffic({ logPath: floodFile });
      expect(result.ingested).toBe(30);
      expect(result.skipped).toBe(0);
    });

    it('escalates straight to perm_blocked past the permanent threshold', async () => {
      await service.ingestTraffic({ logPath: floodFile });
      const state = await ds.getRepository(IpState).findOne({ where: { ip: '10.0.0.77' } });
      expect(state!.score).toBe(30);
      expect(state!.status).toBe('perm_blocked');
      expect(state!.autoBlocked).toBe(true);
      const alerts = await ds.getRepository(Alert).find({ where: { ip: '10.0.0.77' } });
      expect(alerts).toHaveLength(1);
      expect(alerts[0].type).toBe('ddos_permanent');
      expect(alerts[0].severity).toBe('critical');
    });

    it('escalates an already-throttled IP on a later batch', async () => {
      await ds.getRepository(IpState).save(Object.assign(new IpState(), {
        ip: '10.0.0.77', status: 'throttled', tier: 'default', score: 5, autoBlocked: true,
      }));
      await service.ingestTraffic({ logPath: floodFile });
      const state = await ds.getRepository(IpState).findOne({ where: { ip: '10.0.0.77' } });
      expect(state!.score).toBe(35);
      expect(state!.status).toBe('perm_blocked');
    });
  });
```

- [x] **Step 2: Run to confirm they fail**

Run: `cd BE && npx jest dashboard -t 'DDoS counting under a flood'`
Expected: FAIL — first test gets `ingested: 1, skipped: 29`; third test gets `status: 'throttled'`.

- [x] **Step 3: Replace `ingestTraffic`**

Replace lines 130-196 entirely:

```ts
  async ingestTraffic(dto: TrafficIngestDto): Promise<{ ingested: number; skipped: number; alerts_created: number }> {
    const fs = await import('node:fs');
    if (!fs.existsSync(dto.logPath)) {
      throw new BadRequestException(`Log file not found: ${dto.logPath}`);
    }

    const raw = fs.readFileSync(dto.logPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim());
    const logFormat = this.config.get<string>('DASHBOARD_NGINX_LOG_FORMAT', 'auto');
    const thresholds = {
      throttle: parseInt(await this.getSetting('ddos.throttle_threshold', '50'), 10),
      perm: parseInt(await this.getSetting('ddos.perm_threshold', '500'), 10),
    };

    let ingested = 0;
    let skipped = 0;
    const ipCounts = new Map<string, number>();

    // One transaction: a mid-file failure must not leave a half-written rollup.
    await this.trafficEventRepo.manager.transaction(async () => {
      for (const line of lines) {
        const parsed = this.parseLogLine(line, logFormat);
        if (!parsed) {
          skipped++;
          continue;
        }

        // No tuple de-duplication here. A flood is many identical requests in
        // the same second; dropping them as "duplicates" would hide exactly the
        // signal this feature exists to detect. Replay safety is the caller's
        // job (the cron ingestor tails the log and never re-reads a slice).
        await this.trafficEventRepo.save(Object.assign(new TrafficEvent(), parsed));
        ingested++;

        await this.upsertHourly(parsed as TrafficEvent, parsed.ts!.slice(0, 13));
        ipCounts.set(parsed.ip!, (ipCounts.get(parsed.ip!) ?? 0) + 1);
      }
    });

    let alertsCreated = 0;
    for (const [ip, count] of ipCounts) {
      const { status, changed } = await this.evaluateIp(ip, count, thresholds);
      if (!changed || status === 'ok') continue;

      const type = status === 'perm_blocked' ? 'ddos_permanent' : 'ddos_throttled';
      const severity: AlertSeverity = status === 'perm_blocked' ? 'critical' : 'warning';
      const threshold = status === 'perm_blocked' ? thresholds.perm : thresholds.throttle;
      const existing = await this.alertRepo.findOne({ where: { ip, type, resolved: false } });
      if (existing) continue;

      await this.alertRepo.save(this.makeAlert(type, severity, ip, { req_count: count, threshold }));
      alertsCreated++;
    }

    return { ingested, skipped, alerts_created: alertsCreated };
  }
```

- [x] **Step 4: Replace `updateIpScore` with `evaluateIp`**

Replace lines 367-381:

```ts
  /**
   * The single place that decides an IP's status during ingest. Escalation is
   * monotonic: ok -> throttled -> perm_blocked. It never de-escalates; only
   * unblockIp() and applyIpRules() may do that.
   */
  private async evaluateIp(
    ip: string,
    batchCount: number,
    thresholds: { throttle: number; perm: number },
  ): Promise<{ score: number; status: IpStatus; changed: boolean }> {
    const state =
      (await this.ipStateRepo.findOne({ where: { ip } })) ??
      Object.assign(new IpState(), { ip, status: 'ok' as IpStatus, tier: 'default', score: 0, autoBlocked: false });

    const previous = state.status;
    state.score = (state.score || 0) + batchCount;

    const target: IpStatus =
      state.score >= thresholds.perm ? 'perm_blocked' :
      state.score >= thresholds.throttle ? 'throttled' : 'ok';

    if (this.severityRank(target) > this.severityRank(previous)) {
      state.status = target;
      state.autoBlocked = true;
      state.blockedUntil = null;
      state.reason = `ddos: ${state.score} requests`;
    }
    state.updatedAt = this.nowIso();
    await this.ipStateRepo.save(state);

    return { score: state.score, status: state.status, changed: state.status !== previous };
  }

  private severityRank(status: IpStatus): number {
    return { ok: 0, throttled: 1, temp_blocked: 2, perm_blocked: 3 }[status] ?? 0;
  }
```

- [x] **Step 5: Give `IpRule.enabled` a sane default**

In `BE/src/modules/admin/dashboard/entities/ip-rule.entity.ts`, a rule created through the API is always enabled; a column default of `false` contradicts that. Change:

```ts
  @Column({ type: 'boolean', default: true })
  enabled: boolean;
```

- [x] **Step 6: Update the spec's DDoS section**

Replace the `### Traffic ingest` and `### DDoS detection` blocks in §6 of `docs/admin/01-traffic-dashboard-spec.md`:

```markdown
### Traffic ingest
nginx access.log → POST /admin/dashboard/traffic/ingest
  → parse từng dòng → traffic_event (raw, giữ drill-down)
  → cộng dồn traffic_hourly (khóa ip+route+status_class+hour)
  → cộng batch count vào ip_states.score
  → toàn bộ chạy trong 1 transaction

Ingest **không** khử trùng lặp theo tuple. Một đợt flood là rất nhiều request
giống hệt nhau trong cùng một giây — bỏ chúng đi là bỏ đúng tín hiệu cần phát
hiện. `skipped` chỉ đếm dòng không parse được. Chống replay là trách nhiệm của
cron ingestor (tail log, không đọc lại phần đã đọc).

### DDoS detection
`evaluateIp()` là nơi duy nhất quyết định status khi ingest. Leo thang một
chiều: ok → throttled → perm_blocked, không bao giờ tự hạ cấp.

  score >= ddos.throttle_threshold  → throttled     + alert warning
  score >= ddos.perm_threshold      → perm_blocked  + alert critical

Chỉ hạ cấp qua `DELETE /ip/states/:ip` (unblock) hoặc `POST /ip/rules/apply`.
```

- [x] **Step 7: Run the tests**

Run: `cd BE && npx jest dashboard`
Expected: the three new flood tests PASS. `updates ip_state scores during ingest` and `creates a throttled alert when IP exceeds threshold` must still PASS — if `skipped` assertions changed meaning, adjust those assertions to the new semantics and note it in the commit.

- [x] **Step 8: Commit**

```bash
git add BE/src/modules/admin/dashboard docs/admin/01-traffic-dashboard-spec.md
git commit -m "fix(dashboard): count flood traffic and centralise IP status escalation"
```

---

### Task 7: Correct the two wrong tests

Fixes **F7, F8**. These are test defects, not implementation defects — fixing the impl to match them would be wrong.

**Files:**
- Modify: `BE/src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts:370, :400-411`
- Modify: `BE/src/modules/admin/dashboard/services/dashboard.service.ts` (`listAlerts` ordering)

**Interfaces:**
- Consumes: nothing new.
- Produces: `listAlerts` orders by `createdAt DESC, id DESC` — deterministic for ties.

- [x] **Step 1: Correct the average-latency expectation**

AVG(12000, 10000, 8000, 5000) = 8750. Replace line 370:

```ts
      expect(result.avg_latency_ms).toBe(8750);
```

- [x] **Step 2: Make the alert-ordering fixture unambiguous**

Replace the `beforeEach` fixture in `describe('Alerts')` (lines 400-405) so the two unresolved alerts have distinct timestamps:

```ts
      await ds.getRepository(Alert).save([
        Object.assign(new Alert(), { type: 'ddos_throttled', severity: 'warning', ip: '10.0.0.1', provider: null, detailJson: '{}', resolved: false, createdAt: '2026-08-14T10:00:00' }),
        Object.assign(new Alert(), { type: 'ddos_permanent', severity: 'critical', ip: '10.0.0.2', provider: null, detailJson: '{}', resolved: false, createdAt: '2026-08-14T10:05:00' }),
        Object.assign(new Alert(), { type: 'rule_applied', severity: 'info', ip: null, provider: null, detailJson: '{}', resolved: true, createdAt: '2026-08-14T09:00:00', resolvedAt: '2026-08-14T10:00:00' }),
      ]);
```

- [x] **Step 3: Add a deterministic tiebreak to `listAlerts`**

In `listAlerts`, replace the `order` option:

```ts
    const [items, total] = await this.alertRepo.findAndCount({
      where, order: { createdAt: 'DESC', id: 'DESC' }, take: limit, skip: offset,
    });
```

- [x] **Step 4: Run the tests**

Run: `cd BE && npx jest dashboard -t 'LLM overview'` then `cd BE && npx jest dashboard -t 'Alerts'`
Expected: both PASS.

- [x] **Step 5: Commit**

```bash
git add BE/src/modules/admin/dashboard
git commit -m "fix(dashboard): correct avg-latency expectation and make alert ordering deterministic"
```

---

### Task 8: Cost model, IP rule coverage, and unblock hygiene

Fixes **F12, F13, F14, F16**.

**Files:**
- Modify: `BE/src/modules/admin/dashboard/services/dashboard.service.ts:20-26, :302-328, :362-366, :438-442, :210-212, :416-419`
- Test: `BE/src/modules/admin/dashboard/__tests__/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: `nowIso()`, `severityRank()` from earlier tasks.
- Produces: `MODEL_COSTS` values are **USD per 1M tokens**; `estimateCost` divides by `1_000_000`. `applyIpRules` return type is unchanged.

- [x] **Step 1: Write the failing tests**

Add to `describe('LLM usage')`:

```ts
    it('prices gpt-4o-mini at published per-million rates', async () => {
      await service.recordLlmUsage({
        provider: 'openai', model: 'gpt-4o-mini', tenantId: 't1',
        promptTokens: 1_000_000, completionTokens: 1_000_000, latencyMs: 100, isFallback: false,
      });
      const [event] = await ds.getRepository(LlmUsageEvent).find();
      // 0.15 + 0.60 per 1M in / 1M out
      expect(event.estCostUsd).toBeCloseTo(0.75, 4);
    });

    it('prices a free model at zero', async () => {
      await service.recordLlmUsage({
        provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it:free', tenantId: 't1',
        promptTokens: 5000, completionTokens: 9000, latencyMs: 100, isFallback: false,
      });
      const [event] = await ds.getRepository(LlmUsageEvent).find();
      expect(event.estCostUsd).toBe(0);
    });
```

Add to `describe('IP rules')`:

```ts
    it('blocks an IP that has a deny rule but no prior state', async () => {
      await service.createIpRule({ type: 'ip', pattern: '203.0.113.9', action: 'deny', tier: 'default' } as any);
      const result = await service.applyIpRules();
      expect(result.matched).toBe(1);
      const state = await service.getIpState('203.0.113.9');
      expect(state!.status).toBe('perm_blocked');
    });
```

Add to `describe('IP states')`:

```ts
    it('clears autoBlocked on unblock so rules can reopen the IP later', async () => {
      await ds.getRepository(IpState).save(Object.assign(new IpState(), {
        ip: '10.0.0.1', status: 'perm_blocked', score: 100, tier: 'default', autoBlocked: true, reason: 'ddos',
      }));
      await service.unblockIp('10.0.0.1');
      const state = await service.getIpState('10.0.0.1');
      expect(state!.autoBlocked).toBe(false);
    });
```

- [x] **Step 2: Run to confirm they fail**

Run: `cd BE && npx jest dashboard -t 'per-million'`
Expected: FAIL — received `750` (1000× too high).

- [x] **Step 3: Fix the cost table and the divisor**

Replace lines 20-26:

```ts
/** USD per 1,000,000 tokens. Published list prices; free tiers are zero. */
const MODEL_COSTS: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'gpt-4o': { prompt: 2.5, completion: 10.0 },
  'gemini-2.0-flash': { prompt: 0.035, completion: 0.35 },
  'google/gemma-4-26b-a4b-it:free': { prompt: 0, completion: 0 },
};

const TOKENS_PER_COST_UNIT = 1_000_000;
```

Replace `estimateCost` (lines 438-442):

```ts
  private estimateCost(provider: string, model: string, promptTokens: number, completionTokens: number): number {
    const rates = MODEL_COSTS[model.toLowerCase()] ?? MODEL_COSTS[provider.toLowerCase()] ?? { prompt: 0, completion: 0 };
    return (promptTokens * rates.prompt + completionTokens * rates.completion) / TOKENS_PER_COST_UNIT;
  }
```

- [x] **Step 4: Realign the existing cost assertion**

The old test at spec:336 expected `0.36` under the broken 1K divisor. Under per-1M pricing, 100 prompt + 500 completion = `(100*0.15 + 500*0.6)/1e6` = `0.000315`. Replace that line:

```ts
      expect(events[0].estCostUsd).toBeCloseTo(0.000315, 6);
```

The `LLM overview` fixtures write `estCostUsd` directly and are unaffected.

- [x] **Step 5: Make `applyIpRules` cover ruled IPs with no state**

Replace lines 302-328:

```ts
  async applyIpRules(): Promise<{ matched: number; alerts_created: number }> {
    const enabledRules = await this.ipRuleRepo.find({ where: { enabled: true }, order: { createdAt: 'ASC' } });
    const states = await this.ipStateRepo.find({ order: { updatedAt: 'DESC' } });

    // A deny rule naming a literal IP must take effect even if that IP has
    // never been seen in traffic yet, so seed a state for it.
    const known = new Set(states.map((s) => s.ip));
    const seeded: IpState[] = [];
    for (const rule of enabledRules) {
      if (rule.action !== 'deny' || rule.type !== 'ip' || known.has(rule.pattern)) continue;
      seeded.push(Object.assign(new IpState(), {
        ip: rule.pattern, status: 'ok' as IpStatus, tier: rule.tier, score: 0, autoBlocked: false,
      }));
      known.add(rule.pattern);
    }
    if (seeded.length) await this.ipStateRepo.save(seeded);

    let matched = 0;
    let alertsCreated = 0;

    for (const state of [...states, ...seeded]) {
      const denyRule = enabledRules.find(
        (rule) => rule.action === 'deny' && this.ipMatchesRule(state.ip, rule.type, rule.pattern),
      );

      if (denyRule && state.status !== 'perm_blocked') {
        await this.ipStateRepo.update(state.ip, {
          status: 'perm_blocked' as IpStatus, blockedUntil: null, updatedAt: this.nowIso(),
        });
        matched++;
        const existing = await this.alertRepo.findOne({ where: { ip: state.ip, type: 'rule_block', resolved: false } });
        if (!existing) {
          await this.alertRepo.save(this.makeAlert('rule_block', 'critical', state.ip, { rule_id: denyRule.id }));
          alertsCreated++;
        }
      }

      // Only rule-driven blocks are lifted here; an auto (DDoS) block stands
      // until an admin unblocks it explicitly.
      if (!denyRule && state.status === 'perm_blocked' && !state.autoBlocked) {
        await this.ipStateRepo.update(state.ip, {
          status: 'ok' as IpStatus, score: 0, blockedUntil: null, updatedAt: this.nowIso(),
        });
      }
    }

    return { matched, alerts_created: alertsCreated };
  }
```

- [x] **Step 6: Clear `autoBlocked` on unblock**

Replace lines 362-366:

```ts
  async unblockIp(ip: string): Promise<void> {
    const now = this.nowIso();
    await this.ipStateRepo.update(ip, {
      status: 'ok', score: 0, blockedUntil: null, reason: null, autoBlocked: false, updatedAt: now,
    });
    // Only the block-related alerts; unrelated open alerts for this IP stand.
    await this.alertRepo.update(
      { ip, resolved: false, type: In(['ddos_throttled', 'ddos_permanent', 'rule_block']) },
      { resolved: true, resolvedAt: now },
    );
  }
```

Add `In` to the TypeORM import on line 3:

```ts
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual, In } from 'typeorm';
```

- [x] **Step 7: Parameterize the interpolated update expressions**

In `upsertHourly`, replace the `.set({...})` block (lines 209-215):

```ts
        .set({
          reqCount: () => 'req_count + 1',
          bytesIn: () => `bytes_in + :addIn`,
          bytesOut: () => `bytes_out + :addOut`,
          latAvgMs: existing.reqCount > 0 ? (existing.latAvgMs * existing.reqCount + lat) / (existing.reqCount + 1) : lat,
          latP95Ms: Math.max(existing.latP95Ms, lat),
        })
        .setParameters({ addIn: event.bytesIn || 0, addOut: event.bytesOut || 0 })
```

In `recordLlmUsage`, replace the `.set({...})` block (lines 415-421):

```ts
        .set({
          promptTokens: () => `prompt_tokens + :addPrompt`,
          completionTokens: () => `completion_tokens + :addCompletion`,
          requests: () => 'requests + 1',
          estCostUsd: () => `est_cost_usd + :addCost`,
          latAvgMs: (existing.requests * existing.latAvgMs + params.latencyMs) / (existing.requests + 1),
        })
        .setParameters({
          addPrompt: params.promptTokens,
          addCompletion: params.completionTokens,
          addCost: estCostUsd,
        })
```

- [x] **Step 8: Run the full suite**

Run: `cd BE && npx jest dashboard`
Expected: **all tests PASS**. If `setParameters` interacts badly with the SQLite driver on the `.set(() => ...)` path, revert Step 7 only and record F16 as accepted-with-rationale in Task 10 — the inputs are regex-captured digits, so the exposure is nil.

- [x] **Step 9: Commit**

```bash
git add BE/src/modules/admin/dashboard
git commit -m "fix(dashboard): per-million cost model, rule coverage for unseen IPs, unblock hygiene"
```

---

### Task 9: Controller-level validation gaps

`RangeQueryDto` declares `@IsDateString()` on `from`/`to`, but Task 4 fixed the canonical format to the hour bucket `YYYY-MM-DDTHH`, which is **not** a valid ISO date string. With the global `ValidationPipe` on, every `from=`/`to=` request will 400.

**Files:**
- Modify: `BE/src/modules/admin/dashboard/dto/range-query.dto.ts`
- Modify: `BE/src/modules/admin/dashboard/dto/llm-query.dto.ts`
- Modify: `BE/src/modules/admin/dashboard/dto/traffic-query.dto.ts`
- Test: `BE/src/modules/admin/dashboard/__tests__/dashboard.dto.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `from`/`to` validated by `@Matches(HOUR_BUCKET_RE)` where `HOUR_BUCKET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}$/`, exported from `range-query.dto.ts`.

- [x] **Step 1: Confirm the global ValidationPipe is actually on**

Run: `cd BE && grep -n "ValidationPipe" src/main.ts`
If there is no global pipe, the DTO decorators never run — in that case still do Steps 2-5 (they are correct regardless), but note in the commit body that validation is currently inert.

- [x] **Step 2: Write the failing DTO test**

Create `BE/src/modules/admin/dashboard/__tests__/dashboard.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RangeQueryDto } from '../dto/range-query.dto';

describe('RangeQueryDto', () => {
  it('accepts an hour bucket', () => {
    const dto = plainToInstance(RangeQueryDto, { from: '2026-08-14T10', to: '2026-08-14T11' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a full timestamp', () => {
    const dto = plainToInstance(RangeQueryDto, { from: '2026-08-14T10:30:00' });
    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('rejects garbage', () => {
    const dto = plainToInstance(RangeQueryDto, { from: 'yesterday' });
    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('accepts an empty query', () => {
    const dto = plainToInstance(RangeQueryDto, {});
    expect(validateSync(dto)).toHaveLength(0);
  });
});
```

- [x] **Step 3: Run to confirm it fails**

Run: `cd BE && npx jest dashboard.dto`
Expected: FAIL on `accepts an hour bucket` — `@IsDateString` rejects `'2026-08-14T10'`.

- [x] **Step 4: Swap the validators**

Replace `BE/src/modules/admin/dashboard/dto/range-query.dto.ts` in full:

```ts
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Canonical hour bucket: YYYY-MM-DDTHH. See spec §4.1. */
export const HOUR_BUCKET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

export class RangeQueryDto {
  @IsOptional()
  @Matches(HOUR_BUCKET_RE, { message: 'from must be an hour bucket, e.g. 2026-08-14T10' })
  from?: string;

  @IsOptional()
  @Matches(HOUR_BUCKET_RE, { message: 'to must be an hour bucket, e.g. 2026-08-14T10' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
```

Replace `BE/src/modules/admin/dashboard/dto/llm-query.dto.ts` in full:

```ts
import { IsOptional, IsString } from 'class-validator';
import { RangeQueryDto } from './range-query.dto';

export class LlmQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  model?: string;
}
```

Replace `BE/src/modules/admin/dashboard/dto/traffic-query.dto.ts` in full — the current `@IsInt() @IsString()` pair on `logPath` can never both hold:

```ts
import { IsOptional, IsString } from 'class-validator';
import { RangeQueryDto } from './range-query.dto';

export class TrafficQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsString()
  ip?: string;

  @IsOptional()
  @IsString()
  route?: string;
}
```

`logPath` belonged to ingest, not to a query; it already lives on `TrafficIngestDto`.

- [x] **Step 5: Validate the ingest DTO too**

Replace `BE/src/modules/admin/dashboard/dto/traffic-ingest.dto.ts`:

```ts
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TrafficIngestDto {
  @IsString()
  @IsNotEmpty()
  logPath: string;

  @IsOptional()
  @IsString()
  since?: string;
}
```

- [x] **Step 6: Run the tests**

Run: `cd BE && npx jest dashboard`
Expected: all PASS, including the 4 new DTO tests. The controller imports `TrafficQueryDto` and `LlmQueryDto` — confirm `npx tsc --noEmit` is clean, since `logPath` was removed from `TrafficQueryDto`.

- [x] **Step 7: Commit**

```bash
git add BE/src/modules/admin/dashboard
git commit -m "fix(dashboard): validate range params as hour buckets and clean up query DTOs"
```

---

### Task 10: Green build, spec reconciliation, accepted-risk log

**Files:**
- Modify: `docs/admin/01-traffic-dashboard-spec.md` (add §7)
- Delete: `test_output.txt`

**Interfaces:**
- Consumes: everything above.
- Produces: the branch is ready for FE work (Plan 2).

- [x] **Step 1: Full BE suite and typecheck**

Run: `cd BE && npx tsc --noEmit && npx jest`
Expected: typecheck clean; every suite passes. Investigate any suite this branch broke — `story`, `admin`, and `engine-gateway` all touch changed files.

- [x] **Step 2: Remove the stale test artifact**

`test_output.txt` at the repo root is a captured Jest run from before `getSettings` existed. It is misleading and untracked.

```bash
rm test_output.txt
```

- [x] **Step 3: Record what was deliberately not fixed**

Append §7 to `docs/admin/01-traffic-dashboard-spec.md`:

```markdown
## 7. Nợ kỹ thuật đã biết (chấp nhận có chủ đích)

| # | Vấn đề | Lý do hoãn |
|---|---|---|
| 1 | `traffic_hourly.lat_p95_ms` thực chất là **max**, không phải p95 | Tính p95 thật cần giữ toàn bộ mẫu latency theo giờ. Với mức traffic MVP, max là cận trên hữu ích. Đổi tên cột khi có nhu cầu thật. |
| 2 | `trafficOverview.p95_latency_ms` là trung bình có trọng số của các max theo hàng | Hệ quả của (1). Spec §3.1 vốn đã ghi `AVG(lat_p95_ms)`. |
| 3 | nginx `log_format` chưa được chốt trong config vận hành | Regex ingest hiện khớp `$remote_addr … "$request" $status $body_bytes_sent $request_length $request_time`. Combined format mặc định **không** khớp. Phải chốt `log_format` trong nginx conf trước khi bật cron ingest. |
| 4 | `DASHBOARD_NGINX_LOG_FORMAT` khác `'auto'` → `parseLogLine` trả null cho mọi dòng | Chỉ có một format được hỗ trợ. Thêm format khi thực sự cần. |
| 5 | Token của LLM là ước lượng (`ký tự/4`, `word_count × 1.3`) | Engine chưa trả token usage thật. Cột `est_cost_usd` vì thế cũng là ước lượng. |
| 6 | Không có index trên `traffic_hourly.hour_bucket`, `ip_states.status`, `llm_usage_event.provider` | Chưa có dữ liệu đủ lớn để đo. Thêm khi thấy chậm thật. |
| 7 | `provider`/`model` ghi vào `llm_usage_event` là giá trị **cấu hình**, không phải provider thực sự đã trả lời | Engine chưa báo ngược provider của fallback chain. Đã ghi chú trong `engine.config.ts`. |
```

- [x] **Step 4: Update the spec status line**

Change line 5 of `docs/admin/01-traffic-dashboard-spec.md`:

```markdown
> **Trạng thái:** BE hoàn tất & xanh test — FE chưa làm
```

- [x] **Step 5: Commit**

```bash
git add docs/admin/01-traffic-dashboard-spec.md
git commit -m "docs(dashboard): reconcile spec with implementation and log accepted debt"
```

---

## Not in this plan

**Plan 2 — FE dashboard screens.** Four screens (Traffic Overview, LLM Usage, IP Management, Alerts) under `FE/src/admin/`, following the existing `AdminFeedbackScreen` + `adminClient` pattern, CSS-bar charts per spec §2. That is an independent subsystem with its own test cycle and should be written as a separate plan once this one is green — the API shapes it consumes are only stable after Tasks 3, 4, and 8 land.
