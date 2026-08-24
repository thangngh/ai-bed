# Admin Dashboard FE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the IP Management and Alerts screens of the admin console on top of the existing BE dashboard API, plus the shared FE infrastructure they need.

**Architecture:** Two new routes (`/admin/ip`, `/admin/alerts`) nested under a shared `AdminLayout`. Reads go through one hook (`useAdminResource`) that owns loading, 401 redirect, error-message mapping and optional polling; writes go through a sibling hook (`useAdminAction`). The URL is the single source of truth for every server-side filter. Two BE fixes land first because the FE cannot work without them.

**Tech Stack:** BE — NestJS 10, TypeORM 0.3, class-validator, Jest + ts-jest. FE — React 19, Vite 6, react-router-dom 7, Tailwind 4, Vitest 4 + @testing-library/react + @testing-library/user-event. No data-fetch library, no chart library.

**Spec:** `docs/superpowers/specs/2026-08-20-admin-dashboard-fe-design.md`

## Global Constraints

- Comments and commit messages in **English**. Never comment in another language.
- No UTF-8 BOM in any file. Vietnamese literals must be valid UTF-8.
- Do not change any of the 17 BE dashboard route paths.
- BE entities stay on the `core` connection.
- `adminFetch` must never use `apiClient` / `ensureTenantId()` — opening the console must not create tenant rows.
- Do not add any dependency. No data-fetch library, no chart library.
- BE test command: `cd BE && npx jest dashboard` (filter-specific tasks also run `npx jest http-exception`).
- FE test command: `cd FE && npx vitest run src/admin`.
- Every commit is TDD: failing test first, then the minimal implementation.

---

## File Structure

**BE — modify:**

| File | Responsibility after this plan |
|---|---|
| `BE/src/modules/admin/dashboard/dto/rule.dto.ts` | Validated create-rule body; every field it declares is one the service reads |
| `BE/src/common/filters/http-exception.filter.ts` | Normalize both our own `{error:{code,message}}` exceptions and Nest's built-in `{statusCode,message,error:'Bad Request'}` shape into one client contract |
| `BE/src/modules/admin/dashboard/__tests__/dashboard.dto.spec.ts` | Add `RuleDto` pipe coverage |
| `BE/src/common/__tests__/http-exception.filter.spec.ts` | Add plain-message exception coverage |

**FE — create (all under `FE/src/admin/`):**

| File | Responsibility |
|---|---|
| `dashboardTypes.ts` | Response and request shapes for the dashboard API |
| `parseUtc.ts` | Parse the BE's zone-less UTC timestamps; format them for display |
| `dashboardClient.ts` | The 10 dashboard API calls, nothing else |
| `useAdminResource.ts` | `useAdminResource` (read: loading/401/error/polling), `useAdminAction` (write: busy/error/401), `messageFor` |
| `AdminLayout.tsx` | Chrome shared by every authenticated admin screen: tab nav, logout, `<Outlet>` |
| `IpRuleForm.tsx` | Create/edit form for one rule |
| `IpRulesTable.tsx` | Render rules; emit toggle/edit/delete intents |
| `IpStatesTable.tsx` | Render IP states; emit unblock intent |
| `IngestPanel.tsx` | logPath input, ingest trigger, result/error display |
| `AdminIpScreen.tsx` | Compose the three IP blocks; own URL state, confirms, refetch fan-out |
| `AlertsTable.tsx` | Render alerts; expandable detail row; emit resolve intent |
| `AdminAlertsScreen.tsx` | Own alerts URL state, polling toggle, resolve action |

**FE — modify:**

| File | Change |
|---|---|
| `adminClient.ts` | `adminFetch` becomes exported |
| `AdminApp.tsx` | Routes nested under `AdminLayout` |
| `AdminFeedbackScreen.tsx` | Drop its own chrome, adopt `useAdminResource` |
| `__tests__/AdminFeedbackScreen.test.tsx` | Update assertions for the two changes above |

---

## Task 1: BE — validate the create-rule body

`POST /admin/dashboard/ip/rules` currently discards its entire body. The global `ValidationPipe` (`BE/src/common/pipes/validation.pipe.ts:26`) runs `validate(object, { whitelist: true })`, and `whitelist` deletes every property without a validation decorator. `RuleDto` decorates only `id`, so `type`, `pattern`, `action`, `tier` and `note` are all stripped before `createIpRule` ever sees them.

**Files:**
- Modify: `BE/src/modules/admin/dashboard/dto/rule.dto.ts`
- Test: `BE/src/modules/admin/dashboard/__tests__/dashboard.dto.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `RuleDto` with fields `type: 'ip'|'cidr'`, `pattern: string`, `action: 'allow'|'deny'`, `tier?: string`, `note?: string|null`. Task 3 mirrors this as the FE `CreateRuleBody`.

- [ ] **Step 1: Write the failing test**

Append to `BE/src/modules/admin/dashboard/__tests__/dashboard.dto.spec.ts`. Match the existing file's import style — if it already imports `ValidationPipe` and `ArgumentMetadata`, reuse those imports instead of duplicating them.

```ts
import { ValidationPipe } from '../../../../common/pipes/validation.pipe';
import { RuleDto } from '../dto/rule.dto';
import type { ArgumentMetadata } from '@nestjs/common';

describe('RuleDto', () => {
  const pipe = new ValidationPipe();
  const meta = { type: 'body', metatype: RuleDto } as ArgumentMetadata;

  const valid = { type: 'ip', pattern: '10.0.0.9', action: 'deny', tier: 'default', note: 'probe' };

  it('keeps every field the service reads', async () => {
    // whitelist: true drops undecorated properties, so a DTO that declares a
    // field without decorating it silently loses it before the handler runs.
    const out: any = await pipe.transform({ ...valid }, meta);
    expect(out.type).toBe('ip');
    expect(out.pattern).toBe('10.0.0.9');
    expect(out.action).toBe('deny');
    expect(out.tier).toBe('default');
    expect(out.note).toBe('probe');
  });

  it('rejects a body with no type', async () => {
    await expect(pipe.transform({ pattern: '10.0.0.9', action: 'deny' }, meta)).rejects.toThrow();
  });

  it('rejects an unknown action', async () => {
    await expect(pipe.transform({ ...valid, action: 'drop' }, meta)).rejects.toThrow();
  });

  it('rejects an empty pattern', async () => {
    await expect(pipe.transform({ ...valid, pattern: '' }, meta)).rejects.toThrow();
  });

  it('defaults tier when the caller omits it', async () => {
    const out: any = await pipe.transform({ type: 'cidr', pattern: '10.0.0.0/24', action: 'deny' }, meta);
    expect(out.tier).toBe('default');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd BE && npx jest dashboard.dto -t "keeps every field the service reads"`
Expected: FAIL — `out.type` is `undefined` because `whitelist` stripped it.

- [ ] **Step 3: Add the decorators**

Replace the whole of `BE/src/modules/admin/dashboard/dto/rule.dto.ts`:

```ts
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RuleAction, RuleType } from '../entities/ip-rule.entity';

/**
 * Every field here must carry a decorator. The global ValidationPipe runs
 * validate(..., { whitelist: true }), which deletes undecorated properties --
 * so an undecorated field is not "unvalidated", it is gone by the time
 * createIpRule reads it.
 *
 * `pattern` is deliberately not shape-checked: one regex covering IPv4, IPv6
 * and CIDR is easy to get subtly wrong, and erring strict would reject
 * patterns an operator legitimately needs. Logged as accepted debt #9.
 */
export class RuleDto {
  @IsOptional() @IsInt() id?: number;

  @IsIn(['ip', 'cidr'])
  type!: RuleType;

  // 64 matches the ip_rules.pattern column width.
  @IsString() @IsNotEmpty() @MaxLength(64)
  pattern!: string;

  @IsIn(['allow', 'deny'])
  action!: RuleAction;

  @IsOptional() @IsString()
  tier: string = 'default';

  @IsOptional() @IsString()
  note?: string | null;
}
```

- [ ] **Step 4: Run the dashboard suite**

Run: `cd BE && npx jest dashboard`
Expected: PASS, including the five new tests. If `defaults tier when the caller omits it` fails, `plainToInstance` did not apply the class property initializer — in that case keep the initializer and add `@IsOptional()` before `@IsString()` (already the case above) and re-run; do not change the service.

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/admin/dashboard/dto/rule.dto.ts BE/src/modules/admin/dashboard/__tests__/dashboard.dto.spec.ts
git commit -m "fix(dashboard): validate RuleDto so the create-rule body survives the pipe"
```

---

## Task 2: BE — stop the exception filter from dropping plain messages

`HttpExceptionFilter` reads `(res as any).error ?? (res as any)`. For our own exceptions the response is `{ error: { code, message } }`, so `res.error` is the object we want. For Nest's built-in exceptions the response is `{ statusCode: 400, message: 'Log path is outside…', error: 'Bad Request' }` — so `res.error` is the **status text**, and the body sent to the client becomes `{ error: 'Bad Request' }`. The client then reads `body?.error?.code` and `body?.error?.message` as `undefined`, losing the only useful part.

This blocks spec §4.6 (the ingest panel showing the BE's own message) and makes every `NotFoundException` in the dashboard controller indistinguishable from a generic failure.

**Files:**
- Modify: `BE/src/common/filters/http-exception.filter.ts`
- Test: `BE/src/common/__tests__/http-exception.filter.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: guaranteed error body `{ error: { code: string, message: string }, request_id: string }` for every `HttpException`. Task 4's `adminFetch` and Task 5's `messageFor` depend on this.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('HttpExceptionFilter', ...)` in `BE/src/common/__tests__/http-exception.filter.spec.ts`. `BadRequestException` is already imported there; add `NotFoundException` to that import.

```ts
  it('keeps the message of an exception thrown with a plain string', () => {
    // Nest builds { statusCode, message, error: 'Bad Request' } here. Reading
    // `.error` off that yields the status text, not an error object -- the
    // message the thrower wrote is the whole point and must survive.
    filter.catch(
      new BadRequestException('Log path is outside the configured log directory'),
      hostWith({ requestId: 'req-1', method: 'POST', url: '/admin/dashboard/traffic/ingest' }),
    );

    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.message).toBe('Log path is outside the configured log directory');
    expect(typeof body.error.code).toBe('string');
    expect(mockResponse.status).toHaveBeenCalledWith(400);
  });

  it('keeps the message of a NotFoundException', () => {
    filter.catch(
      new NotFoundException('IP rule not found'),
      hostWith({ requestId: 'req-2', method: 'DELETE', url: '/admin/dashboard/ip/rules/7' }),
    );

    const body = mockResponse.json.mock.calls[0][0];
    expect(body.error.message).toBe('IP rule not found');
    expect(mockResponse.status).toHaveBeenCalledWith(404);
  });

  it('still passes our own nested error object through untouched', () => {
    filter.catch(
      new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'Invalid age' } }),
      hostWith({ requestId: 'req-3', method: 'POST', url: '/x' }),
    );

    expect(mockResponse.json.mock.calls[0][0].error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid age',
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd BE && npx jest http-exception -t "plain string"`
Expected: FAIL — `body.error` is the string `'Bad Request'`, so `body.error.message` is `undefined`.

- [ ] **Step 3: Normalize the two shapes**

In `BE/src/common/filters/http-exception.filter.ts`, add this module-level function above the class:

```ts
/**
 * Two exception shapes reach this filter and they must leave as one.
 *
 * Ours: `{ error: { code, message } }` -- pass the nested object through.
 * Nest's built-ins: `{ statusCode, message, error: 'Bad Request' }` -- here
 * `error` is the status text, so returning it would drop the message the
 * thrower wrote and leave the client with no `code` and no `message` at all.
 */
function normalizeError(res: string | object): { code: string; message: string } {
  if (typeof res === 'string') return { code: 'HTTP_ERROR', message: res };

  const nested = (res as any).error;
  if (nested && typeof nested === 'object') return nested;

  // class-validator style handlers can put an array of messages here.
  const raw = (res as any).message;
  const message = Array.isArray(raw) ? raw.join(', ') : raw;
  return {
    code: 'HTTP_ERROR',
    message: typeof message === 'string' && message ? message : String(nested ?? 'Request failed'),
  };
}
```

Then replace the assignment inside `catch`:

```ts
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      body.error = normalizeError(exception.getResponse());
      body.request_id = requestId;
    } else {
```

- [ ] **Step 4: Run the filter suite and the whole BE suite**

Run: `cd BE && npx jest http-exception`
Expected: PASS, all tests including the three new ones.

Run: `cd BE && npx jest`
Expected: PASS. This filter is global, so a full run is the only honest check. If a suite outside `common/` fails, report it rather than adjusting the assertion — a real consumer was relying on the old shape and that needs a decision.

- [ ] **Step 5: Commit**

```bash
git add BE/src/common/filters/http-exception.filter.ts BE/src/common/__tests__/http-exception.filter.spec.ts
git commit -m "fix(common): preserve the message of exceptions thrown with a plain string"
```

---

## Task 3: FE — dashboard types and the UTC timestamp helper

**Files:**
- Create: `FE/src/admin/dashboardTypes.ts`
- Create: `FE/src/admin/parseUtc.ts`
- Test: `FE/src/admin/__tests__/parseUtc.test.ts`

**Interfaces:**
- Consumes: `RuleDto` from Task 1 (mirrored as `CreateRuleBody`).
- Produces: types `IpRule`, `IpState`, `Alert`, `Paged<T>`, `CreateRuleBody`, `UpdateRuleBody`, `IngestResult`, `ApplyResult`, `DeletedResult`, `UnblockedResult`, `RuleType`, `RuleAction`, `IpStatus`, `AlertSeverity`; functions `parseUtc(ts: string): Date` and `formatUtc(ts: string | null): string`.

- [ ] **Step 1: Write the failing test**

Create `FE/src/admin/__tests__/parseUtc.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatUtc, parseUtc } from '../parseUtc';

describe('parseUtc', () => {
  it('reads the BE timestamp as UTC, not local time', () => {
    // The BE writes UTC with no zone suffix. `new Date('2026-08-14T10:30:00')`
    // is parsed as LOCAL time by JS -- seven hours off in UTC+7, and wrong
    // silently. Asserting on epoch ms keeps this test correct in every zone,
    // which setting process.env.TZ at runtime would not (unreliable on Windows).
    expect(parseUtc('2026-08-14T10:30:00').getTime()).toBe(Date.UTC(2026, 7, 14, 10, 30, 0));
  });

  it('accepts the SQLite space-separated form too', () => {
    // `datetime('now')` defaults produce 'YYYY-MM-DD HH:MM:SS'.
    expect(parseUtc('2026-08-14 10:30:00').getTime()).toBe(Date.UTC(2026, 7, 14, 10, 30, 0));
  });
});

describe('formatUtc', () => {
  it('renders an em dash for a missing timestamp', () => {
    expect(formatUtc(null)).toBe('—');
  });

  it('renders a stable UTC string, not a locale-dependent one', () => {
    expect(formatUtc('2026-08-14T10:30:00')).toBe('2026-08-14 10:30:00');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd FE && npx vitest run src/admin/__tests__/parseUtc.test.ts`
Expected: FAIL — cannot resolve `../parseUtc`.

- [ ] **Step 3: Write the helpers**

Create `FE/src/admin/parseUtc.ts`:

```ts
/**
 * The BE writes UTC timestamps with no zone suffix ('2026-08-14T10:30:00').
 * Handing that straight to `new Date()` makes JS read it as local time, so
 * every timestamp in the console would be silently offset. Appending 'Z' is
 * the whole fix, and it belongs in exactly one place.
 */
export function parseUtc(ts: string): Date {
  // SQLite column defaults produce a space instead of the 'T'.
  return new Date(`${ts.replace(' ', 'T')}Z`);
}

/**
 * Renders in UTC on purpose: the operator is reading the same clock the BE
 * wrote, and a locale-formatted local time would not match the log lines or
 * the hour buckets they are comparing against.
 */
export function formatUtc(ts: string | null): string {
  if (!ts) return '—';
  const date = parseUtc(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}
```

Create `FE/src/admin/dashboardTypes.ts`:

```ts
/**
 * These shapes are camelCase because the dashboard list endpoints return
 * TypeORM entities verbatim (`blockedUntil`, `detailJson`, `createdAt`).
 * `types.ts` in this folder is snake_case because the feedback endpoint builds
 * its rows by hand, and the traffic/LLM endpoints are snake_case too.
 *
 * Both conventions therefore live side by side here. That is deliberate: a
 * normalizing layer would hide the fact that the BE is inconsistent and make
 * these types impossible to diff against a real response.
 */

export type RuleType = 'ip' | 'cidr';
export type RuleAction = 'allow' | 'deny';

// 'temp_blocked' is reserved on the BE: validated and ranked, but no code path
// assigns it yet. Keep it so a future BE change does not render a blank cell.
export type IpStatus = 'ok' | 'throttled' | 'temp_blocked' | 'perm_blocked';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface IpRule {
  id: number;
  type: RuleType;
  pattern: string;
  action: RuleAction;
  tier: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
  enabled: boolean;
}

export interface IpState {
  ip: string;
  status: IpStatus;
  tier: string;
  score: number;
  blockedUntil: string | null;
  autoBlocked: boolean;
  reason: string | null;
  updatedAt: string;
}

export interface Alert {
  id: number;
  type: string;
  severity: AlertSeverity;
  ip: string | null;
  provider: string | null;
  /** A string containing JSON, not an object. Shape varies by `type`. */
  detailJson: string;
  resolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Mirrors RuleDto. `id` is server-assigned and never sent. */
export interface CreateRuleBody {
  type: RuleType;
  pattern: string;
  action: RuleAction;
  tier?: string;
  note?: string | null;
}

/** Mirrors UpdateRuleDto: type and pattern are immutable after creation. */
export interface UpdateRuleBody {
  action?: RuleAction;
  enabled?: boolean;
  tier?: string;
  note?: string | null;
}

export interface IngestResult {
  ingested: number;
  skipped: number;
  alerts_created: number;
}

export interface ApplyResult {
  matched: number;
  alerts_created: number;
}

export interface DeletedResult {
  deleted: true;
}

export interface UnblockedResult {
  unblocked: true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd FE && npx vitest run src/admin/__tests__/parseUtc.test.ts`
Expected: PASS, 4 tests.

Run: `cd FE && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add FE/src/admin/dashboardTypes.ts FE/src/admin/parseUtc.ts FE/src/admin/__tests__/parseUtc.test.ts
git commit -m "feat(admin): add dashboard API types and a zone-less UTC timestamp helper"
```

---

## Task 4: FE — the dashboard API client

**Files:**
- Modify: `FE/src/admin/adminClient.ts` (one line: export `adminFetch`)
- Create: `FE/src/admin/dashboardClient.ts`
- Test: `FE/src/admin/__tests__/dashboardClient.test.ts`

**Interfaces:**
- Consumes: every type from Task 3; `adminFetch<T>(path, init, withAuth)` from `adminClient.ts`.
- Produces: `fetchIpRules()`, `createIpRule(body)`, `updateIpRule(id, patch)`, `deleteIpRule(id)`, `applyIpRules()`, `fetchIpStates(params)`, `unblockIp(ip)`, `fetchAlerts(params)`, `resolveAlert(id)`, `ingestTraffic(logPath)`. Tasks 7–9 call these by exactly these names.

- [ ] **Step 1: Write the failing test**

Create `FE/src/admin/__tests__/dashboardClient.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import * as api from '../dashboardClient';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('dashboardClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    fetchMock = vi.fn().mockResolvedValue(okResponse({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const urlOf = () => String(fetchMock.mock.calls[0][0]);
  const initOf = () => fetchMock.mock.calls[0][1] as RequestInit;

  it('sends an authorized GET for the rules list', async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    await api.fetchIpRules();
    expect(urlOf()).toContain('/admin/dashboard/ip/rules');
    expect(initOf().method).toBe('GET');
    expect((initOf().headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it('posts the create-rule body as JSON', async () => {
    await api.createIpRule({ type: 'ip', pattern: '10.0.0.9', action: 'deny', tier: 'default', note: null });
    expect(initOf().method).toBe('POST');
    expect(JSON.parse(String(initOf().body))).toEqual({
      type: 'ip', pattern: '10.0.0.9', action: 'deny', tier: 'default', note: null,
    });
  });

  it('patches a rule by id', async () => {
    await api.updateIpRule(7, { enabled: false });
    expect(urlOf()).toContain('/admin/dashboard/ip/rules/7');
    expect(initOf().method).toBe('PATCH');
    expect(JSON.parse(String(initOf().body))).toEqual({ enabled: false });
  });

  it('deletes a rule by id', async () => {
    await api.deleteIpRule(7);
    expect(urlOf()).toContain('/admin/dashboard/ip/rules/7');
    expect(initOf().method).toBe('DELETE');
  });

  it('posts to the apply endpoint with no body', async () => {
    await api.applyIpRules();
    expect(urlOf()).toContain('/admin/dashboard/ip/rules/apply');
    expect(initOf().method).toBe('POST');
    expect(initOf().body).toBeUndefined();
  });

  it('passes the states query through', async () => {
    await api.fetchIpStates(new URLSearchParams({ status: 'perm_blocked', limit: '50' }));
    expect(urlOf()).toContain('/admin/dashboard/ip/states?status=perm_blocked&limit=50');
  });

  it('omits the question mark when there is no query', async () => {
    await api.fetchIpStates(new URLSearchParams());
    expect(urlOf()).toMatch(/ip\/states$/);
  });

  it('encodes the IP in the unblock path', async () => {
    // An IPv6 address is full of colons; unencoded they would be read as part
    // of the URL structure.
    await api.unblockIp('2001:db8::1');
    expect(urlOf()).toContain('/admin/dashboard/ip/states/2001%3Adb8%3A%3A1');
    expect(initOf().method).toBe('DELETE');
  });

  it('patches an alert to resolved', async () => {
    await api.resolveAlert(42);
    expect(urlOf()).toContain('/admin/dashboard/alerts/42/resolve');
    expect(initOf().method).toBe('PATCH');
  });

  it('posts the log path to ingest', async () => {
    await api.ingestTraffic('/var/log/nginx/access.log');
    expect(urlOf()).toContain('/admin/dashboard/traffic/ingest');
    expect(JSON.parse(String(initOf().body))).toEqual({ logPath: '/var/log/nginx/access.log' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd FE && npx vitest run src/admin/__tests__/dashboardClient.test.ts`
Expected: FAIL — cannot resolve `../dashboardClient`.

- [ ] **Step 3: Export `adminFetch` and write the client**

In `FE/src/admin/adminClient.ts`, change the declaration on line 14 from

```ts
async function adminFetch<T>(path: string, init: RequestInit, withAuth: boolean): Promise<T> {
```

to

```ts
export async function adminFetch<T>(path: string, init: RequestInit, withAuth: boolean): Promise<T> {
```

Leave the doc comment above it and the body untouched.

Create `FE/src/admin/dashboardClient.ts`:

```ts
import { adminFetch } from './adminClient';
import type {
  Alert, ApplyResult, CreateRuleBody, DeletedResult, IngestResult,
  IpRule, IpState, Paged, UnblockedResult, UpdateRuleBody,
} from './dashboardTypes';

/**
 * Split from adminClient.ts on purpose: that file would otherwise grow to a
 * dozen functions spanning login, feedback and the dashboard. They share the
 * one thing worth sharing -- adminFetch.
 */
const BASE = '/admin/dashboard';

/** Keeps a bare path bare: `?` with nothing after it is not a valid query. */
function query(params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchIpRules(): Promise<IpRule[]> {
  return adminFetch<IpRule[]>(`${BASE}/ip/rules`, { method: 'GET' }, true);
}

export function createIpRule(body: CreateRuleBody): Promise<IpRule> {
  return adminFetch<IpRule>(`${BASE}/ip/rules`, { method: 'POST', body: JSON.stringify(body) }, true);
}

export function updateIpRule(id: number, patch: UpdateRuleBody): Promise<IpRule> {
  return adminFetch<IpRule>(`${BASE}/ip/rules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, true);
}

export function deleteIpRule(id: number): Promise<DeletedResult> {
  return adminFetch<DeletedResult>(`${BASE}/ip/rules/${id}`, { method: 'DELETE' }, true);
}

export function applyIpRules(): Promise<ApplyResult> {
  return adminFetch<ApplyResult>(`${BASE}/ip/rules/apply`, { method: 'POST' }, true);
}

export function fetchIpStates(params: URLSearchParams): Promise<Paged<IpState>> {
  return adminFetch<Paged<IpState>>(`${BASE}/ip/states${query(params)}`, { method: 'GET' }, true);
}

export function unblockIp(ip: string): Promise<UnblockedResult> {
  // An IPv6 address is mostly colons; it cannot go into a path segment raw.
  return adminFetch<UnblockedResult>(`${BASE}/ip/states/${encodeURIComponent(ip)}`, { method: 'DELETE' }, true);
}

export function fetchAlerts(params: URLSearchParams): Promise<Paged<Alert>> {
  return adminFetch<Paged<Alert>>(`${BASE}/alerts${query(params)}`, { method: 'GET' }, true);
}

export function resolveAlert(id: number): Promise<Alert> {
  return adminFetch<Alert>(`${BASE}/alerts/${id}/resolve`, { method: 'PATCH' }, true);
}

export function ingestTraffic(logPath: string): Promise<IngestResult> {
  return adminFetch<IngestResult>(
    `${BASE}/traffic/ingest`,
    { method: 'POST', body: JSON.stringify({ logPath }) },
    true,
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `cd FE && npx vitest run src/admin`
Expected: PASS, including the 10 new tests and every pre-existing admin test.

- [ ] **Step 5: Commit**

```bash
git add FE/src/admin/adminClient.ts FE/src/admin/dashboardClient.ts FE/src/admin/__tests__/dashboardClient.test.ts
git commit -m "feat(admin): add the dashboard API client"
```

---

## Task 5: FE — the read hook and the write hook

**Files:**
- Create: `FE/src/admin/useAdminResource.ts`
- Test: `FE/src/admin/__tests__/useAdminResource.test.tsx`

**Interfaces:**
- Consumes: `ApiError` from `../utils/api` (its `code` is machine-readable, its `detail` holds the BE's human text, and its `message` is deliberately equal to `code`); `clearToken` from `./adminSession`.
- Produces:
  - `messageFor(err: unknown, fallback?: string, overrides?: Record<string, string>): string`
  - `useAdminResource<T>(key: string, fetcher: () => Promise<T>, opts?: { pollMs?: number; fallbackMessage?: string; messages?: Record<string, string> }): { data: T | null; loading: boolean; error: string | null; reload: () => void }`
  - `useAdminAction(fallbackMessage?: string): { busy: boolean; actionError: string | null; run: (fn: () => Promise<unknown>, after?: () => void) => Promise<void> }`

  Tasks 6–9 use exactly these names.

- [ ] **Step 1: Write the failing test**

Create `FE/src/admin/__tests__/useAdminResource.test.tsx`:

```tsx
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../../utils/api';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import { useAdminAction, useAdminResource } from '../useAdminResource';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function Harness({
  fetcher, pollMs, initialKey = 'k1',
}: { fetcher: () => Promise<string>; pollMs?: number; initialKey?: string }) {
  const [key, setKey] = useState(initialKey);
  const { data, loading, error, reload } = useAdminResource(key, fetcher, { pollMs });
  return (
    <div>
      <p data-testid="state">{loading ? 'LOADING' : 'IDLE'}</p>
      <p data-testid="data">{data ?? 'NONE'}</p>
      <p data-testid="error">{error ?? 'NOERROR'}</p>
      <button type="button" onClick={reload}>reload</button>
      <button type="button" onClick={() => setKey('k2')}>changeKey</button>
    </div>
  );
}

function renderHarness(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/admin/x']}>
      <Routes>
        <Route path="/admin/x" element={ui} />
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useAdminResource', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('loads, then exposes the data', async () => {
    renderHarness(<Harness fetcher={vi.fn().mockResolvedValue('first')} />);
    expect(screen.getByTestId('state')).toHaveTextContent('LOADING');
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));
    expect(screen.getByTestId('state')).toHaveTextContent('IDLE');
  });

  it('refetches when the key changes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    renderHarness(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));
    await userEvent.click(screen.getByText('changeKey'));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('second'));
  });

  it('refetches when reload is called', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    renderHarness(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));
    await userEvent.click(screen.getByText('reload'));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('second'));
  });

  it('shows the BE detail for an unmapped error code', async () => {
    // ApiError keeps `message` equal to the bare code on purpose, so `detail`
    // is the only place the human-readable text lives.
    const fetcher = vi.fn().mockRejectedValue(new ApiError('API_ERROR', 'Log path is outside', 400));
    renderHarness(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Log path is outside'));
  });

  it('redirects to login on a 401', async () => {
    const fetcher = vi.fn().mockRejectedValue(new ApiError('UNAUTHORIZED', 'gone', 401));
    renderHarness(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument());
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('discards a response that lost its race with a newer key', async () => {
    let releaseFirst: (v: string) => void = () => {};
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((res) => { releaseFirst = res; }))
      .mockResolvedValueOnce('second');

    renderHarness(<Harness fetcher={fetcher} />);
    await userEvent.click(screen.getByText('changeKey'));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('second'));

    // The stale first request now answers. It must not win.
    await act(async () => { releaseFirst('first'); });
    expect(screen.getByTestId('data')).toHaveTextContent('second');
  });

  it('polls without flipping loading, and keeps the old data when a poll fails', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', undefined))
      .mockResolvedValue('third');

    renderHarness(<Harness fetcher={fetcher} pollMs={30_000} />);
    await act(async () => {});
    expect(screen.getByTestId('data')).toHaveTextContent('first');

    // Poll 1 fails: the banner appears but the table keeps its rows, and the
    // screen must not blink back to its skeleton.
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId('state')).toHaveTextContent('IDLE');
    expect(screen.getByTestId('data')).toHaveTextContent('first');
    expect(screen.getByTestId('error')).toHaveTextContent('Không kết nối được máy chủ.');

    // Poll 2 succeeds and clears the banner.
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId('data')).toHaveTextContent('third');
    expect(screen.getByTestId('error')).toHaveTextContent('NOERROR');
  });
});

function ActionHarness({ fn }: { fn: () => Promise<unknown> }) {
  const { busy, actionError, run } = useAdminAction();
  return (
    <div>
      <p data-testid="busy">{busy ? 'BUSY' : 'FREE'}</p>
      <p data-testid="action-error">{actionError ?? 'NOERROR'}</p>
      <button type="button" onClick={() => void run(fn)}>go</button>
    </div>
  );
}

describe('useAdminAction', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
  });

  it('surfaces the BE detail of a failed write', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError('API_ERROR', 'IP rule not found', 404));
    renderHarness(<ActionHarness fn={fn} />);
    await userEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByTestId('action-error')).toHaveTextContent('IP rule not found'));
    expect(screen.getByTestId('busy')).toHaveTextContent('FREE');
  });

  it('redirects to login when a write comes back 401', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError('UNAUTHORIZED', 'gone', 401));
    renderHarness(<ActionHarness fn={fn} />);
    await userEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd FE && npx vitest run src/admin/__tests__/useAdminResource.test.tsx`
Expected: FAIL — cannot resolve `../useAdminResource`.

- [ ] **Step 3: Write the hooks**

Create `FE/src/admin/useAdminResource.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../utils/api';
import { clearToken } from './adminSession';

const ERROR_MESSAGES: Record<string, string> = {
  TIMEOUT: 'Máy chủ phản hồi quá lâu. Thử lại.',
  NETWORK_ERROR: 'Không kết nối được máy chủ.',
};

/**
 * `ApiError.message` is deliberately the bare code so `toThrow('CODE')` checks
 * keep working -- the human-readable text the BE sent lives in `detail`. Using
 * `message` here would show an operator the string 'API_ERROR'.
 *
 * The unmapped branch prefers the BE's own text: the dashboard returns useful,
 * specific sentences ('Log path is outside the configured log directory') and
 * replacing them with a generic line throws away the only information there
 * is. The cost is that those sentences are in English, so a screen can mix two
 * languages. That is the better trade.
 */
export function messageFor(
  err: unknown,
  fallback = 'Có lỗi xảy ra.',
  overrides: Record<string, string> = {},
): string {
  if (!(err instanceof ApiError)) return fallback;
  const mapped = overrides[err.code] ?? ERROR_MESSAGES[err.code];
  if (mapped) return mapped;
  return err.detail || fallback;
}

export interface AdminResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export interface AdminResourceOptions {
  /** Poll interval. Omit (or pass undefined) to disable polling entirely. */
  pollMs?: number;
  fallbackMessage?: string;
  /** Per-screen copy for specific codes, merged over the shared table. */
  messages?: Record<string, string>;
}

export function useAdminResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: AdminResourceOptions = {},
): AdminResource<T> {
  const { pollMs, fallbackMessage, messages } = opts;
  const navigate = useNavigate();

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // A request that started before the key changed must not overwrite the newer
  // result. Only the highest sequence number may touch state.
  const seq = useRef(0);

  // `fetcher` is a fresh closure on every render, so it can never be a
  // dependency -- `key` stands in for it, exactly as the screens' URL string
  // stands in for their URLSearchParams instance.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const run = useCallback(
    async (showLoading: boolean) => {
      const mine = ++seq.current;
      if (showLoading) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await fetcherRef.current();
        if (mine !== seq.current) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
          // Redirect even mid-poll. Once the token is dead every later request
          // is a 401 too, and sitting on stale rows is worse than leaving.
          clearToken();
          navigate('/admin/login', { replace: true });
          return;
        }
        if (mine !== seq.current) return;
        // Note what is NOT here: `setData(null)`. A failed poll keeps the rows
        // it already has and only raises a banner.
        setError(messageFor(err, fallbackMessage, messagesRef.current));
      } finally {
        if (mine === seq.current && showLoading) setLoading(false);
      }
    },
    [navigate, fallbackMessage],
  );

  useEffect(() => {
    void run(true);
  }, [key, nonce, run]);

  useEffect(() => {
    if (!pollMs) return undefined;

    // A background poll passes showLoading=false: otherwise the table blinks
    // back to its skeleton every interval.
    const poll = () => {
      if (!document.hidden) void run(false);
    };
    const timer = setInterval(poll, pollMs);

    // Resuming the timer alone would leave the operator looking at data up to
    // one full interval old, so fetch immediately on return.
    const onVisibility = () => {
      if (!document.hidden) void run(false);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pollMs, key, nonce, run]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}

export interface AdminAction {
  busy: boolean;
  actionError: string | null;
  run: (fn: () => Promise<unknown>, after?: () => void) => Promise<void>;
}

/**
 * Writes do not go through useAdminResource: they have no `data`, and their
 * failure belongs next to the control that was clicked rather than replacing
 * the screen. What they do share is the 401 handling and the message table.
 */
export function useAdminAction(fallbackMessage = 'Không thực hiện được. Thử lại.'): AdminAction {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<unknown>, after?: () => void) => {
      setBusy(true);
      setActionError(null);
      try {
        await fn();
        after?.();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
          clearToken();
          navigate('/admin/login', { replace: true });
          return;
        }
        setActionError(messageFor(err, fallbackMessage));
      } finally {
        setBusy(false);
      }
    },
    [navigate, fallbackMessage],
  );

  return { busy, actionError, run };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd FE && npx vitest run src/admin/__tests__/useAdminResource.test.tsx`
Expected: PASS, 9 tests.

If the polling test hangs, it is the known `userEvent` + `vi.useFakeTimers()` interaction. That test uses only `act` and `advanceTimersByTime` and no `userEvent`, so it should not hang; if a later test in the file does, give that test its own `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.

Run: `cd FE && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add FE/src/admin/useAdminResource.ts FE/src/admin/__tests__/useAdminResource.test.tsx
git commit -m "feat(admin): add the shared read and write hooks for admin screens"
```

---

## Task 6: FE — shared layout, nested routes, and the feedback screen refactor

The feedback screen currently owns its own page chrome and its own fetch/401/error logic. Both move out: the chrome to `AdminLayout`, the logic to `useAdminResource`. This touches a screen that is already green, so its test moves with it.

**Files:**
- Create: `FE/src/admin/AdminLayout.tsx`
- Create: `FE/src/admin/__tests__/AdminLayout.test.tsx`
- Modify: `FE/src/admin/AdminApp.tsx`
- Modify: `FE/src/admin/AdminFeedbackScreen.tsx`
- Modify: `FE/src/admin/__tests__/AdminFeedbackScreen.test.tsx`

**Interfaces:**
- Consumes: `useAdminResource` from Task 5; `clearToken` from `./adminSession`.
- Produces: `AdminLayout` (default export) rendering an `<Outlet>` inside `<main className="mx-auto max-w-6xl space-y-4 p-4">`. Tasks 7 and 9 render their screens inside it and must not add their own `min-h-screen` wrapper or `<main>`.

- [ ] **Step 1: Write the failing test**

Create `FE/src/admin/__tests__/AdminLayout.test.tsx`:

```tsx
import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLayout from '../AdminLayout';
import { ADMIN_TOKEN_KEY } from '../adminSession';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function renderLayout(entry = '/admin/feedback') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin/feedback" element={<p>FEEDBACK BODY</p>} />
        </Route>
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
  });

  it('renders the nested route inside the shared chrome', () => {
    renderLayout();
    expect(screen.getByText('FEEDBACK BODY')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Feedback' })).toBeInTheDocument();
  });

  it('marks the current tab as the active page', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: 'Feedback' })).toHaveAttribute('aria-current', 'page');
  });

  it('logs out: clears the token and goes to the login screen', async () => {
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
    expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd FE && npx vitest run src/admin/__tests__/AdminLayout.test.tsx`
Expected: FAIL — cannot resolve `../AdminLayout`.

- [ ] **Step 3: Write the layout**

Create `FE/src/admin/AdminLayout.tsx`. Only the Feedback tab exists at this point; Task 7 adds IP and Task 9 adds Alerts, each alongside the route that makes the tab lead somewhere.

```tsx
import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearToken } from './adminSession';

const TABS = [{ to: '/admin/feedback', label: 'Feedback' }];

/**
 * The page chrome every authenticated admin screen shares. Screens render only
 * their own content: the wrapper, the <main> and its spacing live here, so a
 * new screen cannot drift from the others by forgetting them.
 */
export default function AdminLayout() {
  const navigate = useNavigate();

  function logout() {
    clearToken();
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <nav className="flex gap-1">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  `rounded px-3 py-1 text-sm ${
                    isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            onClick={logout}
            className="rounded border border-slate-300 px-3 py-1 text-sm"
          >
            Đăng xuất
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Nest the routes**

Replace the body of `FE/src/admin/AdminApp.tsx`:

```tsx
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLoginScreen from './AdminLoginScreen';
import AdminFeedbackScreen from './AdminFeedbackScreen';
import AdminLayout from './AdminLayout';
import RequireAdmin from './RequireAdmin';

export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLoginScreen />} />
      {/* One guard and one layout for every authenticated screen: a new screen
          is a single <Route> line and cannot forget either. */}
      <Route
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route path="feedback" element={<AdminFeedbackScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin/feedback" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 5: Move the feedback screen onto the hook**

In `FE/src/admin/AdminFeedbackScreen.tsx`:

Replace the imports of `useCallback`/`useEffect`/`useState`, `clearToken`, `ApiError`, and `fetchAdminFeedbacks`-adjacent helpers so the top of the file reads:

```tsx
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import FeedbackFilters from './FeedbackFilters';
import FeedbackTable from './FeedbackTable';
import { fetchAdminFeedbacks } from './adminClient';
import { useAdminResource } from './useAdminResource';
import type { FeedbackFilterState } from './types';

const PAGE_SIZE = 20;

/** This screen's copy for codes the shared table does not cover. */
const MESSAGES: Record<string, string> = {
  TIMEOUT: 'Không kết nối được máy chủ',
  NETWORK_ERROR: 'Không kết nối được máy chủ',
  VALIDATION_ERROR: 'Bộ lọc không hợp lệ',
};
```

Delete the now-unused `ERROR_MESSAGES` constant, the `messageFor` function, and the `AdminFeedbackPage` type import. Keep `filtersFromParams`, `withFilterParams`, `requestParams` and `urlParams` exactly as they are.

Replace the component's state block and `load`/`useEffect` with:

```tsx
export default function AdminFeedbackScreen() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = filtersFromParams(searchParams);
  const offset = Number(searchParams.get('offset') ?? 0) || 0;

  // Stands in for searchParams: a new URLSearchParams instance with the same
  // contents must not trigger a refetch.
  const key = searchParams.toString();

  const { data: page, loading, error, reload } = useAdminResource(
    key,
    () => fetchAdminFeedbacks(requestParams(filters, offset)),
    { fallbackMessage: 'Không tải được danh sách feedback', messages: MESSAGES },
  );
```

Replace the returned JSX wrapper: drop the outer `<div className="min-h-screen …">`, the `<header>` and the `<main>` (the layout owns all three) and return a fragment whose children are unchanged, with the retry button calling `reload`:

```tsx
  return (
    <>
      <FeedbackFilters value={filters} onChange={applyFilters} />

      {loading && <p className="p-6 text-center text-slate-600">Đang tải…</p>}

      {!loading && error && (
        <div role="alert" className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="rounded border border-red-300 px-3 py-1 text-sm"
          >
            Thử lại
          </button>
        </div>
      )}
      {/* the empty-state and table blocks stay exactly as they were */}
    </>
  );
```

- [ ] **Step 6: Update the feedback screen's test**

In `FE/src/admin/__tests__/AdminFeedbackScreen.test.tsx`, change `renderScreen` to mount the screen inside the layout, since the screen no longer renders its own chrome:

```tsx
import AdminLayout from '../AdminLayout';

function renderScreen(initialEntry = '/admin/feedback') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin/feedback" element={<AdminFeedbackScreen />} />
        </Route>
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
```

Then run the suite and fix what actually breaks. Two failures are expected by design:
- an assertion that finds the heading `Feedback` as a heading — the layout renders it as a nav **link** now, so use `getByRole('link', { name: 'Feedback' })` or drop the assertion if the test was not about the header.
- an assertion on error copy — the wording is unchanged for `NETWORK_ERROR`, `TIMEOUT` and `VALIDATION_ERROR` because `MESSAGES` above reproduces the old table exactly. If any other code was asserted, it now renders `err.detail`; update the expectation to the detail string the test's `ApiError` carries.

Do not weaken an assertion to make it pass. If a failure is not one of the two above, stop and report it.

- [ ] **Step 7: Run the full admin suite**

Run: `cd FE && npx vitest run src/admin`
Expected: PASS — the 3 new layout tests plus every pre-existing test.

Run: `cd FE && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add FE/src/admin/AdminLayout.tsx FE/src/admin/AdminApp.tsx FE/src/admin/AdminFeedbackScreen.tsx FE/src/admin/__tests__/AdminLayout.test.tsx FE/src/admin/__tests__/AdminFeedbackScreen.test.tsx
git commit -m "refactor(admin): add a shared layout and move the feedback screen onto the read hook"
```

---

## Task 7: FE — IP screen, rules block

**Files:**
- Create: `FE/src/admin/IpRuleForm.tsx`
- Create: `FE/src/admin/IpRulesTable.tsx`
- Create: `FE/src/admin/AdminIpScreen.tsx`
- Create: `FE/src/admin/__tests__/AdminIpScreen.test.tsx`
- Modify: `FE/src/admin/AdminApp.tsx` (add the `ip` route)
- Modify: `FE/src/admin/AdminLayout.tsx` (add the IP tab)

**Interfaces:**
- Consumes: `fetchIpRules`, `createIpRule`, `updateIpRule`, `deleteIpRule`, `applyIpRules` (Task 4); `useAdminResource`, `useAdminAction` (Task 5); `formatUtc` (Task 3); types `IpRule`, `CreateRuleBody`, `UpdateRuleBody` (Task 3).
- Produces: `AdminIpScreen` (default export). Task 8 adds the states and ingest blocks to this same component and reuses its `rules` resource and its single `useAdminAction` instance.

- [ ] **Step 1: Write the failing test**

Create `FE/src/admin/__tests__/AdminIpScreen.test.tsx`:

```tsx
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminIpScreen from '../AdminIpScreen';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import * as api from '../dashboardClient';
import type { IpRule } from '../dashboardTypes';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function rule(over: Partial<IpRule> = {}): IpRule {
  return {
    id: 1, type: 'ip', pattern: '10.0.0.9', action: 'deny', tier: 'default',
    note: null, createdBy: 'admin', createdAt: '2026-08-14T10:30:00', enabled: true,
    ...over,
  };
}

function renderScreen(entry = '/admin/ip') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/ip" element={<AdminIpScreen />} />
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminIpScreen — rules', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    vi.spyOn(api, 'fetchIpRules').mockResolvedValue([rule()]);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lists the rules', async () => {
    renderScreen();
    expect(await screen.findByText('10.0.0.9')).toBeInTheDocument();
  });

  it('toggling enabled patches the rule and refetches the list', async () => {
    const update = vi.spyOn(api, 'updateIpRule').mockResolvedValue(rule({ enabled: false }));
    renderScreen();
    await screen.findByText('10.0.0.9');

    await userEvent.click(screen.getByRole('checkbox', { name: /bật rule 10\.0\.0\.9/i }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(1, { enabled: false }));
    expect(api.fetchIpRules).toHaveBeenCalledTimes(2);
  });

  it('creates a rule from the form and refetches', async () => {
    const create = vi.spyOn(api, 'createIpRule').mockResolvedValue(rule({ id: 2, pattern: '10.0.0.10' }));
    renderScreen();
    await screen.findByText('10.0.0.9');

    await userEvent.type(screen.getByLabelText('Pattern'), '10.0.0.10');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo rule' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        type: 'ip', pattern: '10.0.0.10', action: 'deny', tier: 'default', note: null,
      }),
    );
    expect(api.fetchIpRules).toHaveBeenCalledTimes(2);
  });

  it('refuses to submit an empty pattern without calling the API', async () => {
    const create = vi.spyOn(api, 'createIpRule');
    renderScreen();
    await screen.findByText('10.0.0.9');

    await userEvent.click(screen.getByRole('button', { name: 'Tạo rule' }));

    expect(await screen.findByText('Pattern không được để trống')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('deleting asks first, and cancelling calls nothing', async () => {
    const del = vi.spyOn(api, 'deleteIpRule');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderScreen();
    await screen.findByText('10.0.0.9');

    await userEvent.click(screen.getByRole('button', { name: /xoá rule 10\.0\.0\.9/i }));

    expect(confirm).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('deleting proceeds when confirmed', async () => {
    const del = vi.spyOn(api, 'deleteIpRule').mockResolvedValue({ deleted: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderScreen();
    await screen.findByText('10.0.0.9');

    await userEvent.click(screen.getByRole('button', { name: /xoá rule 10\.0\.0\.9/i }));

    await waitFor(() => expect(del).toHaveBeenCalledWith(1));
    expect(api.fetchIpRules).toHaveBeenCalledTimes(2);
  });

  it('apply confirms with the number of enabled rules', async () => {
    vi.spyOn(api, 'fetchIpRules').mockResolvedValue([rule(), rule({ id: 2, enabled: false })]);
    const apply = vi.spyOn(api, 'applyIpRules').mockResolvedValue({ matched: 3, alerts_created: 1 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderScreen();
    await screen.findByRole('button', { name: 'Áp dụng rule' });

    await userEvent.click(screen.getByRole('button', { name: 'Áp dụng rule' }));

    expect(String(confirm.mock.calls[0][0])).toContain('1');
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(await screen.findByText(/matched: 3/i)).toBeInTheDocument();
  });

  it('shows the BE message when a write fails', async () => {
    const { ApiError } = await import('../../utils/api');
    vi.spyOn(api, 'applyIpRules').mockRejectedValue(new ApiError('API_ERROR', 'Apply failed', 500));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderScreen();
    await screen.findByRole('button', { name: 'Áp dụng rule' });

    await userEvent.click(screen.getByRole('button', { name: 'Áp dụng rule' }));

    expect(await screen.findByText('Apply failed')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd FE && npx vitest run src/admin/__tests__/AdminIpScreen.test.tsx`
Expected: FAIL — cannot resolve `../AdminIpScreen`.

- [ ] **Step 3: Write the form**

Create `FE/src/admin/IpRuleForm.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import type { CreateRuleBody, IpRule, RuleAction, RuleType, UpdateRuleBody } from './dashboardTypes';

interface Props {
  /** null = create mode; a rule = edit mode. */
  editing: IpRule | null;
  busy: boolean;
  onCreate: (body: CreateRuleBody) => void;
  onUpdate: (id: number, patch: UpdateRuleBody) => void;
  onCancelEdit: () => void;
}

/**
 * Inline, not a modal: no other admin screen has one, and a modal would need
 * its own focus and dismissal handling for no gain here.
 *
 * `pattern` is checked only for emptiness. The BE deliberately does not
 * shape-check it (debt #9), and a stricter FE regex would make the two sides
 * disagree with the operator unable to tell which one to believe.
 */
export default function IpRuleForm({ editing, busy, onCreate, onUpdate, onCancelEdit }: Props) {
  const [type, setType] = useState<RuleType>('ip');
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<RuleAction>('deny');
  const [tier, setTier] = useState('default');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setLocalError(null);
    if (!editing) {
      setType('ip'); setPattern(''); setAction('deny'); setTier('default'); setNote('');
      return;
    }
    setType(editing.type);
    setPattern(editing.pattern);
    setAction(editing.action);
    setTier(editing.tier);
    setNote(editing.note ?? '');
  }, [editing]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = pattern.trim();
    if (!trimmed) {
      setLocalError('Pattern không được để trống');
      return;
    }
    setLocalError(null);
    const noteValue = note.trim() ? note.trim() : null;

    if (editing) {
      // PATCH accepts action/enabled/tier/note only -- type and pattern are
      // immutable, which is why both inputs are read-only in edit mode.
      onUpdate(editing.id, { action, tier: tier.trim() || 'default', note: noteValue });
      return;
    }
    onCreate({ type, pattern: trimmed, action, tier: tier.trim() || 'default', note: noteValue });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{editing ? `Sửa rule #${editing.id}` : 'Thêm rule'}</h2>

      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="block text-slate-600">Loại</span>
          <select
            aria-label="Loại"
            value={type}
            disabled={!!editing || busy}
            onChange={(e) => setType(e.target.value as RuleType)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="ip">ip</option>
            <option value="cidr">cidr</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-slate-600">Pattern</span>
          <input
            aria-label="Pattern"
            value={pattern}
            readOnly={!!editing}
            disabled={busy}
            onChange={(e) => setPattern(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 read-only:bg-slate-100"
          />
        </label>

        <label className="text-sm">
          <span className="block text-slate-600">Hành động</span>
          <select
            aria-label="Hành động"
            value={action}
            disabled={busy}
            onChange={(e) => setAction(e.target.value as RuleAction)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="deny">deny</option>
            <option value="allow">allow</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-slate-600">Tier</span>
          <input
            aria-label="Tier"
            value={tier}
            disabled={busy}
            onChange={(e) => setTier(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="block text-slate-600">Ghi chú</span>
        <textarea
          aria-label="Ghi chú"
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1"
          rows={2}
        />
      </label>

      {localError && <p role="alert" className="text-sm text-red-700">{localError}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          {editing ? 'Lưu rule' : 'Tạo rule'}
        </button>
        {editing && (
          <button
            type="button"
            onClick={onCancelEdit}
            disabled={busy}
            className="rounded border border-slate-300 px-3 py-1 text-sm"
          >
            Huỷ
          </button>
        )}
      </div>

      {!editing && (
        <p className="text-xs text-slate-500">
          Không đổi được loại và pattern sau khi tạo — muốn đổi thì xoá rồi tạo lại.
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Write the rules table**

Create `FE/src/admin/IpRulesTable.tsx`:

```tsx
import React from 'react';
import { formatUtc } from './parseUtc';
import type { IpRule } from './dashboardTypes';

interface Props {
  rules: IpRule[];
  busy: boolean;
  onToggle: (rule: IpRule) => void;
  onEdit: (rule: IpRule) => void;
  onDelete: (rule: IpRule) => void;
}

/**
 * Presentational: it emits intents and never calls the API. The confirm
 * prompts and the refetch fan-out belong to the screen, which is the only
 * place that knows which other blocks a write invalidates.
 */
export default function IpRulesTable({ rules, busy, onToggle, onEdit, onDelete }: Props) {
  if (rules.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white p-6 text-center text-slate-600">
        Chưa có rule nào
      </p>
    );
  }

  return (
    <table className="w-full border-collapse bg-white text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-600">
          <th className="p-2">Bật</th>
          <th className="p-2">Loại</th>
          <th className="p-2">Pattern</th>
          <th className="p-2">Hành động</th>
          <th className="p-2">Tier</th>
          <th className="p-2">Ghi chú</th>
          <th className="p-2">Tạo lúc</th>
          <th className="p-2" />
        </tr>
      </thead>
      <tbody>
        {rules.map((rule) => (
          <tr key={rule.id} className="border-b border-slate-100">
            <td className="p-2">
              <input
                type="checkbox"
                aria-label={`Bật rule ${rule.pattern}`}
                checked={rule.enabled}
                disabled={busy}
                onChange={() => onToggle(rule)}
              />
            </td>
            <td className="p-2">{rule.type}</td>
            <td className="p-2 font-mono">{rule.pattern}</td>
            <td className="p-2">{rule.action}</td>
            <td className="p-2">{rule.tier}</td>
            <td className="p-2">{rule.note ?? '—'}</td>
            <td className="p-2 whitespace-nowrap">{formatUtc(rule.createdAt)}</td>
            <td className="p-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label={`Sửa rule ${rule.pattern}`}
                  disabled={busy}
                  onClick={() => onEdit(rule)}
                  className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
                >
                  Sửa
                </button>
                <button
                  type="button"
                  aria-label={`Xoá rule ${rule.pattern}`}
                  disabled={busy}
                  onClick={() => onDelete(rule)}
                  className="rounded border border-red-300 px-2 py-0.5 text-red-700 disabled:opacity-40"
                >
                  Xoá
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Write the screen**

Create `FE/src/admin/AdminIpScreen.tsx`:

```tsx
import React, { useState } from 'react';
import IpRuleForm from './IpRuleForm';
import IpRulesTable from './IpRulesTable';
import { applyIpRules, createIpRule, deleteIpRule, fetchIpRules, updateIpRule } from './dashboardClient';
import { useAdminAction, useAdminResource } from './useAdminResource';
import type { ApplyResult, CreateRuleBody, IpRule, UpdateRuleBody } from './dashboardTypes';

/**
 * Ingest, rules and states share one route because the operator's actual loop
 * is edit a rule -> apply -> watch the states change. Splitting them would
 * make that loop a navigation.
 */
export default function AdminIpScreen() {
  const rules = useAdminResource('ip-rules', fetchIpRules, {
    fallbackMessage: 'Không tải được danh sách rule',
  });
  const action = useAdminAction();

  const [editing, setEditing] = useState<IpRule | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  const ruleList = rules.data ?? [];
  const enabledCount = ruleList.filter((rule) => rule.enabled).length;

  function create(body: CreateRuleBody) {
    void action.run(() => createIpRule(body), () => rules.reload());
  }

  function update(id: number, patch: UpdateRuleBody) {
    void action.run(() => updateIpRule(id, patch), () => {
      setEditing(null);
      rules.reload();
    });
  }

  function toggle(rule: IpRule) {
    void action.run(() => updateIpRule(rule.id, { enabled: !rule.enabled }), () => rules.reload());
  }

  function remove(rule: IpRule) {
    if (!window.confirm(`Xoá rule ${rule.pattern}?`)) return;
    void action.run(() => deleteIpRule(rule.id), () => {
      if (editing?.id === rule.id) setEditing(null);
      rules.reload();
    });
  }

  function apply() {
    // One click here can block a lot of addresses at once, so the prompt says
    // how many enabled rules are about to run.
    if (!window.confirm(`Áp dụng ${enabledCount} rule đang bật lên toàn bộ IP đã biết?`)) return;
    setApplyResult(null);
    void action.run(
      async () => {
        const result = await applyIpRules();
        setApplyResult(result);
      },
      () => rules.reload(),
    );
  }

  return (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">IP rules</h2>
          <button
            type="button"
            onClick={apply}
            disabled={action.busy}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm disabled:opacity-40"
          >
            Áp dụng rule
          </button>
        </div>

        {action.actionError && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {action.actionError}
          </p>
        )}

        {applyResult && (
          <p className="rounded border border-slate-200 bg-white p-3 text-sm">
            {`matched: ${applyResult.matched} · alerts_created: ${applyResult.alerts_created}`}
          </p>
        )}

        <IpRuleForm
          editing={editing}
          busy={action.busy}
          onCreate={create}
          onUpdate={update}
          onCancelEdit={() => setEditing(null)}
        />

        {rules.loading && <p className="p-6 text-center text-slate-600">Đang tải…</p>}

        {!rules.loading && rules.error && (
          <div role="alert" className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{rules.error}</p>
            <button
              type="button"
              onClick={rules.reload}
              className="rounded border border-red-300 px-3 py-1 text-sm"
            >
              Thử lại
            </button>
          </div>
        )}

        {!rules.loading && !rules.error && (
          <IpRulesTable
            rules={ruleList}
            busy={action.busy}
            onToggle={toggle}
            onEdit={setEditing}
            onDelete={remove}
          />
        )}
      </section>
    </>
  );
}
```

- [ ] **Step 6: Register the route and the tab**

In `FE/src/admin/AdminApp.tsx`, add the import and the route inside the layout block:

```tsx
import AdminIpScreen from './AdminIpScreen';
```

```tsx
        <Route path="feedback" element={<AdminFeedbackScreen />} />
        <Route path="ip" element={<AdminIpScreen />} />
```

In `FE/src/admin/AdminLayout.tsx`, extend `TABS`:

```tsx
const TABS = [
  { to: '/admin/feedback', label: 'Feedback' },
  { to: '/admin/ip', label: 'IP' },
];
```

- [ ] **Step 7: Run the tests**

Run: `cd FE && npx vitest run src/admin`
Expected: PASS, including the 8 new IP tests.

Run: `cd FE && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add FE/src/admin/IpRuleForm.tsx FE/src/admin/IpRulesTable.tsx FE/src/admin/AdminIpScreen.tsx FE/src/admin/AdminApp.tsx FE/src/admin/AdminLayout.tsx FE/src/admin/__tests__/AdminIpScreen.test.tsx
git commit -m "feat(admin): add the IP rules block of the IP management screen"
```

---

## Task 8: FE — IP screen, states and ingest

**Files:**
- Create: `FE/src/admin/IpStatesTable.tsx`
- Create: `FE/src/admin/IngestPanel.tsx`
- Modify: `FE/src/admin/AdminIpScreen.tsx`
- Modify: `FE/src/admin/__tests__/AdminIpScreen.test.tsx`

**Interfaces:**
- Consumes: `fetchIpStates`, `unblockIp`, `ingestTraffic` (Task 4); `useAdminResource`, `useAdminAction` (Task 5); `formatUtc` (Task 3); types `IpState`, `IpStatus`, `Paged`, `IngestResult` (Task 3).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

First, add one line to the **existing** `describe('AdminIpScreen — rules', ...)` `beforeEach`:

```tsx
    vi.spyOn(api, 'fetchIpStates').mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
```

Without it, those tests reach the real `adminFetch` as soon as the screen starts loading
states — a real network attempt out of jsdom, noisy at best and flaky at worst.

Then add a second describe for the new blocks:

```tsx
import type { IpState, Paged } from '../dashboardTypes';

function state(over: Partial<IpState> = {}): IpState {
  return {
    ip: '10.0.0.9', status: 'perm_blocked', tier: 'default', score: 120,
    blockedUntil: null, autoBlocked: true, reason: 'ddos: 120 requests',
    updatedAt: '2026-08-14T10:30:00',
    ...over,
  };
}

function statesPage(items: IpState[], total = items.length): Paged<IpState> {
  return { items, total, limit: 50, offset: 0 };
}

describe('AdminIpScreen — states and ingest', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    vi.spyOn(api, 'fetchIpRules').mockResolvedValue([]);
    vi.spyOn(api, 'fetchIpStates').mockResolvedValue(statesPage([state()]));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lists the IP states', async () => {
    renderScreen();
    expect(await screen.findByText('ddos: 120 requests')).toBeInTheDocument();
  });

  it('offers unblock only for an IP that is not ok', async () => {
    vi.spyOn(api, 'fetchIpStates').mockResolvedValue(
      statesPage([state({ ip: '10.0.0.1', status: 'ok', reason: null }), state()]),
    );
    renderScreen();
    await screen.findByText('ddos: 120 requests');

    expect(screen.queryByRole('button', { name: /bỏ block 10\.0\.0\.1/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bỏ block 10\.0\.0\.9/i })).toBeInTheDocument();
  });

  it('unblock confirms, then refetches the states', async () => {
    const unblock = vi.spyOn(api, 'unblockIp').mockResolvedValue({ unblocked: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderScreen();
    await screen.findByText('ddos: 120 requests');

    await userEvent.click(screen.getByRole('button', { name: /bỏ block 10\.0\.0\.9/i }));

    await waitFor(() => expect(unblock).toHaveBeenCalledWith('10.0.0.9'));
    expect(api.fetchIpStates).toHaveBeenCalledTimes(2);
  });

  it('sends the status filter from the URL to the API', async () => {
    renderScreen('/admin/ip?status=throttled');
    await waitFor(() => {
      const params = (api.fetchIpStates as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as URLSearchParams;
      expect(params.get('status')).toBe('throttled');
      expect(params.get('limit')).toBe('50');
    });
  });

  it('ingest shows the counts it got back', async () => {
    vi.spyOn(api, 'ingestTraffic').mockResolvedValue({ ingested: 12, skipped: 3, alerts_created: 1 });
    renderScreen();
    await screen.findByLabelText('Đường dẫn log');

    await userEvent.type(screen.getByLabelText('Đường dẫn log'), '/var/log/nginx/access.log');
    await userEvent.click(screen.getByRole('button', { name: 'Ingest' }));

    expect(await screen.findByText(/ingested: 12/i)).toBeInTheDocument();
    expect(api.fetchIpStates).toHaveBeenCalledTimes(2);
  });

  it('ingest shows the BE message verbatim when the path is rejected', async () => {
    const { ApiError } = await import('../../utils/api');
    vi.spyOn(api, 'ingestTraffic').mockRejectedValue(
      new ApiError('HTTP_ERROR', 'Log path is outside the configured log directory', 400),
    );
    renderScreen();
    await screen.findByLabelText('Đường dẫn log');

    await userEvent.type(screen.getByLabelText('Đường dẫn log'), '/etc/passwd');
    await userEvent.click(screen.getByRole('button', { name: 'Ingest' }));

    expect(
      await screen.findByText('Log path is outside the configured log directory'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd FE && npx vitest run src/admin/__tests__/AdminIpScreen.test.tsx`
Expected: FAIL — the states rows and the ingest input do not exist.

- [ ] **Step 3: Write the states table**

Create `FE/src/admin/IpStatesTable.tsx`:

```tsx
import React from 'react';
import { formatUtc } from './parseUtc';
import type { IpState, IpStatus } from './dashboardTypes';

/**
 * 'temp_blocked' has no colour on the BE side yet -- nothing assigns it. It is
 * mapped anyway so that if the BE starts using it the cell is not blank.
 */
const STATUS_CLASS: Record<IpStatus, string> = {
  ok: 'bg-slate-100 text-slate-700',
  throttled: 'bg-amber-100 text-amber-800',
  temp_blocked: 'bg-orange-100 text-orange-800',
  perm_blocked: 'bg-red-100 text-red-800',
};

interface Props {
  states: IpState[];
  busy: boolean;
  onUnblock: (state: IpState) => void;
}

export default function IpStatesTable({ states, busy, onUnblock }: Props) {
  if (states.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white p-6 text-center text-slate-600">
        Chưa có IP nào khớp bộ lọc
      </p>
    );
  }

  return (
    <table className="w-full border-collapse bg-white text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-600">
          <th className="p-2">IP</th>
          <th className="p-2">Trạng thái</th>
          <th className="p-2">Tier</th>
          <th className="p-2">Điểm</th>
          <th className="p-2">Block đến</th>
          <th className="p-2">Tự động</th>
          <th className="p-2">Lý do</th>
          <th className="p-2">Cập nhật</th>
          <th className="p-2" />
        </tr>
      </thead>
      <tbody>
        {states.map((row) => (
          <tr key={row.ip} className="border-b border-slate-100">
            <td className="p-2 font-mono">{row.ip}</td>
            <td className="p-2">
              <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[row.status]}`}>
                {row.status}
              </span>
            </td>
            <td className="p-2">{row.tier}</td>
            <td className="p-2">{row.score}</td>
            <td className="p-2 whitespace-nowrap">{formatUtc(row.blockedUntil)}</td>
            <td className="p-2">{row.autoBlocked ? 'có' : 'không'}</td>
            <td className="p-2">{row.reason ?? '—'}</td>
            <td className="p-2 whitespace-nowrap">{formatUtc(row.updatedAt)}</td>
            <td className="p-2">
              {row.status !== 'ok' && (
                <button
                  type="button"
                  aria-label={`Bỏ block ${row.ip}`}
                  disabled={busy}
                  onClick={() => onUnblock(row)}
                  className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
                >
                  Bỏ block
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Write the ingest panel**

Create `FE/src/admin/IngestPanel.tsx`:

```tsx
import React, { useState } from 'react';
import type { IngestResult } from './dashboardTypes';

interface Props {
  busy: boolean;
  result: IngestResult | null;
  onIngest: (logPath: string) => void;
}

/**
 * The BE confines logPath to DASHBOARD_NGINX_LOG_DIR, so the most common
 * failure here is a rejected path. Its message is shown as the BE wrote it:
 * replacing it with generic copy would leave the operator with no way to tell
 * "outside the directory" from "file not found".
 */
export default function IngestPanel({ busy, result, onIngest }: Props) {
  const [logPath, setLogPath] = useState('');

  return (
    <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold">Ingest log nginx</h2>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = logPath.trim();
          if (trimmed) onIngest(trimmed);
        }}
      >
        <label className="text-sm">
          <span className="block text-slate-600">Đường dẫn log</span>
          <input
            aria-label="Đường dẫn log"
            value={logPath}
            disabled={busy}
            onChange={(event) => setLogPath(event.target.value)}
            placeholder="/var/log/nginx/access.log"
            className="w-80 rounded border border-slate-300 px-2 py-1 font-mono"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !logPath.trim()}
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          Ingest
        </button>
      </form>

      {result && (
        <p className="text-sm">
          {`ingested: ${result.ingested} · skipped: ${result.skipped} · alerts_created: ${result.alerts_created}`}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Wire both into the screen**

In `FE/src/admin/AdminIpScreen.tsx`, extend the imports:

```tsx
import { useSearchParams } from 'react-router-dom';
import IngestPanel from './IngestPanel';
import IpStatesTable from './IpStatesTable';
import {
  applyIpRules, createIpRule, deleteIpRule, fetchIpRules, fetchIpStates,
  ingestTraffic, unblockIp, updateIpRule,
} from './dashboardClient';
import type {
  ApplyResult, CreateRuleBody, IngestResult, IpRule, IpState, UpdateRuleBody,
} from './dashboardTypes';

const STATES_PAGE_SIZE = 50;

/** Only what the BE can actually filter on goes in the URL. `listIpRules`
 *  takes no parameters at all, so rules have no URL state and no filter. */
function statesRequestParams(status: string, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', String(STATES_PAGE_SIZE));
  params.set('offset', String(offset));
  return params;
}

function statesUrlParams(status: string, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (offset > 0) params.set('offset', String(offset));
  return params;
}
```

Inside the component, add below the existing `rules` and `action` declarations:

```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const statesOffset = Number(searchParams.get('offset') ?? 0) || 0;
  const statesKey = `${status}|${statesOffset}`;

  const states = useAdminResource(
    statesKey,
    () => fetchIpStates(statesRequestParams(status, statesOffset)),
    { fallbackMessage: 'Không tải được danh sách IP' },
  );

  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
```

Add these handlers next to the existing ones:

```tsx
  function unblock(row: IpState) {
    if (!window.confirm(`Bỏ block ${row.ip}? Các alert block đang mở của IP này cũng sẽ được đóng.`)) return;
    void action.run(() => unblockIp(row.ip), () => states.reload());
  }

  function ingest(logPath: string) {
    setIngestResult(null);
    void action.run(
      async () => {
        const result = await ingestTraffic(logPath);
        setIngestResult(result);
      },
      // Ingest re-evaluates every IP it saw, so the states list is stale.
      () => states.reload(),
    );
  }
```

Change `apply` so it refetches both blocks — applying rules writes `ip_state` as well as `ip_rules`:

```tsx
      () => {
        rules.reload();
        states.reload();
      },
```

Render the ingest panel above the rules section and the states section below it, inside the existing fragment:

```tsx
      <IngestPanel busy={action.busy} result={ingestResult} onIngest={ingest} />

      {/* ...the existing rules <section> stays here... */}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Trạng thái IP</h2>
          <label className="text-sm">
            <span className="mr-2 text-slate-600">Trạng thái</span>
            <select
              aria-label="Lọc trạng thái"
              value={status}
              onChange={(event) =>
                // Always back to the first page: page 3 of a narrower result is blank.
                setSearchParams(statesUrlParams(event.target.value, 0), { replace: true })
              }
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="">tất cả</option>
              <option value="ok">ok</option>
              <option value="throttled">throttled</option>
              <option value="temp_blocked">temp_blocked</option>
              <option value="perm_blocked">perm_blocked</option>
            </select>
          </label>
        </div>

        {states.loading && <p className="p-6 text-center text-slate-600">Đang tải…</p>}

        {!states.loading && states.error && (
          <div role="alert" className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{states.error}</p>
            <button
              type="button"
              onClick={states.reload}
              className="rounded border border-red-300 px-3 py-1 text-sm"
            >
              Thử lại
            </button>
          </div>
        )}

        {!states.loading && !states.error && states.data && (
          <>
            <IpStatesTable states={states.data.items} busy={action.busy} onUnblock={unblock} />
            <div className="flex items-center justify-between text-sm">
              <span>{`${states.data.items.length} / ${states.data.total}`}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={statesOffset === 0}
                  onClick={() => setSearchParams(statesUrlParams(status, Math.max(0, statesOffset - STATES_PAGE_SIZE)))}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >
                  Trước
                </button>
                <button
                  type="button"
                  disabled={statesOffset + states.data.items.length >= states.data.total}
                  onClick={() => setSearchParams(statesUrlParams(status, statesOffset + STATES_PAGE_SIZE))}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >
                  Sau
                </button>
              </div>
            </div>
          </>
        )}
      </section>
```

- [ ] **Step 6: Run the tests**

Run: `cd FE && npx vitest run src/admin`
Expected: PASS, including the 6 new states/ingest tests and the 8 rules tests from Task 7.

Run: `cd FE && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add FE/src/admin/IpStatesTable.tsx FE/src/admin/IngestPanel.tsx FE/src/admin/AdminIpScreen.tsx FE/src/admin/__tests__/AdminIpScreen.test.tsx
git commit -m "feat(admin): add the IP states and ingest blocks of the IP management screen"
```

---

## Task 9: FE — the Alerts screen

**Files:**
- Create: `FE/src/admin/AlertsTable.tsx`
- Create: `FE/src/admin/AdminAlertsScreen.tsx`
- Create: `FE/src/admin/__tests__/AdminAlertsScreen.test.tsx`
- Modify: `FE/src/admin/AdminApp.tsx`
- Modify: `FE/src/admin/AdminLayout.tsx`

**Interfaces:**
- Consumes: `fetchAlerts`, `resolveAlert` (Task 4); `useAdminResource`, `useAdminAction` (Task 5); `formatUtc` (Task 3); types `Alert`, `AlertSeverity`, `Paged` (Task 3).
- Produces: `AdminAlertsScreen` (default export).

Two behaviours confirmed from the BE, not assumed:
- `AlertQueryDto.resolved` accepts the strings `'true'` / `'false'` only (a `@Transform` maps them, `@IsBoolean` rejects anything else). Omitting the key means "all".
- `PATCH /alerts/:id/resolve` is idempotent — `resolveAlert` looks the alert up by id and never checks `resolved`, so calling it twice returns 200 both times. The resolve button is hidden on already-resolved rows for tidiness, not for safety.

- [ ] **Step 1: Write the failing test**

Create `FE/src/admin/__tests__/AdminAlertsScreen.test.tsx`:

```tsx
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminAlertsScreen from '../AdminAlertsScreen';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import * as api from '../dashboardClient';
import type { Alert, Paged } from '../dashboardTypes';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 1, type: 'ddos_permanent', severity: 'critical', ip: '10.0.0.9', provider: null,
    detailJson: '{"score":120}', resolved: false,
    createdAt: '2026-08-14T10:30:00', resolvedAt: null,
    ...over,
  };
}

function page(items: Alert[], total = items.length): Paged<Alert> {
  return { items, total, limit: 50, offset: 0 };
}

function renderScreen(entry = '/admin/alerts') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/alerts" element={<AdminAlertsScreen />} />
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const paramsOfCall = (n: number) =>
  (api.fetchAlerts as unknown as ReturnType<typeof vi.fn>).mock.calls[n][0] as URLSearchParams;

describe('AdminAlertsScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    vi.spyOn(api, 'fetchAlerts').mockResolvedValue(page([alert()]));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('defaults to the unresolved alerts', async () => {
    renderScreen();
    await waitFor(() => expect(paramsOfCall(0).get('resolved')).toBe('false'));
  });

  it('drops the resolved key entirely when the filter is "all"', async () => {
    renderScreen('/admin/alerts?resolved=');
    await waitFor(() => expect(paramsOfCall(0).has('resolved')).toBe(false));
  });

  it('renders the severity as a badge', async () => {
    renderScreen();
    expect(await screen.findByText('critical')).toBeInTheDocument();
  });

  it('renders an em dash for a null provider', async () => {
    renderScreen();
    await screen.findByText('critical');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the parsed detail when the row is expanded', async () => {
    renderScreen();
    await screen.findByText('critical');
    await userEvent.click(screen.getByRole('button', { name: /chi tiết alert 1/i }));
    expect(await screen.findByText(/"score": 120/)).toBeInTheDocument();
  });

  it('falls back to the raw string when detailJson is not valid JSON', async () => {
    vi.spyOn(api, 'fetchAlerts').mockResolvedValue(page([alert({ detailJson: 'not json{' })]));
    renderScreen();
    await screen.findByText('critical');
    await userEvent.click(screen.getByRole('button', { name: /chi tiết alert 1/i }));
    expect(await screen.findByText('not json{')).toBeInTheDocument();
  });

  it('resolving refetches the list', async () => {
    const resolve = vi.spyOn(api, 'resolveAlert').mockResolvedValue(alert({ resolved: true }));
    renderScreen();
    await screen.findByText('critical');

    await userEvent.click(screen.getByRole('button', { name: /đã xử lý alert 1/i }));

    await waitFor(() => expect(resolve).toHaveBeenCalledWith(1));
    expect(api.fetchAlerts).toHaveBeenCalledTimes(2);
  });

  it('hides the resolve button on an already-resolved row', async () => {
    vi.spyOn(api, 'fetchAlerts').mockResolvedValue(
      page([alert({ resolved: true, resolvedAt: '2026-08-14T11:00:00' })]),
    );
    renderScreen('/admin/alerts?resolved=true');
    await screen.findByText('critical');
    expect(screen.queryByRole('button', { name: /đã xử lý alert 1/i })).not.toBeInTheDocument();
  });

  it('polls every 30 seconds while auto-refresh is on', async () => {
    vi.useFakeTimers();
    renderScreen();
    await act(async () => {});
    expect(api.fetchAlerts).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(api.fetchAlerts).toHaveBeenCalledTimes(2);
  });

  it('stops polling when auto-refresh is turned off', async () => {
    // userEvent and fake timers deadlock unless userEvent is told how to
    // advance them.
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderScreen();
    await act(async () => {});

    await user.click(screen.getByRole('checkbox', { name: 'Tự động làm mới' }));
    const callsBefore = (api.fetchAlerts as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    await act(async () => { vi.advanceTimersByTime(90_000); });
    expect(api.fetchAlerts).toHaveBeenCalledTimes(callsBefore);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd FE && npx vitest run src/admin/__tests__/AdminAlertsScreen.test.tsx`
Expected: FAIL — cannot resolve `../AdminAlertsScreen`.

- [ ] **Step 3: Write the alerts table**

Create `FE/src/admin/AlertsTable.tsx`:

```tsx
import React, { useState } from 'react';
import { formatUtc } from './parseUtc';
import type { Alert, AlertSeverity } from './dashboardTypes';

const SEVERITY_CLASS: Record<AlertSeverity, string> = {
  info: 'bg-slate-100 text-slate-700',
  warning: 'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-800',
};

/**
 * `detailJson` is a string whose shape varies by alert type (ddos, rule_block,
 * provider...), and the BE promises no schema for it. Pretty-printing the raw
 * object is honest; mapping named fields per type would break silently the
 * first time the BE adds an alert type.
 */
function prettyDetail(detailJson: string): string {
  try {
    return JSON.stringify(JSON.parse(detailJson), null, 2);
  } catch {
    return detailJson;
  }
}

interface Props {
  alerts: Alert[];
  busy: boolean;
  onResolve: (alert: Alert) => void;
}

export default function AlertsTable({ alerts, busy, onResolve }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (alerts.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white p-6 text-center text-slate-600">
        Không có alert nào khớp bộ lọc
      </p>
    );
  }

  return (
    <table className="w-full border-collapse bg-white text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-600">
          <th className="p-2">Mức</th>
          <th className="p-2">Loại</th>
          <th className="p-2">IP</th>
          <th className="p-2">Provider</th>
          <th className="p-2">Tạo lúc</th>
          <th className="p-2">Trạng thái</th>
          <th className="p-2" />
        </tr>
      </thead>
      <tbody>
        {alerts.map((row) => (
          <React.Fragment key={row.id}>
            <tr className="border-b border-slate-100">
              <td className="p-2">
                <span className={`rounded px-2 py-0.5 text-xs ${SEVERITY_CLASS[row.severity]}`}>
                  {row.severity}
                </span>
              </td>
              <td className="p-2">{row.type}</td>
              <td className="p-2 font-mono">{row.ip ?? '—'}</td>
              <td className="p-2">{row.provider ?? '—'}</td>
              <td className="p-2 whitespace-nowrap">{formatUtc(row.createdAt)}</td>
              <td className="p-2">{row.resolved ? `đã xử lý ${formatUtc(row.resolvedAt)}` : 'đang mở'}</td>
              <td className="p-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label={`Chi tiết alert ${row.id}`}
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    className="rounded border border-slate-300 px-2 py-0.5"
                  >
                    Chi tiết
                  </button>
                  {!row.resolved && (
                    <button
                      type="button"
                      aria-label={`Đã xử lý alert ${row.id}`}
                      disabled={busy}
                      onClick={() => onResolve(row)}
                      className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
                    >
                      Đã xử lý
                    </button>
                  )}
                </div>
              </td>
            </tr>
            {expanded === row.id && (
              <tr className="border-b border-slate-100 bg-slate-50">
                <td colSpan={7} className="p-2">
                  <pre className="overflow-x-auto text-xs">{prettyDetail(row.detailJson)}</pre>
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Write the screen**

Create `FE/src/admin/AdminAlertsScreen.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AlertsTable from './AlertsTable';
import { fetchAlerts, resolveAlert } from './dashboardClient';
import { useAdminAction, useAdminResource } from './useAdminResource';
import type { Alert } from './dashboardTypes';

const PAGE_SIZE = 50;
const POLL_MS = 30_000;

/**
 * `resolved` reaches the BE as the literal string 'true' or 'false': its DTO
 * transforms exactly those two and rejects anything else. An absent key means
 * "all", so an empty filter must omit it rather than send `resolved=`.
 */
function requestParams(resolved: string, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (resolved) params.set('resolved', resolved);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));
  return params;
}

function urlParams(resolved: string, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set('resolved', resolved);
  if (offset > 0) params.set('offset', String(offset));
  return params;
}

export default function AdminAlertsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Opening this screen means "show me what is still open". The default lives
  // in the read, and an effect writes it into the URL so a copied link shows
  // the reader exactly what the sender saw. Keying off the effective value
  // rather than the raw query string keeps that normalisation from costing a
  // second request.
  const resolved = searchParams.get('resolved') ?? 'false';
  const offset = Number(searchParams.get('offset') ?? 0) || 0;
  const key = `${resolved}|${offset}`;

  const hasResolvedParam = searchParams.has('resolved');
  useEffect(() => {
    if (!hasResolvedParam) setSearchParams(urlParams('false', 0), { replace: true });
  }, [hasResolvedParam, setSearchParams]);

  const [autoRefresh, setAutoRefresh] = useState(true);

  const alerts = useAdminResource(
    key,
    () => fetchAlerts(requestParams(resolved, offset)),
    {
      pollMs: autoRefresh ? POLL_MS : undefined,
      fallbackMessage: 'Không tải được danh sách alert',
    },
  );
  const action = useAdminAction();

  function resolve(row: Alert) {
    void action.run(() => resolveAlert(row.id), () => alerts.reload());
  }

  const page = alerts.data;
  const total = page?.total ?? 0;
  const shown = page?.items.length ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Alerts</h2>
        <div className="flex items-center gap-4 text-sm">
          <label>
            <span className="mr-2 text-slate-600">Trạng thái</span>
            <select
              aria-label="Lọc trạng thái"
              value={resolved}
              onChange={(event) => setSearchParams(urlParams(event.target.value, 0), { replace: true })}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="false">đang mở</option>
              <option value="true">đã xử lý</option>
              <option value="">tất cả</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Tự động làm mới"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            {/* Off is a real need: the table must not move under someone who is
                reading an expanded detail row. */}
            <span>Tự động làm mới</span>
          </label>
        </div>
      </div>

      {action.actionError && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {action.actionError}
        </p>
      )}

      {/* A failed poll keeps the rows and only warns; only a failed first load
          replaces the screen. */}
      {alerts.error && page && (
        <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Không cập nhật được, đang thử lại
        </p>
      )}

      {alerts.loading && <p className="p-6 text-center text-slate-600">Đang tải…</p>}

      {!alerts.loading && alerts.error && !page && (
        <div role="alert" className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{alerts.error}</p>
          <button
            type="button"
            onClick={alerts.reload}
            className="rounded border border-red-300 px-3 py-1 text-sm"
          >
            Thử lại
          </button>
        </div>
      )}

      {page && (
        <>
          <AlertsTable alerts={page.items} busy={action.busy} onResolve={resolve} />
          <div className="flex items-center justify-between text-sm">
            <span>{`${shown} / ${total}`}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setSearchParams(urlParams(resolved, Math.max(0, offset - PAGE_SIZE)))}
                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Trước
              </button>
              <button
                type="button"
                disabled={offset + shown >= total}
                onClick={() => setSearchParams(urlParams(resolved, offset + PAGE_SIZE))}
                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Sau
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 5: Register the route and the tab**

In `FE/src/admin/AdminApp.tsx`:

```tsx
import AdminAlertsScreen from './AdminAlertsScreen';
```

```tsx
        <Route path="ip" element={<AdminIpScreen />} />
        <Route path="alerts" element={<AdminAlertsScreen />} />
```

In `FE/src/admin/AdminLayout.tsx`:

```tsx
const TABS = [
  { to: '/admin/feedback', label: 'Feedback' },
  { to: '/admin/ip', label: 'IP' },
  { to: '/admin/alerts', label: 'Alerts' },
];
```

- [ ] **Step 6: Assert the full tab set**

The layout test has grown one tab per task; this is where it reaches its final shape. Add to
`FE/src/admin/__tests__/AdminLayout.test.tsx`:

```tsx
  it('links to every admin screen', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: 'Feedback' })).toHaveAttribute('href', '/admin/feedback');
    expect(screen.getByRole('link', { name: 'IP' })).toHaveAttribute('href', '/admin/ip');
    expect(screen.getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/admin/alerts');
  });
```

- [ ] **Step 7: Run the tests**

Run: `cd FE && npx vitest run src/admin`
Expected: PASS, including the 11 new alerts tests and the 4 layout tests.

Run: `cd FE && npx tsc --noEmit`
Expected: no errors.

If `polls every 30 seconds` reports 3 calls instead of 2, the `visibilitychange` listener also fired — check that the test environment is not toggling `document.hidden`, and assert `toHaveBeenCalledTimes(2)` only after confirming no visibility event was dispatched. Do not relax the assertion to `toBeGreaterThan`.

- [ ] **Step 8: Commit**

```bash
git add FE/src/admin/AlertsTable.tsx FE/src/admin/AdminAlertsScreen.tsx FE/src/admin/AdminApp.tsx FE/src/admin/AdminLayout.tsx FE/src/admin/__tests__/AdminAlertsScreen.test.tsx FE/src/admin/__tests__/AdminLayout.test.tsx
git commit -m "feat(admin): add the alerts screen with polling"
```

---

## Task 10: Docs — record the new debt and the new status

**Files:**
- Modify: `docs/admin/01-traffic-dashboard-spec.md`

**Interfaces:**
- Consumes: the outcome of Tasks 1–9.
- Produces: nothing code depends on.

- [ ] **Step 1: Update the status line**

At the top of `docs/admin/01-traffic-dashboard-spec.md`, replace

```
> **Trạng thái:** BE hoàn tất & xanh test — FE chưa làm
```

with

```
> **Trạng thái:** BE hoàn tất & xanh test — FE: IP Management + Alerts xong; Traffic Overview + LLM Usage chưa làm
```

- [ ] **Step 2: Add the new accepted-debt entries**

Append to the accepted-debt list in §7, continuing its existing numbering (the list currently ends at #8):

```
9. `IpRule.pattern` không được validate hình dạng. `RuleDto` chỉ kiểm tra kiểu, không rỗng
   và độ dài ≤ 64; một pattern sai cú pháp sẽ được lưu và chỉ trượt âm thầm khi
   `ipMatchesRule` so khớp. FE cố ý cũng không validate để hai bên không nói hai chuyện
   khác nhau. Sửa đúng cần một validator IP/CIDR dùng chung cho cả hai phía.
10. Màn Alerts và màn IP không chia sẻ state. `unblockIp` và `applyIpRules` đóng alert ở BE,
    nhưng nếu người dùng đang mở màn Alerts ở tab khác thì tab đó chỉ bắt kịp ở nhịp
    auto-refresh tiếp theo — lệch tối đa 30 giây.
```

- [ ] **Step 3: Verify no placeholder crept in**

Run: `grep -n -E 'TBD|TODO|FIXME' docs/admin/01-traffic-dashboard-spec.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/admin/01-traffic-dashboard-spec.md
git commit -m "docs(dashboard): record the FE status and two newly accepted debts"
```

---

## Final verification

- [ ] **Run the whole BE suite**

Run: `cd BE && npx jest`
Expected: PASS. Task 2 changed a global filter, so nothing less than a full run is evidence.

- [ ] **Run the whole FE suite and the type check**

Run: `cd FE && npx vitest run`
Expected: PASS.

Run: `cd FE && npx tsc --noEmit`
Expected: no errors.

- [ ] **Confirm no BOM was introduced**

Run: `for f in $(git diff --name-only master...HEAD); do head -c 3 "$f" | grep -q $'\xef\xbb\xbf' && echo "BOM: $f"; done; echo done`
Expected: `done` with no `BOM:` lines.
