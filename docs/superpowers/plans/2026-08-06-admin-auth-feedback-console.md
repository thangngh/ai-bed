# Admin Auth & Feedback Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `admin_users` table, a password login that issues a signed token, and a read-only console at `/admin/feedback` that lists every feedback row in the system with filters and pagination.

**Architecture:** A self-contained `AdminModule` in NestJS owns everything under the `/admin` prefix — it never touches the tenant middleware, never sees `x-tenant-id`, and shares nothing with the parent-facing flow except the `Feedback`, `ChildProfile`, and `Story` entities it reads. Password hashing (scrypt) and token signing (HS256) are written against `node:crypto` as plain functions with no NestJS imports, so they can be tested by direct call. On the frontend, `react-router-dom` wraps the existing `App` at `/` untouched and mounts a lazily-loaded admin chunk at `/admin/*`.

**Tech Stack:** NestJS 11 · TypeORM 0.3 · SQLite (two files: `core.db`, `local.db`) · Jest + supertest · React 19 · Vite 6 · Vitest + Testing Library · Tailwind 4 · `react-router-dom` (the one new dependency in the whole plan)

**Spec:** `docs/superpowers/specs/2026-08-06-admin-auth-feedback-console-design.md`

## Global Constraints

- **No new BE dependencies.** Password hashing and JWT are built on `node:crypto` only. Do not install `bcrypt`, `argon2`, `jsonwebtoken`, `@nestjs/jwt`, or `passport`.
- **One new FE dependency:** `react-router-dom`. Nothing else.
- **`FE/src/App.tsx` must not be modified.** It becomes the element of route `/` and is otherwise untouched.
- **Controllers return bare objects**, not `{ data: ... }`. This matches `story.controller.ts:30`, `tenant.controller.ts:11`, `analytics.controller.ts`. Errors do use the envelope, produced by `HttpExceptionFilter`.
- **All user-facing copy is Vietnamese.** Error codes and log fields stay English.
- **scrypt parameters:** `N=32768, r=8, p=1, keylen=64`, salt 16 bytes, and **`maxmem: 64 * 1024 * 1024`**. Node's default `maxmem` is 32MB and these parameters need exactly 32MB, so omitting `maxmem` throws `ERR_CRYPTO_INVALID_SCRYPT_PARAM`.
- **JWT is HS256 only.** `verify` compares `header.alg === 'HS256'` by hard equality and rejects everything else.
- **`ADMIN_JWT_SECRET` must be ≥ 32 characters.** Shorter or missing means the process refuses to start. No default value, ever.
- **Login throttle:** 10 failures per username per 15 minutes, keyed by lowercased username, not by IP.
- **Feedback list:** fixed sort `created_at DESC`. The client cannot choose a sort column.
- Run BE commands from `BE/`, FE commands from `FE/`.

---

## File Structure

### Backend — created

| File | Responsibility |
|---|---|
| `BE/src/modules/admin/auth/password.ts` | scrypt hash/verify + the dummy hash used to equalise login timing. No NestJS imports. |
| `BE/src/modules/admin/auth/jwt.ts` | HS256 sign/verify. No NestJS imports. |
| `BE/src/modules/admin/auth/login-throttle.ts` | Per-username failure counter with an injectable clock. No NestJS imports. |
| `BE/src/modules/admin/auth/admin.guard.ts` | Reads `Authorization: Bearer`, verifies, attaches `req.admin`. |
| `BE/src/modules/admin/admin.config.ts` | Reads and validates `ADMIN_JWT_SECRET` / `ADMIN_JWT_TTL_SECONDS`. Throws at boot when invalid. |
| `BE/src/modules/admin/entities/admin-user.entity.ts` | The `admin_users` table. |
| `BE/src/modules/admin/dto/login.dto.ts` | Login body validation. |
| `BE/src/modules/admin/dto/list-feedback.dto.ts` | Feedback query-string validation. |
| `BE/src/modules/admin/admin-auth.service.ts` | Login: throttle → lookup → verify → sign → record. |
| `BE/src/modules/admin/admin-auth.controller.ts` | `POST /admin/login`. |
| `BE/src/modules/admin/admin-feedback.service.ts` | Paginated filtered read across `core.db` and `local.db`. |
| `BE/src/modules/admin/admin-feedback.controller.ts` | `GET /admin/feedbacks`, guarded. |
| `BE/src/modules/admin/admin.module.ts` | Wires the above. |
| `BE/scripts/create-admin.ts` | Seed CLI. |
| `BE/src/test-setup.ts` | Jest `setupFiles`: supplies a test `ADMIN_JWT_SECRET`. |

### Backend — modified

| File | Change |
|---|---|
| `BE/src/common/pipes/validation.pipe.ts:20` | Stop echoing submitted values for sensitive field names. |
| `BE/src/app.module.ts:46` | Add `AdminUser` to the `core` datasource entities. |
| `BE/src/app.module.ts:32` | Add `adminConfig` to `ConfigModule.forRoot({ load })`. |
| `BE/src/app.module.ts:38` | Import `AdminModule`. |
| `BE/src/app.module.ts:68` | `.exclude('health', 'admin/(.*)')` so `/admin` never mints a tenant. |
| `BE/src/common/__tests__/test-db.ts:20` | Add `AdminUser` to the core test entities. |
| `BE/package.json` | `admin:create` script + jest `setupFiles`. |
| `.env.example` | `ADMIN_JWT_SECRET`, `ADMIN_JWT_TTL_SECONDS`. |

### Frontend — created

| File | Responsibility |
|---|---|
| `FE/src/admin/types.ts` | `AdminFeedbackItem`, `AdminFeedbackPage`, `LoginResponse`. |
| `FE/src/admin/adminSession.ts` | Token get/set/clear + client-side expiry read. |
| `FE/src/admin/adminClient.ts` | Admin-only fetch. Sends `Authorization`, never `X-Tenant-Id`, never calls `/tenant/init`. |
| `FE/src/admin/RequireAdmin.tsx` | Route guard. |
| `FE/src/admin/AdminLoginScreen.tsx` | Login form. |
| `FE/src/admin/FeedbackFilters.tsx` | Filter controls (presentational). |
| `FE/src/admin/FeedbackTable.tsx` | Table rendering (presentational). |
| `FE/src/admin/AdminFeedbackScreen.tsx` | Fetch + URL sync + pagination + four view states. |
| `FE/src/admin/AdminApp.tsx` | Admin sub-routes. Default export, lazily imported. |

### Frontend — modified

| File | Change |
|---|---|
| `FE/src/main.tsx` | Wrap in `BrowserRouter`; route `/` → `App`, `/admin/*` → lazy `AdminApp`. |
| `FE/package.json` | Add `react-router-dom`. |

---

## Task Order and Dependencies

```
BE-1 (pipe redaction)  ─── independent, do first
BE-2 (password) ──┐
BE-3 (jwt) ───────┤
BE-4 (throttle) ──┤
BE-5 (entity+config) ─┴──> BE-6 (guard) ──> BE-7 (auth) ──> BE-9 (module+integration) ──> BE-10 (seed CLI)
                             BE-8 (feedback) ──────────────┘
FE-1 (session) ──> FE-2 (client) ──> FE-3 (router+login) ──> FE-4 (table+filters) ──> FE-5 (screen)
```

FE-1 through FE-5 only need the BE contract, not a running BE — every FE test mocks `fetch`. They can start any time.

---

## Task BE-1: Stop ValidationPipe from echoing passwords

`ValidationPipe` puts the submitted value into `details.value` on every validation failure. Once `POST /admin/login` exists, a failed validation on the `password` field returns the typed password verbatim in the 422 body. Fix this before the login endpoint exists, not after.

**Files:**
- Modify: `BE/src/common/pipes/validation.pipe.ts:16-23`
- Test: `BE/src/common/__tests__/validation.pipe.spec.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. Behaviour change only.

- [ ] **Step 1: Write the failing test**

Create `BE/src/common/__tests__/validation.pipe.spec.ts`:

```typescript
import { IsString, MinLength } from 'class-validator';
import { ArgumentMetadata } from '@nestjs/common';
import { ValidationPipe, isSensitiveField } from '../pipes/validation.pipe';

class SecretDto {
  @IsString()
  @MinLength(12)
  password!: string;
}

class TokenDto {
  @IsString()
  @MinLength(12)
  refreshToken!: string;
}

class PlainDto {
  @IsString()
  @MinLength(3)
  title!: string;
}

const meta = (metatype: any): ArgumentMetadata => ({ type: 'body', metatype, data: undefined });

describe('ValidationPipe redaction', () => {
  const pipe = new ValidationPipe();

  it('omits details.value when the failing field is a password', async () => {
    const err = await pipe.transform({ password: 'short' }, meta(SecretDto)).catch((e) => e);

    expect(err.getStatus()).toBe(422);
    expect(err.getResponse().error.code).toBe('VALIDATION_ERROR');
    expect(err.getResponse().error.details).toEqual({ field: 'password' });
    expect(err.getResponse().error.details).not.toHaveProperty('value');
    // The submitted secret must not appear anywhere in the response body.
    expect(JSON.stringify(err.getResponse())).not.toContain('short');
  });

  it('omits details.value for a token-shaped field name', async () => {
    const err = await pipe.transform({ refreshToken: 'abc' }, meta(TokenDto)).catch((e) => e);
    expect(err.getResponse().error.details).toEqual({ field: 'refreshToken' });
    expect(JSON.stringify(err.getResponse())).not.toContain('abc');
  });

  it('still reports the value for non-sensitive fields', async () => {
    const err = await pipe.transform({ title: 'ab' }, meta(PlainDto)).catch((e) => e);
    expect(err.getResponse().error.details).toEqual({ field: 'title', value: 'ab' });
  });

  it('passes a valid payload straight through', async () => {
    await expect(pipe.transform({ title: 'a valid title' }, meta(PlainDto)))
      .resolves.toMatchObject({ title: 'a valid title' });
  });

  it('treats password, token, secret and authorization as sensitive', () => {
    expect(isSensitiveField('password')).toBe(true);
    expect(isSensitiveField('token')).toBe(true);
    expect(isSensitiveField('secret')).toBe(true);
    expect(isSensitiveField('authorization')).toBe(true);
    expect(isSensitiveField('Password')).toBe(true);
    expect(isSensitiveField('currentPassword')).toBe(true);
    expect(isSensitiveField('apiToken')).toBe(true);
    expect(isSensitiveField('title')).toBe(false);
    expect(isSensitiveField('note')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- validation.pipe.spec` (from `BE/`)
Expected: FAIL — `isSensitiveField` is not exported, and the redaction assertions fail because `details.value` is present.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `transform` in `BE/src/common/pipes/validation.pipe.ts`:

```typescript
import { PipeTransform, Injectable, ArgumentMetadata, UnprocessableEntityException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

/**
 * Fields whose submitted value must never travel back out in an error body.
 * The 422 for a rejected login would otherwise contain the typed password.
 * Substring match so `currentPassword` and `apiToken` are covered too.
 */
const SENSITIVE_FIELD_PARTS = ['password', 'token', 'secret', 'authorization'];

export function isSensitiveField(field: string): boolean {
  const lower = field.toLowerCase();
  return SENSITIVE_FIELD_PARTS.some((part) => lower.includes(part));
}

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
      const details: Record<string, any> = { field: firstError.property };
      if (!isSensitiveField(firstError.property)) {
        details.value = value[firstError.property];
      }
      throw new UnprocessableEntityException({
        error: { code: 'VALIDATION_ERROR', message, details },
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

- [ ] **Step 4: Run the test and the full BE suite**

Run: `npm test -- validation.pipe.spec` → Expected: PASS
Run: `npm test` → Expected: all existing suites still PASS

- [ ] **Step 5: Commit**

```bash
git add BE/src/common/pipes/validation.pipe.ts BE/src/common/__tests__/validation.pipe.spec.ts
git commit -m "fix(be): stop returning submitted passwords in 422 bodies"
```

---

## Task BE-2: scrypt password hashing

**Files:**
- Create: `BE/src/modules/admin/auth/password.ts`
- Test: `BE/src/modules/admin/auth/__tests__/password.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `hashPassword(password: string): Promise<string>` — returns `scrypt$N$r$p$<salt_b64url>$<hash_b64url>`
  - `verifyPassword(password: string, stored: string): Promise<boolean>` — never throws
  - `dummyPasswordHash(): Promise<string>` — a real hash of an unguessable value, computed once and cached

- [ ] **Step 1: Write the failing test**

Create `BE/src/modules/admin/auth/__tests__/password.spec.ts`:

```typescript
import { hashPassword, verifyPassword, dummyPasswordHash } from '../password';

// scrypt at N=32768 costs ~100ms per call and these tests make several.
jest.setTimeout(30_000);

describe('hashPassword', () => {
  it('produces a parameterised scrypt string, not the plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse battery staple');
    expect(hash.split('$')).toHaveLength(6);
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
  });

  it('produces a different string every time for the same password', async () => {
    const a = await hashPassword('same-password-twice');
    const b = await hashPassword('same-password-twice');
    // If these matched, the salt would not be doing anything and two admins
    // with the same password would be visibly identical in the table.
    expect(a).not.toEqual(b);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password', async () => {
    const hash = await hashPassword('right-password-here');
    await expect(verifyPassword('right-password-here', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('right-password-here');
    await expect(verifyPassword('wrong-password-here', hash)).resolves.toBe(false);
  });

  it('rejects a password that differs only in case', async () => {
    const hash = await hashPassword('CaseSensitive123');
    await expect(verifyPassword('casesensitive123', hash)).resolves.toBe(false);
  });

  it('returns false instead of throwing on a malformed stored string', async () => {
    for (const bad of ['', 'not-a-hash', 'scrypt$1$2$3', 'bcrypt$32768$8$1$aaaa$bbbb', 'scrypt$x$8$1$aaaa$bbbb']) {
      await expect(verifyPassword('anything', bad)).resolves.toBe(false);
    }
  });

  it('rejects a hash whose stored digest has been tampered with', async () => {
    const hash = await hashPassword('tamper-target-pass');
    const parts = hash.split('$');
    parts[5] = Buffer.alloc(64, 0).toString('base64url');
    await expect(verifyPassword('tamper-target-pass', parts.join('$'))).resolves.toBe(false);
  });
});

describe('dummyPasswordHash', () => {
  it('is a valid hash that no plausible password matches', async () => {
    const dummy = await dummyPasswordHash();
    expect(dummy.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('', dummy)).resolves.toBe(false);
    await expect(verifyPassword('admin', dummy)).resolves.toBe(false);
  });

  it('returns the same value on repeat calls so the cost is paid once', async () => {
    await expect(dummyPasswordHash()).resolves.toEqual(await dummyPasswordHash());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- password.spec`
Expected: FAIL — `Cannot find module '../password'`

- [ ] **Step 3: Write minimal implementation**

Create `BE/src/modules/admin/auth/password.ts`:

```typescript
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: Record<string, number>,
) => Promise<Buffer>;

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * 128 * N * r is exactly 32MB at these parameters, and Node's default maxmem
 * is also 32MB -- calling scrypt without raising it throws
 * ERR_CRYPTO_INVALID_SCRYPT_PARAM rather than returning a hash.
 */
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const digest = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64url'),
    digest.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n <= 1 || r < 1 || p < 1) return false;

  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    // The stored parameters drive the derivation, so raising N later leaves
    // every existing hash verifiable.
    actual = await scryptAsync(password, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

let cached: Promise<string> | null = null;

/**
 * A real hash of a value nobody knows. The login path verifies against it when
 * the username does not exist, so an unknown username costs the same scrypt
 * time as a known one -- without it, response latency turns the endpoint into
 * a username oracle.
 */
export function dummyPasswordHash(): Promise<string> {
  if (!cached) cached = hashPassword(randomBytes(32).toString('hex'));
  return cached;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- password.spec`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/admin/auth/password.ts BE/src/modules/admin/auth/__tests__/password.spec.ts
git commit -m "feat(admin): scrypt password hashing on node:crypto alone"
```

---

## Task BE-3: HS256 token signing and verification

This is the highest-risk file in the plan. Every row of the rejection table gets its own test.

**Files:**
- Create: `BE/src/modules/admin/auth/jwt.ts`
- Test: `BE/src/modules/admin/auth/__tests__/jwt.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface AdminJwtPayload { sub: string; username: string; iat: number; exp: number }`
  - `signAdminToken(claims: { sub: string; username: string }, secret: string, ttlSeconds: number, now?: number): string`
  - `verifyAdminToken(token: string, secret: string, now?: number): AdminJwtPayload | null`
  - `now` is **seconds** since epoch and defaults to `Math.floor(Date.now() / 1000)`.

- [ ] **Step 1: Write the failing test**

Create `BE/src/modules/admin/auth/__tests__/jwt.spec.ts`:

```typescript
import { createHmac } from 'node:crypto';
import { signAdminToken, verifyAdminToken } from '../jwt';

const SECRET = 'a'.repeat(48);
const NOW = 1_800_000_000;
const CLAIMS = { sub: 'admin-uuid-1', username: 'thang' };

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Build a token by hand so tests can control every segment independently. */
function forge(header: unknown, payload: unknown, secret = SECRET): string {
  const h = b64(header);
  const p = b64(payload);
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

describe('signAdminToken', () => {
  it('produces three base64url segments', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('sets iat to now and exp to now + ttl', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload).toEqual({ sub: 'admin-uuid-1', username: 'thang', iat: NOW, exp: NOW + 3600 });
  });
});

describe('verifyAdminToken', () => {
  it('round-trips a freshly signed token', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    expect(verifyAdminToken(token, SECRET, NOW)).toEqual({
      sub: 'admin-uuid-1', username: 'thang', iat: NOW, exp: NOW + 3600,
    });
  });

  it('rejects alg: none', () => {
    const h = b64({ alg: 'none', typ: 'JWT' });
    const p = b64({ ...CLAIMS, iat: NOW, exp: NOW + 3600 });
    expect(verifyAdminToken(`${h}.${p}.`, SECRET, NOW)).toBeNull();
    expect(verifyAdminToken(`${h}.${p}.AAAA`, SECRET, NOW)).toBeNull();
  });

  it('rejects alg: RS256 even when the HMAC happens to match', () => {
    // Signed correctly with HMAC but declaring RS256: accepting this is the
    // classic algorithm-confusion hole.
    const token = forge({ alg: 'RS256', typ: 'JWT' }, { ...CLAIMS, iat: NOW, exp: NOW + 3600 });
    expect(verifyAdminToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const [h, , s] = token.split('.');
    const swapped = b64({ sub: 'someone-else', username: 'attacker', iat: NOW, exp: NOW + 3600 });
    expect(verifyAdminToken(`${h}.${swapped}.${s}`, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const [h, p, s] = token.split('.');
    const flipped = s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A');
    expect(verifyAdminToken(`${h}.${p}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signAdminToken(CLAIMS, 'b'.repeat(48), 3600, NOW);
    expect(verifyAdminToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects a token with no exp claim', () => {
    const token = forge({ alg: 'HS256', typ: 'JWT' }, { ...CLAIMS, iat: NOW });
    expect(verifyAdminToken(token, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token, including exactly at exp', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    expect(verifyAdminToken(token, SECRET, NOW + 3600)).toBeNull();
    expect(verifyAdminToken(token, SECRET, NOW + 3601)).toBeNull();
    expect(verifyAdminToken(token, SECRET, NOW + 3599)).not.toBeNull();
  });

  it('rejects tokens that do not have exactly three segments', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const [h, p, s] = token.split('.');
    expect(verifyAdminToken(`${h}.${p}`, SECRET, NOW)).toBeNull();
    expect(verifyAdminToken(`${h}.${p}.${s}.${s}`, SECRET, NOW)).toBeNull();
    expect(verifyAdminToken('', SECRET, NOW)).toBeNull();
  });

  it('rejects standard base64 spellings of a valid token', () => {
    const token = signAdminToken(CLAIMS, SECRET, 3600, NOW);
    const [h, p, s] = token.split('.');
    // Same bytes, different alphabet. Accepting both would mean one logical
    // token has two spellings.
    const std = Buffer.from(s, 'base64url').toString('base64');
    if (std !== s) expect(verifyAdminToken(`${h}.${p}.${std}`, SECRET, NOW)).toBeNull();
    expect(verifyAdminToken(`${h}.${p}.${s}=`, SECRET, NOW)).toBeNull();
    expect(verifyAdminToken(`${h}.${p}.${s}+`, SECRET, NOW)).toBeNull();
  });

  it('rejects a token whose header or payload is not JSON', () => {
    const notJson = Buffer.from('hello').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(`${notJson}.${notJson}`).digest('base64url');
    expect(verifyAdminToken(`${notJson}.${notJson}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('rejects a token missing sub or username', () => {
    expect(verifyAdminToken(forge({ alg: 'HS256', typ: 'JWT' }, { username: 'thang', iat: NOW, exp: NOW + 60 }), SECRET, NOW)).toBeNull();
    expect(verifyAdminToken(forge({ alg: 'HS256', typ: 'JWT' }, { sub: 'x', iat: NOW, exp: NOW + 60 }), SECRET, NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- jwt.spec`
Expected: FAIL — `Cannot find module '../jwt'`

- [ ] **Step 3: Write minimal implementation**

Create `BE/src/modules/admin/auth/jwt.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface AdminJwtPayload {
  sub: string;
  username: string;
  iat: number;
  exp: number;
}

/** base64url only: no `+`, no `/`, no `=` padding. */
const B64URL_ONLY = /^[A-Za-z0-9_-]+$/;

function encodeSegment(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function hmac(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function signAdminToken(
  claims: { sub: string; username: string },
  secret: string,
  ttlSeconds: number,
  now: number = nowSeconds(),
): string {
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeSegment({
    sub: claims.sub,
    username: claims.username,
    iat: now,
    exp: now + ttlSeconds,
  });
  const signature = hmac(`${header}.${payload}`, secret).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

export function verifyAdminToken(
  token: string,
  secret: string,
  now: number = nowSeconds(),
): AdminJwtPayload | null {
  if (typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!parts.every((part) => B64URL_ONLY.test(part))) return null;

  let header: any;
  let payload: any;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return null;

  // Hard equality, not a lookup table. "none" and "RS256" must never reach the
  // signature comparison below.
  if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

  // HMAC over the bytes as they arrived. Re-serialising the parsed JSON would
  // let a payload differing only in key order or whitespace verify.
  const expected = hmac(`${headerB64}.${payloadB64}`, secret);
  const actual = Buffer.from(signatureB64, 'base64url');
  // timingSafeEqual throws when lengths differ, so this check comes first.
  if (actual.length !== expected.length) return null;
  if (!timingSafeEqual(actual, expected)) return null;

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  if (typeof payload.username !== 'string' || payload.username.length === 0) return null;
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
  // A token without a usable exp is rejected, never treated as eternal.
  if (payload.exp <= now) return null;

  return { sub: payload.sub, username: payload.username, iat: payload.iat, exp: payload.exp };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- jwt.spec`
Expected: PASS (all 14 tests)

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/admin/auth/jwt.ts BE/src/modules/admin/auth/__tests__/jwt.spec.ts
git commit -m "feat(admin): HS256 sign/verify, with every rejection path under test"
```

---

## Task BE-4: Login throttle

**Files:**
- Create: `BE/src/modules/admin/auth/login-throttle.ts`
- Test: `BE/src/modules/admin/auth/__tests__/login-throttle.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ThrottleDecision { allowed: boolean; retryAfterSeconds: number }`
  - `class LoginThrottle` with constructor `(maxFailures?: number, windowMs?: number, clock?: () => number)` — defaults `10`, `900_000`, `Date.now`
  - `check(username: string): ThrottleDecision`
  - `recordFailure(username: string): void`
  - `recordSuccess(username: string): void`

- [ ] **Step 1: Write the failing test**

Create `BE/src/modules/admin/auth/__tests__/login-throttle.spec.ts`:

```typescript
import { LoginThrottle } from '../login-throttle';

/** A hand-cranked clock, so no test ever waits on a real 15-minute window. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

const WINDOW = 15 * 60 * 1000;

describe('LoginThrottle', () => {
  it('allows the first attempt for an unseen username', () => {
    const throttle = new LoginThrottle();
    expect(throttle.check('thang')).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('allows up to 10 failures and blocks the 11th attempt', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(10, WINDOW, clock.now);

    for (let i = 0; i < 10; i++) {
      expect(throttle.check('thang').allowed).toBe(true);
      throttle.recordFailure('thang');
    }

    const decision = throttle.check('thang');
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it('reports a shrinking retry_after as the window drains', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(1, WINDOW, clock.now);
    throttle.recordFailure('thang');
    clock.advance(60_000);
    expect(throttle.check('thang').retryAfterSeconds).toBe(840);
  });

  it('clears the count on a successful login', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(2, WINDOW, clock.now);
    throttle.recordFailure('thang');
    throttle.recordFailure('thang');
    expect(throttle.check('thang').allowed).toBe(false);

    throttle.recordSuccess('thang');
    expect(throttle.check('thang')).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('reopens once the window has fully elapsed', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(1, WINDOW, clock.now);
    throttle.recordFailure('thang');
    expect(throttle.check('thang').allowed).toBe(false);

    clock.advance(WINDOW);
    expect(throttle.check('thang').allowed).toBe(true);
  });

  it('counts usernames independently and case-insensitively', () => {
    const clock = fakeClock();
    const throttle = new LoginThrottle(1, WINDOW, clock.now);
    throttle.recordFailure('thang');

    expect(throttle.check('thang').allowed).toBe(false);
    // Same account, different spelling -- must not reset the counter.
    expect(throttle.check('  THANG ').allowed).toBe(false);
    expect(throttle.check('someone-else').allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- login-throttle.spec`
Expected: FAIL — `Cannot find module '../login-throttle'`

- [ ] **Step 3: Write minimal implementation**

Create `BE/src/modules/admin/auth/login-throttle.ts`:

```typescript
export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

const DEFAULT_MAX_FAILURES = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

interface Entry {
  count: number;
  firstAt: number;
}

/**
 * Keyed by username rather than IP: the BE sits behind Cloudflare Tunnel and
 * nginx, so req.ip is the proxy's and a per-IP limit would be a global one --
 * one attacker would lock out the real admin.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, Entry>();

  constructor(
    private readonly maxFailures: number = DEFAULT_MAX_FAILURES,
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
    private readonly clock: () => number = Date.now,
  ) {}

  private key(username: string): string {
    return String(username ?? '').trim().toLowerCase();
  }

  check(username: string): ThrottleDecision {
    const key = this.key(username);
    const entry = this.failures.get(key);
    if (!entry) return { allowed: true, retryAfterSeconds: 0 };

    const elapsed = this.clock() - entry.firstAt;
    if (elapsed >= this.windowMs) {
      this.failures.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (entry.count < this.maxFailures) return { allowed: true, retryAfterSeconds: 0 };

    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((this.windowMs - elapsed) / 1000),
    };
  }

  recordFailure(username: string): void {
    const key = this.key(username);
    const entry = this.failures.get(key);
    const now = this.clock();
    if (!entry || now - entry.firstAt >= this.windowMs) {
      this.failures.set(key, { count: 1, firstAt: now });
      return;
    }
    entry.count += 1;
  }

  recordSuccess(username: string): void {
    this.failures.delete(this.key(username));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- login-throttle.spec`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/admin/auth/login-throttle.ts BE/src/modules/admin/auth/__tests__/login-throttle.spec.ts
git commit -m "feat(admin): per-username login throttle with an injectable clock"
```

---

## Task BE-5: AdminUser entity and boot-time config validation

**Files:**
- Create: `BE/src/modules/admin/entities/admin-user.entity.ts`
- Create: `BE/src/modules/admin/admin.config.ts`
- Create: `BE/src/modules/admin/__tests__/admin.config.spec.ts`
- Create: `BE/src/test-setup.ts`
- Modify: `BE/src/common/__tests__/test-db.ts:20`
- Modify: `BE/package.json` (jest `setupFiles`)
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class AdminUser` — columns `adminId`, `username`, `passwordHash`, `createdAt?`, `lastLoginAt?`
  - `readAdminConfig(env: NodeJS.ProcessEnv): { secret: string; ttlSeconds: number }` — throws on invalid input
  - default export: a `registerAs('admin', ...)` config factory, so `ConfigService.get('admin.secret')` and `ConfigService.get('admin.ttlSeconds')` work
  - `MIN_SECRET_LENGTH = 32`

- [ ] **Step 1: Write the failing test**

Create `BE/src/modules/admin/__tests__/admin.config.spec.ts`:

```typescript
import { readAdminConfig, MIN_SECRET_LENGTH } from '../admin.config';

const validSecret = 'x'.repeat(MIN_SECRET_LENGTH);

describe('readAdminConfig', () => {
  it('accepts a long enough secret and defaults the TTL to 8 hours', () => {
    expect(readAdminConfig({ ADMIN_JWT_SECRET: validSecret } as any)).toEqual({
      secret: validSecret,
      ttlSeconds: 28800,
    });
  });

  it('reads an explicit TTL', () => {
    const config = readAdminConfig({ ADMIN_JWT_SECRET: validSecret, ADMIN_JWT_TTL_SECONDS: '3600' } as any);
    expect(config.ttlSeconds).toBe(3600);
  });

  it('throws when the secret is missing', () => {
    // A default secret is exactly how forgeable admin tokens happen, so this
    // has to be fatal rather than a warning.
    expect(() => readAdminConfig({} as any)).toThrow(/ADMIN_JWT_SECRET/);
  });

  it('throws when the secret is too short, and never echoes it', () => {
    const short = 'abc';
    try {
      readAdminConfig({ ADMIN_JWT_SECRET: short } as any);
      fail('expected a throw');
    } catch (err: any) {
      expect(err.message).toContain('ADMIN_JWT_SECRET');
      expect(err.message).toContain(String(MIN_SECRET_LENGTH));
      expect(err.message).not.toContain(short);
    }
  });

  it('throws on a non-numeric or non-positive TTL', () => {
    for (const bad of ['abc', '0', '-1', '1.5']) {
      expect(() => readAdminConfig({ ADMIN_JWT_SECRET: validSecret, ADMIN_JWT_TTL_SECONDS: bad } as any))
        .toThrow(/ADMIN_JWT_TTL_SECONDS/);
    }
  });
});
```

Also create `BE/src/modules/admin/__tests__/admin-user.entity.spec.ts`:

```typescript
import { AdminUser } from '../entities/admin-user.entity';
import { makeDataSource } from '../../../common/__tests__/test-db';

describe('AdminUser entity', () => {
  it('creates an admin_users table with a unique username', async () => {
    const ds = makeDataSource([AdminUser]);
    await ds.initialize();
    const repo = ds.getRepository(AdminUser);

    await repo.save(Object.assign(new AdminUser(), {
      adminId: 'a1', username: 'thang', passwordHash: 'scrypt$...',
    }));

    const found = await repo.findOne({ where: { username: 'thang' } });
    expect(found?.adminId).toBe('a1');
    expect(found?.createdAt).toBeTruthy();
    expect(found?.lastLoginAt ?? null).toBeNull();

    await expect(
      repo.insert(Object.assign(new AdminUser(), {
        adminId: 'a2', username: 'thang', passwordHash: 'scrypt$...',
      })),
    ).rejects.toThrow();

    await ds.destroy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- admin.config.spec admin-user.entity.spec`
Expected: FAIL — both modules missing.

- [ ] **Step 3: Write minimal implementation**

Create `BE/src/modules/admin/entities/admin-user.entity.ts`:

```typescript
import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

@Entity('admin_users')
export class AdminUser {
  @PrimaryColumn({ name: 'admin_id', type: 'text' })
  adminId!: string;

  @Index({ unique: true })
  @Column({ name: 'username', type: 'text', unique: true })
  username!: string;

  /** Format is owned by auth/password.ts: `scrypt$N$r$p$salt$hash`. */
  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ name: 'created_at', type: 'text', default: () => "datetime('now')" })
  createdAt?: string;

  /** The cheapest audit trail there is: a login nobody made shows up here. */
  @Column({ name: 'last_login_at', type: 'text', nullable: true })
  lastLoginAt?: string | null;
}
```

Create `BE/src/modules/admin/admin.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';

export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_TTL_SECONDS = 28800; // 8 hours

export interface AdminConfig {
  secret: string;
  ttlSeconds: number;
}

export function readAdminConfig(env: NodeJS.ProcessEnv): AdminConfig {
  const secret = env.ADMIN_JWT_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    // Never interpolate the value being rejected -- the message ends up in
    // logs and crash reports.
    throw new Error(
      `ADMIN_JWT_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }

  const raw = env.ADMIN_JWT_TTL_SECONDS;
  const ttlSeconds = raw === undefined || raw === '' ? DEFAULT_TTL_SECONDS : Number(raw);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('ADMIN_JWT_TTL_SECONDS must be a positive whole number of seconds');
  }

  return { secret, ttlSeconds };
}

export default registerAs('admin', (): AdminConfig => readAdminConfig(process.env));
```

Create `BE/src/test-setup.ts`:

```typescript
// AdminModule refuses to boot without a real secret. Tests that build the
// module need one; this keeps every spec file from repeating it.
process.env.ADMIN_JWT_SECRET =
  process.env.ADMIN_JWT_SECRET || 'test-only-admin-secret-at-least-32-chars-long';
```

In `BE/src/common/__tests__/test-db.ts`, add the import and extend the core entity list:

```typescript
import { AdminUser } from '../../modules/admin/entities/admin-user.entity';
```

```typescript
export async function openTestDataSources() {
  const core = makeDataSource([Tenant, ChildProfile, Feedback, AdminUser]);
  const local = makeDataSource([Story, StorySection, MemoryItem]);
  await core.initialize();
  await local.initialize();
  return { core, local };
}
```

In `BE/package.json`, add `setupFiles` to the `jest` block (keep every existing key):

```json
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "setupFiles": ["<rootDir>/test-setup.ts"],
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "collectCoverageFrom": ["**/*.(t|j)s"],
    "coverageDirectory": "../coverage",
    "testEnvironment": "node"
  }
```

Append to `.env.example`:

```bash
# --- Admin console ---
# Signs admin session tokens. Must be at least 32 characters; the BE refuses to
# start without it. There is deliberately no default -- a shared default secret
# is how forgeable admin tokens happen.
# Generate: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
ADMIN_JWT_SECRET=
# How long an admin stays logged in. Default 28800 (8 hours).
ADMIN_JWT_TTL_SECONDS=28800
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- admin.config.spec admin-user.entity.spec` → Expected: PASS
Run: `npm test` → Expected: all existing suites still PASS
Run: `npm run lint` → Expected: no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/admin/entities/admin-user.entity.ts BE/src/modules/admin/admin.config.ts \
        BE/src/modules/admin/__tests__/admin.config.spec.ts BE/src/modules/admin/__tests__/admin-user.entity.spec.ts \
        BE/src/test-setup.ts BE/src/common/__tests__/test-db.ts BE/package.json .env.example
git commit -m "feat(admin): admin_users table, and a secret the BE refuses to boot without"
```

---

## Task BE-6: AdminGuard

**Files:**
- Create: `BE/src/modules/admin/auth/admin.guard.ts`
- Test: `BE/src/modules/admin/auth/__tests__/admin.guard.spec.ts`

**Interfaces:**
- Consumes: `verifyAdminToken`, `signAdminToken` (BE-3); `ConfigService.get('admin.secret')` (BE-5).
- Produces:
  - `class AdminGuard implements CanActivate` — throws `UnauthorizedException` with `{ error: { code: 'UNAUTHORIZED', message: 'Phiên không hợp lệ hoặc đã hết hạn' } }`, otherwise sets `req.admin = { adminId, username }`
  - `extractBearer(header: string | undefined): string | null`

- [ ] **Step 1: Write the failing test**

Create `BE/src/modules/admin/auth/__tests__/admin.guard.spec.ts`:

```typescript
import { ExecutionContext } from '@nestjs/common';
import { AdminGuard, extractBearer } from '../admin.guard';
import { signAdminToken } from '../jwt';

const SECRET = 'g'.repeat(48);

const configStub = { get: (key: string) => (key === 'admin.secret' ? SECRET : undefined) } as any;

function contextFor(headers: Record<string, string>): { ctx: ExecutionContext; req: any } {
  const req: any = { headers };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as ExecutionContext;
  return { ctx, req };
}

describe('extractBearer', () => {
  it('pulls the token out of a well-formed header', () => {
    expect(extractBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepts any casing of the scheme', () => {
    expect(extractBearer('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearer('BEARER abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null for anything else', () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer('')).toBeNull();
    expect(extractBearer('Basic dXNlcjpwYXNz')).toBeNull();
    expect(extractBearer('Bearer')).toBeNull();
    expect(extractBearer('Bearer ')).toBeNull();
    expect(extractBearer('Bearer a b')).toBeNull();
  });
});

describe('AdminGuard', () => {
  const guard = new AdminGuard(configStub);

  it('attaches req.admin for a valid token', () => {
    const token = signAdminToken({ sub: 'admin-1', username: 'thang' }, SECRET, 3600);
    const { ctx, req } = contextFor({ authorization: `Bearer ${token}` });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.admin).toEqual({ adminId: 'admin-1', username: 'thang' });
  });

  it('rejects a missing header with the UNAUTHORIZED code', () => {
    const { ctx } = contextFor({});
    expect(() => guard.canActivate(ctx)).toThrow();
    try {
      guard.canActivate(ctx);
    } catch (err: any) {
      expect(err.getStatus()).toBe(401);
      expect(err.getResponse()).toEqual({
        error: { code: 'UNAUTHORIZED', message: 'Phiên không hợp lệ hoặc đã hết hạn' },
      });
    }
  });

  it('rejects a token signed with another secret', () => {
    const token = signAdminToken({ sub: 'admin-1', username: 'thang' }, 'z'.repeat(48), 3600);
    const { ctx } = contextFor({ authorization: `Bearer ${token}` });
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it('rejects an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = signAdminToken({ sub: 'admin-1', username: 'thang' }, SECRET, 3600, past);
    const { ctx } = contextFor({ authorization: `Bearer ${token}` });
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it('does not leak which failure occurred', () => {
    const cases = ['', 'Bearer nonsense', 'Basic abc'];
    const bodies = cases.map((authorization) => {
      try {
        guard.canActivate(contextFor(authorization ? { authorization } : {}).ctx);
        return null;
      } catch (err: any) {
        return err.getResponse();
      }
    });
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- admin.guard.spec`
Expected: FAIL — `Cannot find module '../admin.guard'`

- [ ] **Step 3: Write minimal implementation**

Create `BE/src/modules/admin/auth/admin.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyAdminToken } from './jwt';

export interface AdminPrincipal {
  adminId: string;
  username: string;
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2) return null;
  const [scheme, value] = parts;
  if (scheme.toLowerCase() !== 'bearer') return null;
  if (!value) return null;
  return value;
}

/**
 * One error body for every failure. Distinguishing "no header" from "expired"
 * from "bad signature" tells an attacker which half of the problem to work on.
 */
function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({
    error: { code: 'UNAUTHORIZED', message: 'Phiên không hợp lệ hoặc đã hết hạn' },
  });
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req: any = context.switchToHttp().getRequest();
    const token = extractBearer(req?.headers?.authorization);
    if (!token) throw unauthorized();

    const secret = this.config.get<string>('admin.secret');
    if (!secret) throw unauthorized();

    const payload = verifyAdminToken(token, secret);
    if (!payload) throw unauthorized();

    const principal: AdminPrincipal = { adminId: payload.sub, username: payload.username };
    req.admin = principal;
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- admin.guard.spec`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/admin/auth/admin.guard.ts BE/src/modules/admin/auth/__tests__/admin.guard.spec.ts
git commit -m "feat(admin): bearer guard with one indistinguishable failure body"
```

---

## Task BE-7: Login service and controller

**Files:**
- Create: `BE/src/modules/admin/dto/login.dto.ts`
- Create: `BE/src/modules/admin/admin-auth.service.ts`
- Create: `BE/src/modules/admin/admin-auth.controller.ts`
- Test: `BE/src/modules/admin/__tests__/admin-auth.service.spec.ts`

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword`/`dummyPasswordHash` (BE-2), `signAdminToken` (BE-3), `LoginThrottle` (BE-4), `AdminUser` (BE-5).
- Produces:
  - `class LoginDto { username: string; password: string }`
  - `interface LoginResult { token: string; expires_at: string; admin: { admin_id: string; username: string } }`
  - `AdminAuthService.login(username: string, password: string, requestId?: string): Promise<LoginResult>`
  - `AdminAuthController` mounted at `@Controller('admin')`, method `@Post('login')`

- [ ] **Step 1: Write the failing test**

Create `BE/src/modules/admin/__tests__/admin-auth.service.spec.ts`:

```typescript
import { DataSource } from 'typeorm';
import { AdminUser } from '../entities/admin-user.entity';
import { AdminAuthService } from '../admin-auth.service';
import { hashPassword } from '../auth/password';
import { verifyAdminToken } from '../auth/jwt';
import { makeDataSource } from '../../../common/__tests__/test-db';

jest.setTimeout(60_000);

const SECRET = 's'.repeat(48);
const configStub = {
  get: (key: string) => ({ 'admin.secret': SECRET, 'admin.ttlSeconds': 3600 } as any)[key],
} as any;

describe('AdminAuthService.login', () => {
  let ds: DataSource;
  let service: AdminAuthService;

  beforeEach(async () => {
    ds = makeDataSource([AdminUser]);
    await ds.initialize();
    await ds.getRepository(AdminUser).save(Object.assign(new AdminUser(), {
      adminId: 'admin-1',
      username: 'thang',
      passwordHash: await hashPassword('correct-password-1'),
    }));
    service = new AdminAuthService(ds, configStub);
  });

  afterEach(async () => { await ds.destroy(); });

  it('returns a verifiable token for the right credentials', async () => {
    const result = await service.login('thang', 'correct-password-1');

    expect(result.admin).toEqual({ admin_id: 'admin-1', username: 'thang' });
    expect(Date.parse(result.expires_at)).toBeGreaterThan(Date.now());

    const payload = verifyAdminToken(result.token, SECRET);
    expect(payload).toMatchObject({ sub: 'admin-1', username: 'thang' });
  });

  it('records last_login_at on success', async () => {
    await service.login('thang', 'correct-password-1');
    const row = await ds.getRepository(AdminUser).findOne({ where: { adminId: 'admin-1' } });
    expect(row?.lastLoginAt).toBeTruthy();
  });

  it('answers identically for a wrong password and an unknown username', async () => {
    const wrong = await service.login('thang', 'wrong-password-xx').catch((e) => e);
    const unknown = await service.login('nobody', 'wrong-password-xx').catch((e) => e);

    expect(wrong.getStatus()).toBe(401);
    expect(unknown.getStatus()).toBe(401);
    // Byte-identical bodies: anything else is a username oracle.
    expect(wrong.getResponse()).toEqual(unknown.getResponse());
    expect(wrong.getResponse()).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Sai tài khoản hoặc mật khẩu' },
    });
  });

  it('throttles after 10 failures and reports retry_after', async () => {
    for (let i = 0; i < 10; i++) {
      await service.login('thang', 'wrong-password-xx').catch(() => undefined);
    }
    const err = await service.login('thang', 'correct-password-1').catch((e) => e);

    expect(err.getStatus()).toBe(429);
    const body = err.getResponse();
    expect(body.error.code).toBe('LOGIN_THROTTLED');
    expect(body.error.retry_after).toBeGreaterThan(0);
  });

  it('clears the failure count after a successful login', async () => {
    for (let i = 0; i < 9; i++) {
      await service.login('thang', 'wrong-password-xx').catch(() => undefined);
    }
    await service.login('thang', 'correct-password-1');

    for (let i = 0; i < 9; i++) {
      const err = await service.login('thang', 'wrong-password-xx').catch((e) => e);
      expect(err.getStatus()).toBe(401);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- admin-auth.service.spec`
Expected: FAIL — `Cannot find module '../admin-auth.service'`

- [ ] **Step 3: Write minimal implementation**

Create `BE/src/modules/admin/dto/login.dto.ts`:

```typescript
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username!: string;

  /**
   * Deliberately no MinLength here. A length rule on the login form only tells
   * an attacker the shape of valid passwords, and the rejected value would ride
   * back in the 422 body if ValidationPipe's redaction ever regressed. Length
   * is enforced where passwords are set: scripts/create-admin.ts.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}
```

Create `BE/src/modules/admin/admin-auth.service.ts`:

```typescript
import { HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AdminUser } from './entities/admin-user.entity';
import { dummyPasswordHash, verifyPassword } from './auth/password';
import { signAdminToken } from './auth/jwt';
import { LoginThrottle } from './auth/login-throttle';

export interface LoginResult {
  token: string;
  expires_at: string;
  admin: { admin_id: string; username: string };
}

@Injectable()
export class AdminAuthService {
  private readonly repo: Repository<AdminUser>;
  private readonly throttle = new LoginThrottle();
  private readonly logger = new Logger('AdminAuth');

  constructor(
    @InjectDataSource('core') dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.repo = dataSource.getRepository(AdminUser);
  }

  async login(username: string, password: string, requestId?: string): Promise<LoginResult> {
    const decision = this.throttle.check(username);
    if (!decision.allowed) {
      throw new HttpException(
        {
          error: {
            code: 'LOGIN_THROTTLED',
            message: 'Sai quá nhiều lần. Vui lòng thử lại sau.',
            retry_after: decision.retryAfterSeconds,
          },
        },
        429,
      );
    }

    const admin = await this.repo.findOne({ where: { username } });

    // An unknown username still pays for one scrypt run, so response latency
    // cannot be used to tell which usernames exist.
    const storedHash = admin ? admin.passwordHash : await dummyPasswordHash();
    const passwordOk = await verifyPassword(password, storedHash);

    if (!admin || !passwordOk) {
      this.throttle.recordFailure(username);
      this.logger.warn(
        JSON.stringify({
          event: 'admin_login_failed',
          username,
          request_id: requestId ?? 'unknown',
        }),
      );
      throw new UnauthorizedException({
        error: { code: 'INVALID_CREDENTIALS', message: 'Sai tài khoản hoặc mật khẩu' },
      });
    }

    this.throttle.recordSuccess(username);
    await this.repo.update({ adminId: admin.adminId }, { lastLoginAt: new Date().toISOString() });

    const secret = this.config.get<string>('admin.secret')!;
    const ttlSeconds = this.config.get<number>('admin.ttlSeconds')!;
    const token = signAdminToken({ sub: admin.adminId, username: admin.username }, secret, ttlSeconds);

    return {
      token,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      admin: { admin_id: admin.adminId, username: admin.username },
    };
  }
}
```

Create `BE/src/modules/admin/admin-auth.controller.ts`:

```typescript
import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AdminAuthService, LoginResult } from './admin-auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('admin')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request): Promise<LoginResult> {
    return this.authService.login(dto.username, dto.password, (req as any).requestId);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- admin-auth.service.spec`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/admin/dto/login.dto.ts BE/src/modules/admin/admin-auth.service.ts \
        BE/src/modules/admin/admin-auth.controller.ts BE/src/modules/admin/__tests__/admin-auth.service.spec.ts
git commit -m "feat(admin): login that answers the same for a bad password and a bad username"
```

---

## Task BE-8: Feedback listing service and controller

**Files:**
- Create: `BE/src/modules/admin/dto/list-feedback.dto.ts`
- Create: `BE/src/modules/admin/admin-feedback.service.ts`
- Create: `BE/src/modules/admin/admin-feedback.controller.ts`
- Test: `BE/src/modules/admin/__tests__/admin-feedback.service.spec.ts`

**Interfaces:**
- Consumes: `Feedback`, `ChildProfile`, `Story` entities; `PaginatedResponse<T>` from `common/dto/pagination.dto`; `AdminGuard` (BE-6).
- Produces:
  - `class ListFeedbackDto { limit?: number; offset?: number; rating?: number; has_note?: number; from?: string; to?: string }`
  - `interface AdminFeedbackItem` — see the shape in Step 3
  - `AdminFeedbackService.list(query: ListFeedbackDto): Promise<PaginatedResponse<AdminFeedbackItem>>`
  - `AdminFeedbackController` at `@Controller('admin')`, method `@Get('feedbacks')`, `@UseGuards(AdminGuard)`

- [ ] **Step 1: Write the failing test**

Create `BE/src/modules/admin/__tests__/admin-feedback.service.spec.ts`:

```typescript
import { DataSource } from 'typeorm';
import { AdminFeedbackService } from '../admin-feedback.service';
import { Feedback } from '../../feedback/entities/feedback.entity';
import { ChildProfile } from '../../child/entities/child-profile.entity';
import { Story } from '../../story/entities/story.entity';
import { StorySection } from '../../story/entities/story-section.entity';
import { Tenant } from '../../tenant/entities/tenant.entity';
import { makeDataSource } from '../../../common/__tests__/test-db';

async function seed(core: DataSource, local: DataSource) {
  await core.getRepository(ChildProfile).save([
    Object.assign(new ChildProfile(), { childId: 'c1', tenantId: 't1', childName: 'Bống', age: 4, language: 'vi', isActive: 1 }),
  ]);
  await local.getRepository(Story).save([
    Object.assign(new Story(), { storyId: 's1', tenantId: 't1', title: 'Chú thỏ ngủ quên', content: '[]', theme: 'động vật', language: 'vi', safetyStatus: 'APPROVED', llmCalls: 0, retryCount: 0, isFallback: 0, isSaved: 0 }),
  ]);
  // Six rows across three days, one of them pointing at a story that does not
  // exist in local.db and has no child.
  const rows = [
    { feedbackId: 'f1', storyId: 's1', childId: 'c1', rating: 5, note: 'bé thích lắm',  createdAt: '2026-08-01 08:00:00' },
    { feedbackId: 'f2', storyId: 's1', childId: 'c1', rating: 3, note: null,            createdAt: '2026-08-02 08:00:00' },
    { feedbackId: 'f3', storyId: 's1', childId: 'c1', rating: 5, note: '',              createdAt: '2026-08-03 08:00:00' },
    { feedbackId: 'f4', storyId: 's1', childId: 'c1', rating: 1, note: 'dài quá',       createdAt: '2026-08-03 23:59:59' },
    { feedbackId: 'f5', storyId: 'gone', childId: null, rating: 4, note: 'ổn',          createdAt: '2026-08-04 08:00:00' },
    { feedbackId: 'f6', storyId: 's1', childId: 'c1', rating: 2, note: 'hơi buồn',      createdAt: '2026-08-05 08:00:00' },
  ];
  await core.getRepository(Feedback).save(
    rows.map((r) => Object.assign(new Feedback(), { tenantId: 't1', ...r })),
  );
}

describe('AdminFeedbackService.list', () => {
  let core: DataSource;
  let local: DataSource;
  let service: AdminFeedbackService;

  beforeEach(async () => {
    core = makeDataSource([Tenant, ChildProfile, Feedback]);
    local = makeDataSource([Story, StorySection]);
    await core.initialize();
    await local.initialize();
    await seed(core, local);
    service = new AdminFeedbackService(core, local);
  });

  afterEach(async () => { await core.destroy(); await local.destroy(); });

  it('returns newest first with total, limit and offset', async () => {
    const page = await service.list({});
    expect(page.total).toBe(6);
    expect(page.limit).toBe(20);
    expect(page.offset).toBe(0);
    expect(page.items.map((i) => i.feedback_id)).toEqual(['f6', 'f5', 'f4', 'f3', 'f2', 'f1']);
  });

  it('joins the child name and story title', async () => {
    const page = await service.list({});
    const f1 = page.items.find((i) => i.feedback_id === 'f1')!;
    expect(f1.child_name).toBe('Bống');
    expect(f1.story_title).toBe('Chú thỏ ngủ quên');
  });

  it('returns nulls rather than failing when the story or child is gone', async () => {
    const page = await service.list({});
    const f5 = page.items.find((i) => i.feedback_id === 'f5')!;
    expect(f5.story_title).toBeNull();
    expect(f5.child_name).toBeNull();
  });

  it('filters by exact rating', async () => {
    const page = await service.list({ rating: 5 });
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.feedback_id).sort()).toEqual(['f1', 'f3']);
  });

  it('treats an empty-string note as no note for has_note', async () => {
    const withNote = await service.list({ has_note: 1 });
    expect(withNote.items.map((i) => i.feedback_id).sort()).toEqual(['f1', 'f4', 'f5', 'f6']);

    const withoutNote = await service.list({ has_note: 0 });
    expect(withoutNote.items.map((i) => i.feedback_id).sort()).toEqual(['f2', 'f3']);
  });

  it('filters by date range inclusive of both ends', async () => {
    const page = await service.list({ from: '2026-08-02', to: '2026-08-03' });
    // f4 sits at 23:59:59 on the `to` day and must be inside the range.
    expect(page.items.map((i) => i.feedback_id).sort()).toEqual(['f2', 'f3', 'f4']);
  });

  it('combines filters', async () => {
    const page = await service.list({ rating: 5, from: '2026-08-03' });
    expect(page.items.map((i) => i.feedback_id)).toEqual(['f3']);
  });

  it('paginates without overlap and with a stable total', async () => {
    const first = await service.list({ limit: 2, offset: 0 });
    const second = await service.list({ limit: 2, offset: 2 });

    expect(first.total).toBe(6);
    expect(second.total).toBe(6);
    expect(first.items.map((i) => i.feedback_id)).toEqual(['f6', 'f5']);
    expect(second.items.map((i) => i.feedback_id)).toEqual(['f4', 'f3']);
  });

  it('clamps an oversized limit to 100 instead of rejecting it', async () => {
    const page = await service.list({ limit: 500 });
    expect(page.limit).toBe(100);
    expect(page.items).toHaveLength(6);
  });

  it('returns an empty page rather than an error when nothing matches', async () => {
    const page = await service.list({ rating: 5, from: '2026-09-01' });
    expect(page).toEqual({ items: [], total: 0, limit: 20, offset: 0 });
  });

  it('degrades to null titles when the local DB query fails', async () => {
    await local.destroy();
    const page = await service.list({});
    // Feedback lives in core.db; a broken local.db must not kill the page.
    expect(page.total).toBe(6);
    expect(page.items.every((i) => i.story_title === null)).toBe(true);
    local = makeDataSource([Story, StorySection]);
    await local.initialize();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- admin-feedback.service.spec`
Expected: FAIL — `Cannot find module '../admin-feedback.service'`

- [ ] **Step 3: Write minimal implementation**

Create `BE/src/modules/admin/dto/list-feedback.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class ListFeedbackDto {
  /**
   * No @Max here on purpose: an oversized limit is clamped in the service
   * rather than rejected. A console that asks for 500 rows should get 100, not
   * a 422.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1)
  has_note?: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
```

Create `BE/src/modules/admin/admin-feedback.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual, Raw } from 'typeorm';
import { Feedback } from '../feedback/entities/feedback.entity';
import { ChildProfile } from '../child/entities/child-profile.entity';
import { Story } from '../story/entities/story.entity';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { ListFeedbackDto } from './dto/list-feedback.dto';

export interface AdminFeedbackItem {
  feedback_id: string;
  created_at: string | null;
  rating: number | null;
  listened_complete: number | null;
  wants_more: number | null;
  suitable: number | null;
  note: string | null;
  story_id: string;
  story_title: string | null;
  child_name: string | null;
  tenant_id: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class AdminFeedbackService {
  private readonly logger = new Logger('AdminFeedback');

  constructor(
    @InjectDataSource('core') private readonly core: DataSource,
    @InjectDataSource('local') private readonly local: DataSource,
  ) {}

  async list(query: ListFeedbackDto): Promise<PaginatedResponse<AdminFeedbackItem>> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = query.offset ?? 0;

    const [rows, total] = await this.core.getRepository(Feedback).findAndCount({
      where: this.buildWhere(query),
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    // core.db and local.db are separate SQLite files, so the story title cannot
    // be joined in SQL. Two extra lookups scoped to this page keep it at three
    // queries total, not N+1.
    const childNames = await this.lookupChildNames(rows);
    const storyTitles = await this.lookupStoryTitles(rows);

    return {
      items: rows.map((row) => ({
        feedback_id: row.feedbackId,
        created_at: row.createdAt ?? null,
        rating: row.rating ?? null,
        listened_complete: row.listenedComplete ?? null,
        wants_more: row.wantsMore ?? null,
        suitable: row.suitable ?? null,
        note: row.note ?? null,
        story_id: row.storyId,
        story_title: storyTitles.get(row.storyId) ?? null,
        child_name: row.childId ? childNames.get(row.childId) ?? null : null,
        tenant_id: row.tenantId,
      })),
      total,
      limit,
      offset,
    };
  }

  private buildWhere(query: ListFeedbackDto): FindOptionsWhere<Feedback> {
    const where: FindOptionsWhere<Feedback> = {};

    if (query.rating !== undefined) where.rating = query.rating;

    if (query.has_note === 1) {
      // A submitted-but-blank note is not a note.
      where.note = Raw((alias) => `${alias} IS NOT NULL AND ${alias} != ''`);
    } else if (query.has_note === 0) {
      where.note = Raw((alias) => `${alias} IS NULL OR ${alias} = ''`);
    }

    // created_at is SQLite's `datetime('now')` -- 'YYYY-MM-DD HH:MM:SS' in UTC,
    // which compares correctly as a string.
    if (query.from && query.to) {
      where.createdAt = Raw(
        (alias) => `${alias} >= :from AND ${alias} <= :to`,
        { from: `${query.from} 00:00:00`, to: `${query.to} 23:59:59` },
      );
    } else if (query.from) {
      where.createdAt = MoreThanOrEqual(`${query.from} 00:00:00`);
    } else if (query.to) {
      where.createdAt = LessThanOrEqual(`${query.to} 23:59:59`);
    }

    return where;
  }

  private async lookupChildNames(rows: Feedback[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.childId).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const children = await this.core.getRepository(ChildProfile).find({
      where: { childId: In(ids) },
      select: ['childId', 'childName'],
    });
    return new Map(children.map((c) => [c.childId, c.childName]));
  }

  private async lookupStoryTitles(rows: Feedback[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.storyId).filter(Boolean))];
    if (ids.length === 0) return new Map();
    try {
      const stories = await this.local.getRepository(Story).find({
        where: { storyId: In(ids) },
        select: ['storyId', 'title'],
      });
      return new Map(stories.map((s) => [s.storyId, s.title]));
    } catch (err) {
      // The feedback itself lives in core.db. A broken local.db costs titles,
      // not the whole page.
      this.logger.warn(
        JSON.stringify({ event: 'admin_story_title_lookup_failed', count: ids.length }),
      );
      return new Map();
    }
  }
}
```

Create `BE/src/modules/admin/admin-feedback.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from './auth/admin.guard';
import { AdminFeedbackService, AdminFeedbackItem } from './admin-feedback.service';
import { ListFeedbackDto } from './dto/list-feedback.dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminFeedbackController {
  constructor(private readonly feedbackService: AdminFeedbackService) {}

  @Get('feedbacks')
  async list(@Query() query: ListFeedbackDto): Promise<PaginatedResponse<AdminFeedbackItem>> {
    return this.feedbackService.list(query);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- admin-feedback.service.spec`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/admin/dto/list-feedback.dto.ts BE/src/modules/admin/admin-feedback.service.ts \
        BE/src/modules/admin/admin-feedback.controller.ts BE/src/modules/admin/__tests__/admin-feedback.service.spec.ts
git commit -m "feat(admin): paginated feedback read across both SQLite files"
```

---

## Task BE-9: Wire the module, exclude /admin from the tenant middleware

The regression test in this task is the one that matters most: `/admin/*` must never mint a tenant.

**Files:**
- Create: `BE/src/modules/admin/admin.module.ts`
- Create: `BE/src/modules/admin/__tests__/admin.integration.spec.ts`
- Modify: `BE/src/app.module.ts`

**Interfaces:**
- Consumes: everything from BE-5 through BE-8.
- Produces: `AdminModule`, and the live routes `POST /admin/login` and `GET /admin/feedbacks`.

- [ ] **Step 1: Write the failing test**

Create `BE/src/modules/admin/__tests__/admin.integration.spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from '../admin.module';
import { AdminUser } from '../entities/admin-user.entity';
import { hashPassword } from '../auth/password';
import { Feedback } from '../../feedback/entities/feedback.entity';
import { ChildProfile } from '../../child/entities/child-profile.entity';
import { Tenant } from '../../tenant/entities/tenant.entity';
import { Story } from '../../story/entities/story.entity';
import { StorySection } from '../../story/entities/story-section.entity';
import { MemoryItem } from '../../memory/entities/memory-item.entity';
import { makeDataSource } from '../../../common/__tests__/test-db';
import { HttpExceptionFilter } from '../../../common/filters/http-exception.filter';
import { ValidationPipe } from '../../../common/pipes/validation.pipe';
import adminConfig from '../admin.config';

jest.setTimeout(60_000);

describe('Admin API', () => {
  let app: INestApplication;
  let core: DataSource;
  let local: DataSource;

  beforeAll(async () => {
    core = makeDataSource([Tenant, ChildProfile, Feedback, AdminUser]);
    local = makeDataSource([Story, StorySection, MemoryItem]);
    await core.initialize();
    await local.initialize();

    await core.getRepository(AdminUser).save(Object.assign(new AdminUser(), {
      adminId: 'admin-1',
      username: 'thang',
      passwordHash: await hashPassword('integration-password-1'),
    }));
    await core.getRepository(Feedback).save(Object.assign(new Feedback(), {
      feedbackId: 'f1', tenantId: 't1', storyId: 's1', rating: 5, note: 'tuyệt',
      createdAt: '2026-08-01 08:00:00',
    }));

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [adminConfig] }), AdminModule],
    })
      .overrideProvider(getDataSourceToken('core')).useValue(core)
      .overrideProvider(getDataSourceToken('local')).useValue(local)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await core.destroy();
    await local.destroy();
  });

  async function login(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/admin/login')
      .send({ username: 'thang', password: 'integration-password-1' })
      .expect(201);
    return res.body.token;
  }

  it('returns a bare token object, not a { data } envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/login')
      .send({ username: 'thang', password: 'integration-password-1' })
      .expect(201);

    expect(res.body).not.toHaveProperty('data');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.admin).toEqual({ admin_id: 'admin-1', username: 'thang' });
  });

  it('rejects the wrong password with INVALID_CREDENTIALS', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/login')
      .send({ username: 'thang', password: 'definitely-wrong-1' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('never returns the submitted password in a validation error', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/login')
      .send({ username: 'thang', password: '' })
      .expect(422);
    expect(JSON.stringify(res.body)).not.toContain('"value"');
  });

  it('refuses GET /admin/feedbacks without a token', async () => {
    const res = await request(app.getHttpServer()).get('/admin/feedbacks').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('serves the feedback page with a token', async () => {
    const token = await login();
    const res = await request(app.getHttpServer())
      .get('/admin/feedbacks?limit=10')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).not.toHaveProperty('data');
    expect(res.body.total).toBe(1);
    expect(res.body.limit).toBe(10);
    expect(res.body.items[0].feedback_id).toBe('f1');
  });

  it('rejects a malformed query with VALIDATION_ERROR', async () => {
    const token = await login();
    const res = await request(app.getHttpServer())
      .get('/admin/feedbacks?rating=99')
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
```

Create `BE/src/common/__tests__/admin-tenant-isolation.spec.ts` — this one boots the real `AppModule` wiring so the middleware exclusion is what is under test:

```typescript
import { INestApplication, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from '../../modules/admin/admin.module';
import { TenantModule } from '../../modules/tenant/tenant.module';
import { AdminUser } from '../../modules/admin/entities/admin-user.entity';
import { Tenant } from '../../modules/tenant/entities/tenant.entity';
import { ChildProfile } from '../../modules/child/entities/child-profile.entity';
import { Feedback } from '../../modules/feedback/entities/feedback.entity';
import { Story } from '../../modules/story/entities/story.entity';
import { StorySection } from '../../modules/story/entities/story-section.entity';
import { MemoryItem } from '../../modules/memory/entities/memory-item.entity';
import { TenantMiddleware } from '../middleware/tenant.middleware';
import { makeDataSource } from './test-db';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import adminConfig from '../../modules/admin/admin.config';

jest.setTimeout(60_000);

// Mirrors AppModule.configure() exactly. If the exclusion pattern there
// changes, this copy must change with it -- which is the point.
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [adminConfig] }), TenantModule, AdminModule],
})
class HarnessModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).exclude('health', 'admin/(.*)').forRoutes('*');
  }
}

describe('/admin never mints a tenant', () => {
  let app: INestApplication;
  let core: DataSource;
  let local: DataSource;

  beforeAll(async () => {
    core = makeDataSource([Tenant, ChildProfile, Feedback, AdminUser]);
    local = makeDataSource([Story, StorySection, MemoryItem]);
    await core.initialize();
    await local.initialize();

    const moduleRef = await Test.createTestingModule({ imports: [HarnessModule] })
      .overrideProvider(getDataSourceToken('core')).useValue(core)
      .overrideProvider(getDataSourceToken('local')).useValue(local)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await core.destroy();
    await local.destroy();
  });

  it('leaves the tenants table untouched across admin requests', async () => {
    const repo = core.getRepository(Tenant);
    const before = await repo.count();

    await request(app.getHttpServer()).get('/admin/feedbacks').expect(401);
    await request(app.getHttpServer())
      .post('/admin/login')
      .send({ username: 'nobody', password: 'nothing-at-all' });

    expect(await repo.count()).toBe(before);
  });

  it('proves the harness would otherwise create one', async () => {
    // A non-admin route with no X-Tenant-Id header still auto-creates, so the
    // assertion above is about the exclusion and not about a dead middleware.
    const repo = core.getRepository(Tenant);
    const before = await repo.count();
    await request(app.getHttpServer()).post('/tenant/init').expect(201);
    expect(await repo.count()).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- admin.integration.spec admin-tenant-isolation.spec`
Expected: FAIL — `Cannot find module '../admin.module'`

- [ ] **Step 3: Write minimal implementation**

Create `BE/src/modules/admin/admin.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminFeedbackController } from './admin-feedback.controller';
import { AdminFeedbackService } from './admin-feedback.service';
import { AdminGuard } from './auth/admin.guard';
import adminConfig from './admin.config';

@Module({
  imports: [ConfigModule.forFeature(adminConfig)],
  controllers: [AdminAuthController, AdminFeedbackController],
  providers: [AdminAuthService, AdminFeedbackService, AdminGuard],
})
export class AdminModule {}
```

In `BE/src/app.module.ts` make four edits.

Add imports near the other module imports:

```typescript
import { AdminModule } from './modules/admin/admin.module';
import { AdminUser } from './modules/admin/entities/admin-user.entity';
import adminConfig from './modules/admin/admin.config';
```

Add `adminConfig` to the `load` array:

```typescript
      load: [appConfig, memoryConfig, rateLimitConfig, adminConfig],
```

Add `AdminModule` to `imports`, after `EngineGatewayModule`:

```typescript
    EngineGatewayModule,
    AdminModule,
```

Add `AdminUser` to the `core` datasource entities:

```typescript
        entities: [Tenant, ChildProfile, Feedback, AdminUser],
```

Extend the middleware exclusion:

```typescript
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware, RateLimiterMiddleware)
      // /admin has no tenant. Without this the middleware would create one
      // anonymous tenant row per admin request.
      .exclude('health', 'admin/(.*)')
      .forRoutes('*');
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- admin.integration.spec admin-tenant-isolation.spec` → Expected: PASS
Run: `npm test` → Expected: every suite PASS
Run: `npm run lint` → Expected: no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/admin/admin.module.ts BE/src/app.module.ts \
        BE/src/modules/admin/__tests__/admin.integration.spec.ts \
        BE/src/common/__tests__/admin-tenant-isolation.spec.ts
git commit -m "feat(admin): mount /admin, and keep it out of the tenant middleware"
```

---

## Task BE-10: Seed CLI

**Files:**
- Create: `BE/scripts/create-admin.ts`
- Modify: `BE/package.json` (`admin:create` script)

**Interfaces:**
- Consumes: `hashPassword` (BE-2).
- Produces: `npm run admin:create -- --username <name>`, reading the password from `ADMIN_PASSWORD`.

There is no automated test here. The hashing it wraps is already covered by BE-2, and a test of the CLI would mostly be a test of `sqlite3`. Step 4 is a manual verification instead.

- [ ] **Step 1: Write the script**

Create `BE/scripts/create-admin.ts`:

```typescript
/**
 * Creates or resets an admin account.
 *
 *   ADMIN_PASSWORD='...' npm run admin:create -- --username thang
 *
 * The password comes from the environment rather than a --password flag so it
 * does not end up in shell history.
 */
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AdminUser } from '../src/modules/admin/entities/admin-user.entity';
import { hashPassword } from '../src/modules/admin/auth/password';

const MIN_PASSWORD_LENGTH = 12;

function readUsername(argv: string[]): string {
  const index = argv.indexOf('--username');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) {
    throw new Error('Usage: npm run admin:create -- --username <name>   (password from $ADMIN_PASSWORD)');
  }
  return value.trim();
}

function readPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error('ADMIN_PASSWORD is not set. Set it in the environment, not as a --password flag.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  return password;
}

async function main(): Promise<void> {
  const username = readUsername(process.argv);
  const password = readPassword();
  const database = process.env.CORE_DB_PATH || 'data/core.db';

  const ds = new DataSource({ type: 'sqlite', database, entities: [AdminUser] });
  await ds.initialize();

  // `synchronize` is only on for NODE_ENV=development (app.module.ts), so on a
  // production box this script is what brings the table into existence.
  await ds.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      admin_id      TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    )
  `);

  const repo = ds.getRepository(AdminUser);
  const passwordHash = await hashPassword(password);
  const existing = await repo.findOne({ where: { username } });

  if (existing) {
    await repo.update({ adminId: existing.adminId }, { passwordHash });
    console.log(`Password reset for admin "${username}" in ${database}.`);
  } else {
    await repo.insert({ adminId: randomUUID(), username, passwordHash });
    console.log(`Admin "${username}" created in ${database}.`);
  }

  await ds.destroy();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `BE/package.json`, add to `scripts`:

```json
    "admin:create": "ts-node -P tsconfig.json scripts/create-admin.ts",
```

- [ ] **Step 3: Verify the failure modes by hand**

Run each from `BE/` and confirm the message:

```powershell
npm run admin:create
# Expected: "Usage: npm run admin:create -- --username <name> ..." and exit code 1

npm run admin:create -- --username thang
# Expected: "ADMIN_PASSWORD is not set..." and exit code 1

$env:ADMIN_PASSWORD = 'short'; npm run admin:create -- --username thang
# Expected: "ADMIN_PASSWORD must be at least 12 characters." and exit code 1
```

- [ ] **Step 4: Verify the happy path and the reset path**

```powershell
$env:ADMIN_PASSWORD = 'a-real-admin-password'
npm run admin:create -- --username thang
# Expected: 'Admin "thang" created in data/core.db.'

npm run admin:create -- --username thang
# Expected: 'Password reset for admin "thang" in data/core.db.'

Remove-Item Env:\ADMIN_PASSWORD
```

Then confirm the account works end to end. In one terminal:

```powershell
$env:ADMIN_JWT_SECRET = 'local-dev-admin-secret-at-least-32-chars'
npm run start:dev
```

In another:

```powershell
curl.exe -s -X POST http://localhost:3001/admin/login -H "Content-Type: application/json" -d '{\"username\":\"thang\",\"password\":\"a-real-admin-password\"}'
# Expected: a JSON body containing "token", "expires_at" and "admin"
```

Also confirm the boot guard: unset `ADMIN_JWT_SECRET`, run `npm run start:dev`, and check the process exits with a message naming `ADMIN_JWT_SECRET` and not printing any secret value.

- [ ] **Step 5: Commit**

```bash
git add BE/scripts/create-admin.ts BE/package.json
git commit -m "feat(admin): seed CLI that creates or resets an admin, password from env"
```

---

## Task FE-1: adminSession

**Files:**
- Create: `FE/src/admin/types.ts`
- Create: `FE/src/admin/adminSession.ts`
- Test: `FE/src/admin/__tests__/adminSession.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ADMIN_TOKEN_KEY = 'bsc_admin_token'`
  - `getToken(): string | null` — returns `null` for a missing, malformed, or expired token
  - `setToken(token: string): void`
  - `clearToken(): void`
  - `readExpiry(token: string): number | null` — `exp` in seconds, or `null`
  - from `types.ts`: `AdminFeedbackItem`, `AdminFeedbackPage`, `LoginResponse`

- [ ] **Step 1: Write the failing test**

Create `FE/src/admin/__tests__/adminSession.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { ADMIN_TOKEN_KEY, clearToken, getToken, readExpiry, setToken } from '../adminSession';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Signature content is irrelevant here -- the BE is what verifies it. */
function tokenWithExp(expSeconds: number): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'a1', username: 'thang', iat: 0, exp: expSeconds })}.sig`;
}

describe('adminSession', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T12:00:00Z'));
  });

  afterEach(() => { vi.useRealTimers(); });

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it('round-trips a token that has not expired', () => {
    const token = tokenWithExp(nowSeconds() + 3600);
    setToken(token);
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBe(token);
    expect(getToken()).toBe(token);
  });

  it('returns null when nothing is stored', () => {
    expect(getToken()).toBeNull();
  });

  it('returns null and clears storage for an expired token', () => {
    setToken(tokenWithExp(nowSeconds() - 1));
    expect(getToken()).toBeNull();
    // Leaving a dead token behind would make every reload retry it.
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('returns null for a malformed token instead of throwing', () => {
    for (const bad of ['', 'garbage', 'a.b', 'a.b.c.d', 'a.!!!.c']) {
      localStorage.setItem(ADMIN_TOKEN_KEY, bad);
      expect(() => getToken()).not.toThrow();
      expect(getToken()).toBeNull();
    }
  });

  it('returns null for a token whose payload has no exp', () => {
    const noExp = `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang' })}.sig`;
    localStorage.setItem(ADMIN_TOKEN_KEY, noExp);
    expect(getToken()).toBeNull();
  });

  it('clearToken removes the key', () => {
    setToken(tokenWithExp(nowSeconds() + 3600));
    clearToken();
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('readExpiry returns the exp claim in seconds', () => {
    const exp = nowSeconds() + 120;
    expect(readExpiry(tokenWithExp(exp))).toBe(exp);
    expect(readExpiry('garbage')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- adminSession` (from `FE/`)
Expected: FAIL — cannot resolve `../adminSession`

- [ ] **Step 3: Write minimal implementation**

Create `FE/src/admin/types.ts`:

```typescript
export interface AdminFeedbackItem {
  feedback_id: string;
  /** SQLite format `YYYY-MM-DD HH:MM:SS` in UTC -- not ISO 8601. */
  created_at: string | null;
  rating: number | null;
  listened_complete: number | null;
  wants_more: number | null;
  suitable: number | null;
  note: string | null;
  story_id: string;
  /** null when the story is no longer in local.db. Not an error. */
  story_title: string | null;
  /** null when the feedback was not tied to a child. Not an error. */
  child_name: string | null;
  tenant_id: string;
}

export interface AdminFeedbackPage {
  items: AdminFeedbackItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface LoginResponse {
  token: string;
  expires_at: string;
  admin: { admin_id: string; username: string };
}

export interface FeedbackFilterState {
  rating: string;
  hasNote: string;
  from: string;
  to: string;
}
```

Create `FE/src/admin/adminSession.ts`:

```typescript
export const ADMIN_TOKEN_KEY = 'bsc_admin_token';

/**
 * Reads the `exp` claim without verifying the signature. This is only a way to
 * avoid firing a request that is certain to fail -- the BE is the authority on
 * whether a token is valid.
 */
export function readExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return typeof payload?.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) return null;

  const exp = readExpiry(token);
  if (exp === null || exp <= Math.floor(Date.now() / 1000)) {
    // Drop it now rather than retrying a dead token on every reload.
    clearToken();
    return null;
  }
  return token;
}

export function setToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- adminSession`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add FE/src/admin/types.ts FE/src/admin/adminSession.ts FE/src/admin/__tests__/adminSession.test.ts
git commit -m "feat(fe): admin session storage that drops dead tokens on read"
```

---

## Task FE-2: adminClient

The regression test here is the mirror of BE-9's tenant count: the admin client must never touch `/tenant/init`.

**Files:**
- Create: `FE/src/admin/adminClient.ts`
- Test: `FE/src/admin/__tests__/adminClient.test.ts`

**Interfaces:**
- Consumes: `getToken`/`clearToken` (FE-1), `ApiError` from `../utils/api`.
- Produces:
  - `adminLogin(username: string, password: string): Promise<LoginResponse>`
  - `fetchAdminFeedbacks(params: URLSearchParams): Promise<AdminFeedbackPage>`

- [ ] **Step 1: Write the failing test**

Create `FE/src/admin/__tests__/adminClient.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminLogin, fetchAdminFeedbacks } from '../adminClient';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import { ApiError } from '../../utils/api';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('adminClient', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('never bootstraps a tenant', async () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ items: [], total: 0, limit: 20, offset: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchAdminFeedbacks(new URLSearchParams({ limit: '20' }));

    // apiClient would have called POST /api/tenant/init first, minting an
    // anonymous tenant on every console load.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain('/tenant/init');
    expect(url).toBe('/api/admin/feedbacks?limit=20');
    expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBeUndefined();
  });

  it('sends the bearer token on feedback requests', async () => {
    const token = liveToken();
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ items: [], total: 0, limit: 20, offset: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchAdminFeedbacks(new URLSearchParams());

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('does not send an Authorization header on login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ token: 'tok', expires_at: 'x', admin: { admin_id: 'a1', username: 'thang' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await adminLogin('thang', 'pw');

    expect(result.token).toBe('tok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/login');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ username: 'thang', password: 'pw' });
  });

  it('throws UNAUTHORIZED and clears the token on a 401', async () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'hết hạn' } }, 401),
    ));

    await expect(fetchAdminFeedbacks(new URLSearchParams())).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('fails fast with UNAUTHORIZED when no token is stored', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAdminFeedbacks(new URLSearchParams())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the BE error code on a 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'LOGIN_THROTTLED', message: 'thử lại sau', retry_after: 840 } }, 429),
    ));

    const err = await adminLogin('thang', 'pw').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('LOGIN_THROTTLED');
    expect(err.status).toBe(429);
  });

  it('reports a transport failure as NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    const err = await adminLogin('thang', 'pw').catch((e) => e);
    expect(err.code).toBe('NETWORK_ERROR');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- adminClient`
Expected: FAIL — cannot resolve `../adminClient`

- [ ] **Step 3: Write minimal implementation**

Create `FE/src/admin/adminClient.ts`:

```typescript
import { ApiError } from '../utils/api';
import { clearToken, getToken } from './adminSession';
import type { AdminFeedbackPage, LoginResponse } from './types';

const API_BASE = import.meta.env.VITE_BE_URL || '/api';
const TIMEOUT_MS = 15_000;

/**
 * Deliberately not `apiClient` from utils/api: that one calls ensureTenantId(),
 * which POSTs /tenant/init and mints an anonymous tenant. The BE excludes
 * /admin from the tenant middleware for the same reason -- the console must not
 * create tenant rows just by being opened.
 */
async function adminFetch<T>(path: string, init: RequestInit, withAuth: boolean): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };

  if (withAuth) {
    const token = getToken();
    if (!token) {
      throw new ApiError('UNAUTHORIZED', 'Phiên đã hết hạn. Vui lòng đăng nhập lại.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'Quá thời gian chờ');
    }
    throw new ApiError('NETWORK_ERROR', 'Không kết nối được máy chủ');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    // One place handles expiry: screens only have to catch and redirect.
    clearToken();
    throw new ApiError('UNAUTHORIZED', 'Phiên không hợp lệ hoặc đã hết hạn', 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error?.code || 'API_ERROR', body?.error?.message, res.status);
  }

  return res.json() as Promise<T>;
}

export function adminLogin(username: string, password: string): Promise<LoginResponse> {
  return adminFetch<LoginResponse>(
    '/admin/login',
    { method: 'POST', body: JSON.stringify({ username, password }) },
    false,
  );
}

export function fetchAdminFeedbacks(params: URLSearchParams): Promise<AdminFeedbackPage> {
  const query = params.toString();
  return adminFetch<AdminFeedbackPage>(
    `/admin/feedbacks${query ? `?${query}` : ''}`,
    { method: 'GET' },
    true,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- adminClient`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add FE/src/admin/adminClient.ts FE/src/admin/__tests__/adminClient.test.ts
git commit -m "feat(fe): admin fetch client that never bootstraps a tenant"
```

---

## Task FE-3: Router, route guard, login screen

**Files:**
- Modify: `FE/package.json` (add `react-router-dom`)
- Modify: `FE/src/main.tsx`
- Create: `FE/src/admin/RequireAdmin.tsx`
- Create: `FE/src/admin/AdminLoginScreen.tsx`
- Create: `FE/src/admin/AdminApp.tsx`
- Test: `FE/src/admin/__tests__/AdminLoginScreen.test.tsx`
- Test: `FE/src/admin/__tests__/RequireAdmin.test.tsx`

**Interfaces:**
- Consumes: `adminLogin` (FE-2), `setToken`/`getToken` (FE-1).
- Produces:
  - `AdminLoginScreen` — default export, no props
  - `RequireAdmin` — default export, props `{ children: React.ReactNode }`
  - `AdminApp` — **default export** (required: `main.tsx` lazy-imports it)
  - Routes: `/admin/login`, `/admin/feedback`, `/admin` → redirect to `/admin/feedback`

`AdminFeedbackScreen` does not exist until FE-5. In this task `AdminApp` renders a placeholder for that route; FE-5 swaps it for the real screen.

- [ ] **Step 1: Install the router**

```bash
cd FE
npm install react-router-dom
```

- [ ] **Step 2: Write the failing tests**

Create `FE/src/admin/__tests__/AdminLoginScreen.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLoginScreen from '../AdminLoginScreen';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import { ApiError } from '../../utils/api';
import * as client from '../adminClient';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/admin/login']}>
      <Routes>
        <Route path="/admin/login" element={<AdminLoginScreen />} />
        <Route path="/admin/feedback" element={<p>FEEDBACK SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLoginScreen', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('stores the token and navigates on success', async () => {
    vi.spyOn(client, 'adminLogin').mockResolvedValue({
      token: 'tok-123', expires_at: 'x', admin: { admin_id: 'a1', username: 'thang' },
    });

    renderLogin();
    await userEvent.type(screen.getByLabelText(/tài khoản/i), 'thang');
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), 'my-password');
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    await waitFor(() => expect(screen.getByText('FEEDBACK SCREEN')).toBeInTheDocument());
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBe('tok-123');
  });

  it('shows the Vietnamese message for INVALID_CREDENTIALS', async () => {
    vi.spyOn(client, 'adminLogin').mockRejectedValue(new ApiError('INVALID_CREDENTIALS', undefined, 401));

    renderLogin();
    await userEvent.type(screen.getByLabelText(/tài khoản/i), 'thang');
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sai tài khoản hoặc mật khẩu');
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('shows a throttle message', async () => {
    vi.spyOn(client, 'adminLogin').mockRejectedValue(new ApiError('LOGIN_THROTTLED', undefined, 429));

    renderLogin();
    await userEvent.type(screen.getByLabelText(/tài khoản/i), 'thang');
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sai quá nhiều lần/i);
  });

  it('shows a connection message for a network failure', async () => {
    vi.spyOn(client, 'adminLogin').mockRejectedValue(new ApiError('NETWORK_ERROR'));

    renderLogin();
    await userEvent.type(screen.getByLabelText(/tài khoản/i), 'thang');
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/không kết nối được máy chủ/i);
  });

  it('disables the button while the request is in flight', async () => {
    let release!: () => void;
    vi.spyOn(client, 'adminLogin').mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ token: 't', expires_at: 'x', admin: { admin_id: 'a1', username: 'thang' } });
      }),
    );

    renderLogin();
    await userEvent.type(screen.getByLabelText(/tài khoản/i), 'thang');
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(screen.getByRole('button', { name: /đang đăng nhập/i })).toBeDisabled();
    release();
  });

  it('marks the password field as a current-password for password managers', () => {
    renderLogin();
    expect(screen.getByLabelText(/tài khoản/i)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/mật khẩu/i)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText(/mật khẩu/i)).toHaveAttribute('type', 'password');
  });
});
```

Create `FE/src/admin/__tests__/RequireAdmin.test.tsx`:

```tsx
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RequireAdmin from '../RequireAdmin';
import { ADMIN_TOKEN_KEY } from '../adminSession';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/admin/feedback']}>
      <Routes>
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
        <Route path="/admin/feedback" element={<RequireAdmin><p>SECRET</p></RequireAdmin>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAdmin', () => {
  beforeEach(() => { localStorage.clear(); });

  it('redirects to login when there is no token', () => {
    renderGuarded();
    expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument();
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
  });

  it('redirects to login when the token has expired', () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    localStorage.setItem(ADMIN_TOKEN_KEY, `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a', username: 'b', exp })}.sig`);
    renderGuarded();
    expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument();
  });

  it('renders the children when the token is live', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(ADMIN_TOKEN_KEY, `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a', username: 'b', exp })}.sig`);
    renderGuarded();
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- AdminLoginScreen RequireAdmin`
Expected: FAIL — cannot resolve `../AdminLoginScreen` and `../RequireAdmin`

- [ ] **Step 4: Write the implementation**

Create `FE/src/admin/RequireAdmin.tsx`:

```tsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getToken } from './adminSession';

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  // getToken() already treats an expired token as absent.
  if (!getToken()) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
```

Create `FE/src/admin/AdminLoginScreen.tsx`:

```tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminLogin } from './adminClient';
import { setToken } from './adminSession';
import { ApiError } from '../utils/api';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Sai tài khoản hoặc mật khẩu',
  LOGIN_THROTTLED: 'Sai quá nhiều lần. Vui lòng thử lại sau ít phút.',
  NETWORK_ERROR: 'Không kết nối được máy chủ',
  TIMEOUT: 'Không kết nối được máy chủ',
  VALIDATION_ERROR: 'Vui lòng nhập đủ tài khoản và mật khẩu',
};

function messageFor(err: unknown): string {
  const code = err instanceof ApiError ? err.code : '';
  return MESSAGES[code] ?? 'Đăng nhập không thành công. Vui lòng thử lại.';
}

export default function AdminLoginScreen() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await adminLogin(username, password);
      setToken(result.token);
      navigate('/admin/feedback', { replace: true });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-lg shadow p-6 space-y-4"
      >
        <h1 className="text-lg font-semibold">Đăng nhập quản trị</h1>

        <div className="space-y-1">
          <label htmlFor="admin-username" className="block text-sm">Tài khoản</label>
          <input
            id="admin-username"
            name="username"
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="admin-password" className="block text-sm">Mật khẩu</label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-slate-900 text-white py-2 disabled:opacity-50"
        >
          {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
```

Create `FE/src/admin/AdminApp.tsx`:

```tsx
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLoginScreen from './AdminLoginScreen';
import RequireAdmin from './RequireAdmin';

// Replaced by AdminFeedbackScreen in FE-5.
function FeedbackPlaceholder() {
  return <p>Danh sách feedback</p>;
}

export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLoginScreen />} />
      <Route
        path="feedback"
        element={<RequireAdmin><FeedbackPlaceholder /></RequireAdmin>}
      />
      <Route path="*" element={<Navigate to="/admin/feedback" replace />} />
    </Routes>
  );
}
```

Replace `FE/src/main.tsx` entirely:

```tsx
import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import App from './App.tsx';
import './index.css';

// Lazy so the parent-facing app never downloads the admin console.
const AdminApp = lazy(() => import('./admin/AdminApp'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<p className="p-6">Đang tải…</p>}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- AdminLoginScreen RequireAdmin` → Expected: PASS (9 tests)
Run: `npm test` → Expected: every FE suite PASS, including the existing `smoke.test.ts` and `fonts.test.ts`
Run: `npm run lint` → Expected: no TypeScript errors

- [ ] **Step 6: Commit**

```bash
git add FE/package.json FE/package-lock.json FE/src/main.tsx FE/src/admin/RequireAdmin.tsx \
        FE/src/admin/AdminLoginScreen.tsx FE/src/admin/AdminApp.tsx FE/src/admin/__tests__/
git commit -m "feat(fe): route the SPA, and put the admin console behind a login"
```

---

## Task FE-4: FeedbackTable and FeedbackFilters

Both are presentational: props in, markup out, no fetching. That is what makes them testable without a router or a network stub.

**Files:**
- Create: `FE/src/admin/FeedbackTable.tsx`
- Create: `FE/src/admin/FeedbackFilters.tsx`
- Test: `FE/src/admin/__tests__/FeedbackTable.test.tsx`
- Test: `FE/src/admin/__tests__/FeedbackFilters.test.tsx`

**Interfaces:**
- Consumes: `AdminFeedbackItem`, `FeedbackFilterState` (FE-1).
- Produces:
  - `FeedbackTable` — default export, props `{ items: AdminFeedbackItem[] }`
  - `FeedbackFilters` — default export, props `{ value: FeedbackFilterState; onChange: (next: FeedbackFilterState) => void }`
  - `FeedbackFilterState` fields are all strings; `''` means "no filter". `rating` is `''` or `'1'`–`'5'`; `hasNote` is `''`, `'1'` or `'0'`.

- [ ] **Step 1: Write the failing tests**

Create `FE/src/admin/__tests__/FeedbackTable.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import FeedbackTable from '../FeedbackTable';
import type { AdminFeedbackItem } from '../types';

const base: AdminFeedbackItem = {
  feedback_id: 'f1',
  created_at: '2026-08-06 14:22:01',
  rating: 5,
  listened_complete: 1,
  wants_more: 1,
  suitable: 1,
  note: 'bé đòi nghe lại 2 lần',
  story_id: 's1',
  story_title: 'Chú thỏ ngủ quên',
  child_name: 'Bống',
  tenant_id: 't1',
};

describe('FeedbackTable', () => {
  it('renders one row per item', () => {
    render(<FeedbackTable items={[base, { ...base, feedback_id: 'f2' }]} />);
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2
  });

  it('shows an em dash rather than the word null for missing story or child', () => {
    render(<FeedbackTable items={[{ ...base, story_title: null, child_name: null }]} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(row.textContent).not.toContain('null');
  });

  it('shows an em dash for a missing note and rating', () => {
    render(<FeedbackTable items={[{ ...base, note: null, rating: null }]} />);
    const row = screen.getAllByRole('row')[1];
    expect(row.textContent).not.toContain('null');
  });

  it('renders the boolean-ish columns as readable Vietnamese', () => {
    render(<FeedbackTable items={[{ ...base, listened_complete: 1, wants_more: 0 }]} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('Có')).toBeInTheDocument();
    expect(within(row).getByText('Không')).toBeInTheDocument();
  });

  it('renders the timestamp verbatim, since it is not ISO 8601', () => {
    render(<FeedbackTable items={[base]} />);
    expect(screen.getByText('2026-08-06 14:22:01')).toBeInTheDocument();
  });

  it('renders only the header when there are no items', () => {
    render(<FeedbackTable items={[]} />);
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });
});
```

Create `FE/src/admin/__tests__/FeedbackFilters.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedbackFilters from '../FeedbackFilters';
import type { FeedbackFilterState } from '../types';

const empty: FeedbackFilterState = { rating: '', hasNote: '', from: '', to: '' };

describe('FeedbackFilters', () => {
  it('emits the chosen rating', async () => {
    const onChange = vi.fn();
    render(<FeedbackFilters value={empty} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText(/đánh giá/i), '5');
    expect(onChange).toHaveBeenCalledWith({ ...empty, rating: '5' });
  });

  it('emits the note filter', async () => {
    const onChange = vi.fn();
    render(<FeedbackFilters value={empty} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText(/ghi chú/i), '1');
    expect(onChange).toHaveBeenCalledWith({ ...empty, hasNote: '1' });
  });

  it('emits date changes', async () => {
    const onChange = vi.fn();
    render(<FeedbackFilters value={empty} onChange={onChange} />);

    const from = screen.getByLabelText(/từ ngày/i);
    await userEvent.type(from, '2026-08-01');
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0].from).toBe('2026-08-01');
  });

  it('labels the date range as UTC so the 7-hour offset is not a surprise', () => {
    render(<FeedbackFilters value={empty} onChange={vi.fn()} />);
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
  });

  it('resets every field at once', async () => {
    const onChange = vi.fn();
    render(<FeedbackFilters value={{ rating: '5', hasNote: '1', from: '2026-08-01', to: '2026-08-02' }} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /xoá bộ lọc/i }));
    expect(onChange).toHaveBeenCalledWith(empty);
  });

  it('reflects the current value in the controls', () => {
    render(<FeedbackFilters value={{ rating: '3', hasNote: '0', from: '2026-08-01', to: '' }} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/đánh giá/i)).toHaveValue('3');
    expect(screen.getByLabelText(/ghi chú/i)).toHaveValue('0');
    expect(screen.getByLabelText(/từ ngày/i)).toHaveValue('2026-08-01');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- FeedbackTable FeedbackFilters`
Expected: FAIL — neither module resolves

- [ ] **Step 3: Write the implementation**

Create `FE/src/admin/FeedbackTable.tsx`:

```tsx
import React from 'react';
import type { AdminFeedbackItem } from './types';

/** A missing story or child is a valid state, not an error. Never print "null". */
const DASH = '—';

function text(value: string | number | null | undefined): React.ReactNode {
  if (value === null || value === undefined || value === '') return DASH;
  return value;
}

function bool(value: number | null): React.ReactNode {
  if (value === null || value === undefined) return DASH;
  if (value === 1) return 'Có';
  if (value === 0) return 'Không';
  return DASH; // wants_more uses -1 for "không rõ"
}

const HEADERS = ['Thời gian', 'Đánh giá', 'Bé', 'Truyện', 'Nghe hết', 'Muốn thêm', 'Ghi chú'];

export default function FeedbackTable({ items }: { items: AdminFeedbackItem[] }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left">
          <tr>
            {HEADERS.map((header) => (
              <th key={header} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.feedback_id} className="border-t border-slate-100 align-top">
              {/* created_at is SQLite's 'YYYY-MM-DD HH:MM:SS' in UTC, not ISO
                  8601, so it is shown as stored rather than reformatted. */}
              <td className="px-3 py-2 whitespace-nowrap">{text(item.created_at)}</td>
              <td className="px-3 py-2">{text(item.rating)}</td>
              <td className="px-3 py-2">{text(item.child_name)}</td>
              <td className="px-3 py-2">{text(item.story_title)}</td>
              <td className="px-3 py-2">{bool(item.listened_complete)}</td>
              <td className="px-3 py-2">{bool(item.wants_more)}</td>
              <td className="px-3 py-2 max-w-xs">{text(item.note)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Create `FE/src/admin/FeedbackFilters.tsx`:

```tsx
import React from 'react';
import type { FeedbackFilterState } from './types';

export const EMPTY_FILTERS: FeedbackFilterState = { rating: '', hasNote: '', from: '', to: '' };

interface Props {
  value: FeedbackFilterState;
  onChange: (next: FeedbackFilterState) => void;
}

export default function FeedbackFilters({ value, onChange }: Props) {
  const set = (patch: Partial<FeedbackFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-3">
      <div className="space-y-1">
        <label htmlFor="filter-rating" className="block text-xs text-slate-600">Đánh giá</label>
        <select
          id="filter-rating"
          value={value.rating}
          onChange={(e) => set({ rating: e.target.value })}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">Tất cả</option>
          {['1', '2', '3', '4', '5'].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="filter-note" className="block text-xs text-slate-600">Ghi chú</label>
        <select
          id="filter-note"
          value={value.hasNote}
          onChange={(e) => set({ hasNote: e.target.value })}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">Tất cả</option>
          <option value="1">Có ghi chú</option>
          <option value="0">Không ghi chú</option>
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="filter-from" className="block text-xs text-slate-600">Từ ngày</label>
        <input
          id="filter-from"
          type="date"
          value={value.from}
          onChange={(e) => set({ from: e.target.value })}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="filter-to" className="block text-xs text-slate-600">Đến ngày</label>
        <input
          id="filter-to"
          type="date"
          value={value.to}
          onChange={(e) => set({ to: e.target.value })}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </div>

      {/* created_at is stored in UTC; without this label a Vietnamese user
          would read the range as local time and be off by seven hours. */}
      <p className="text-xs text-slate-500">Khoảng ngày tính theo UTC</p>

      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTERS)}
        className="ml-auto rounded border border-slate-300 px-3 py-1 text-sm"
      >
        Xoá bộ lọc
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- FeedbackTable FeedbackFilters`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add FE/src/admin/FeedbackTable.tsx FE/src/admin/FeedbackFilters.tsx \
        FE/src/admin/__tests__/FeedbackTable.test.tsx FE/src/admin/__tests__/FeedbackFilters.test.tsx
git commit -m "feat(fe): feedback table and filters, with em dashes where data is absent"
```

---

## Task FE-5: AdminFeedbackScreen

**Files:**
- Create: `FE/src/admin/AdminFeedbackScreen.tsx`
- Modify: `FE/src/admin/AdminApp.tsx` (swap the placeholder for the real screen)
- Test: `FE/src/admin/__tests__/AdminFeedbackScreen.test.tsx`

**Interfaces:**
- Consumes: `fetchAdminFeedbacks` (FE-2), `clearToken` (FE-1), `FeedbackTable`/`FeedbackFilters`/`EMPTY_FILTERS` (FE-4).
- Produces: `AdminFeedbackScreen` — default export, no props. Owns URL sync, pagination and the four view states.

Query-string keys in the browser URL match the API exactly (`rating`, `has_note`, `from`, `to`, `limit`, `offset`) so a shared link and a shared API call describe the same thing.

- [ ] **Step 1: Write the failing test**

Create `FE/src/admin/__tests__/AdminFeedbackScreen.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminFeedbackScreen from '../AdminFeedbackScreen';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import { ApiError } from '../../utils/api';
import type { AdminFeedbackItem, AdminFeedbackPage } from '../types';
import * as client from '../adminClient';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function item(id: string, over: Partial<AdminFeedbackItem> = {}): AdminFeedbackItem {
  return {
    feedback_id: id, created_at: '2026-08-06 14:22:01', rating: 5,
    listened_complete: 1, wants_more: 1, suitable: 1, note: 'hay',
    story_id: 's1', story_title: 'Chú thỏ ngủ quên', child_name: 'Bống', tenant_id: 't1',
    ...over,
  };
}

function page(items: AdminFeedbackItem[], total: number, offset = 0): AdminFeedbackPage {
  return { items, total, limit: 20, offset };
}

function renderScreen(initialEntry = '/admin/feedback') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin/feedback" element={<AdminFeedbackScreen />} />
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminFeedbackScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows a loading state, then the rows', async () => {
    vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([item('f1')], 1));
    renderScreen();

    expect(screen.getByText(/đang tải/i)).toBeInTheDocument();
    expect(await screen.findByText('Chú thỏ ngủ quên')).toBeInTheDocument();
  });

  it('requests limit 20 at offset 0 by default', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([], 0));
    renderScreen();

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const params = spy.mock.calls[0][0];
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('0');
  });

  it('shows an empty state rather than a blank page', async () => {
    vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([], 0));
    renderScreen();
    expect(await screen.findByText(/chưa có feedback nào khớp bộ lọc/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry that refetches', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks')
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR'))
      .mockResolvedValueOnce(page([item('f1')], 1));

    renderScreen();
    expect(await screen.findByRole('alert')).toHaveTextContent(/không kết nối được máy chủ/i);

    await userEvent.click(screen.getByRole('button', { name: /thử lại/i }));
    expect(await screen.findByText('Chú thỏ ngủ quên')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('redirects to login when the session has expired', async () => {
    vi.spyOn(client, 'fetchAdminFeedbacks').mockRejectedValue(new ApiError('UNAUTHORIZED', undefined, 401));
    renderScreen();
    expect(await screen.findByText('LOGIN SCREEN')).toBeInTheDocument();
  });

  it('reads filters out of the URL on first load', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([], 0));
    renderScreen('/admin/feedback?rating=5&has_note=1&from=2026-08-01&to=2026-08-02');

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const params = spy.mock.calls[0][0];
    expect(params.get('rating')).toBe('5');
    expect(params.get('has_note')).toBe('1');
    expect(params.get('from')).toBe('2026-08-01');
    expect(params.get('to')).toBe('2026-08-02');
  });

  it('refetches with the new filter and resets to the first page', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([item('f1')], 40, 20));
    renderScreen('/admin/feedback?offset=20');

    await screen.findByText('Chú thỏ ngủ quên');
    await userEvent.selectOptions(screen.getByLabelText(/đánh giá/i), '5');

    await waitFor(() => {
      const params = spy.mock.calls.at(-1)![0];
      expect(params.get('rating')).toBe('5');
      // Landing on page 2 of a narrower result set is how you get a blank page.
      expect(params.get('offset')).toBe('0');
    });
  });

  it('omits empty filters from the request entirely', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([], 0));
    renderScreen();

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const params = spy.mock.calls[0][0];
    expect(params.has('rating')).toBe(false);
    expect(params.has('has_note')).toBe(false);
    expect(params.has('from')).toBe(false);
  });

  it('shows the visible range and total', async () => {
    vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(
      page(Array.from({ length: 20 }, (_, i) => item(`f${i}`)), 137, 20),
    );
    renderScreen('/admin/feedback?offset=20');
    expect(await screen.findByText(/21–40 \/ 137/)).toBeInTheDocument();
  });

  it('pages forward and back, and disables the edges', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(
      page(Array.from({ length: 20 }, (_, i) => item(`f${i}`)), 40, 0),
    );
    renderScreen();

    await screen.findByRole('button', { name: /sau/i });
    expect(screen.getByRole('button', { name: /trước/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /sau/i }));
    await waitFor(() => expect(spy.mock.calls.at(-1)![0].get('offset')).toBe('20'));
  });

  it('disables Sau on the last page', async () => {
    vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([item('f1')], 21, 20));
    renderScreen('/admin/feedback?offset=20');
    await screen.findByText('Chú thỏ ngủ quên');
    expect(screen.getByRole('button', { name: /sau/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- AdminFeedbackScreen`
Expected: FAIL — cannot resolve `../AdminFeedbackScreen`

- [ ] **Step 3: Write the implementation**

Create `FE/src/admin/AdminFeedbackScreen.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import FeedbackFilters, { EMPTY_FILTERS } from './FeedbackFilters';
import FeedbackTable from './FeedbackTable';
import { fetchAdminFeedbacks } from './adminClient';
import { clearToken } from './adminSession';
import { ApiError } from '../utils/api';
import type { AdminFeedbackPage, FeedbackFilterState } from './types';

const PAGE_SIZE = 20;

const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'Không kết nối được máy chủ',
  TIMEOUT: 'Không kết nối được máy chủ',
  VALIDATION_ERROR: 'Bộ lọc không hợp lệ',
};

function messageFor(err: unknown): string {
  const code = err instanceof ApiError ? err.code : '';
  return ERROR_MESSAGES[code] ?? 'Không tải được danh sách feedback';
}

/** The URL is the single source of truth, so reload and Back both work. */
function filtersFromParams(params: URLSearchParams): FeedbackFilterState {
  return {
    rating: params.get('rating') ?? '',
    hasNote: params.get('has_note') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
}

function requestParams(filters: FeedbackFilterState, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));
  // Empty means "no filter" -- sending `rating=` would fail validation.
  if (filters.rating) params.set('rating', filters.rating);
  if (filters.hasNote) params.set('has_note', filters.hasNote);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params;
}

function urlParams(filters: FeedbackFilterState, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.rating) params.set('rating', filters.rating);
  if (filters.hasNote) params.set('has_note', filters.hasNote);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (offset > 0) params.set('offset', String(offset));
  return params;
}

export default function AdminFeedbackScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = filtersFromParams(searchParams);
  const offset = Number(searchParams.get('offset') ?? 0) || 0;

  const [page, setPage] = useState<AdminFeedbackPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  const key = searchParams.toString();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAdminFeedbacks(requestParams(filtersFromParams(searchParams), offset));
      setPage(result);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
        // adminClient already dropped the token; this is just the redirect.
        clearToken();
        navigate('/admin/login', { replace: true });
        return;
      }
      setError(messageFor(err));
    } finally {
      setLoading(false);
    }
    // `key` stands in for searchParams so a new URLSearchParams identity with
    // the same contents does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, offset, navigate, reloadNonce]);

  useEffect(() => { void load(); }, [load]);

  function applyFilters(next: FeedbackFilterState) {
    // Always back to the first page: page 3 of a narrower result set is blank.
    setSearchParams(urlParams(next, 0), { replace: true });
  }

  function goTo(nextOffset: number) {
    setSearchParams(urlParams(filters, Math.max(0, nextOffset)));
  }

  const total = page?.total ?? 0;
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + (page?.items.length ?? 0), total);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-semibold">Feedback</h1>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <FeedbackFilters value={filters} onChange={applyFilters} />

        {loading && <p className="p-6 text-center text-slate-600">Đang tải…</p>}

        {!loading && error && (
          <div role="alert" className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{error}</p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="rounded border border-red-300 px-3 py-1 text-sm"
            >
              Thử lại
            </button>
          </div>
        )}

        {!loading && !error && page && page.items.length === 0 && (
          <p className="rounded border border-slate-200 bg-white p-6 text-center text-slate-600">
            Chưa có feedback nào khớp bộ lọc
          </p>
        )}

        {!loading && !error && page && page.items.length > 0 && (
          <>
            <FeedbackTable items={page.items} />
            <div className="flex items-center justify-between text-sm">
              <span>{`${first}–${last} / ${total}`}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => goTo(offset - PAGE_SIZE)}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >
                  Trước
                </button>
                <button
                  type="button"
                  disabled={last >= total}
                  onClick={() => goTo(offset + PAGE_SIZE)}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >
                  Sau
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
```

In `FE/src/admin/AdminApp.tsx`, remove `FeedbackPlaceholder` and use the real screen:

```tsx
import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AdminLoginScreen from './AdminLoginScreen';
import AdminFeedbackScreen from './AdminFeedbackScreen';
import RequireAdmin from './RequireAdmin';

export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLoginScreen />} />
      <Route
        path="feedback"
        element={<RequireAdmin><AdminFeedbackScreen /></RequireAdmin>}
      />
      <Route path="*" element={<Navigate to="/admin/feedback" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- AdminFeedbackScreen` → Expected: PASS (11 tests)
Run: `npm test` → Expected: every FE suite PASS
Run: `npm run lint` → Expected: no TypeScript errors
Run: `npm run build` → Expected: build succeeds and the output lists a separate `AdminApp` chunk

- [ ] **Step 5: Verify the whole flow against a running BE**

Terminal 1, from `BE/`:

```powershell
$env:ADMIN_JWT_SECRET = 'local-dev-admin-secret-at-least-32-chars'
npm run start:dev
```

Terminal 2, from `FE/`:

```powershell
npm run dev
```

Then, in a browser:

1. Open `http://localhost:3000/` — the parent app renders exactly as before.
2. Open `http://localhost:3000/admin/feedback` — redirected to `/admin/login`.
3. Log in with the account seeded in BE-10 — the feedback list appears.
4. Change the rating filter — the URL gains `?rating=5` and the list narrows.
5. Reload the page — the filter survives.
6. In DevTools, delete `bsc_admin_token` from localStorage and click a pagination button — redirected back to `/admin/login`.
7. In the Network tab, confirm **no request to `/api/tenant/init`** was made while on any `/admin` page.

- [ ] **Step 6: Commit**

```bash
git add FE/src/admin/AdminFeedbackScreen.tsx FE/src/admin/AdminApp.tsx \
        FE/src/admin/__tests__/AdminFeedbackScreen.test.tsx
git commit -m "feat(fe): feedback console with URL-synced filters and paging"
```

---

## Final verification

- [ ] From `BE/`: `npm test` — every suite passes
- [ ] From `BE/`: `npm run lint` — no TypeScript errors
- [ ] From `BE/`: `npm run build` — compiles
- [ ] From `FE/`: `npm test` — every suite passes
- [ ] From `FE/`: `npm run lint` — no TypeScript errors
- [ ] From `FE/`: `npm run build` — builds, with a separate admin chunk
- [ ] `git diff master --stat -- FE/src/App.tsx` reports no changes
- [ ] `BE/package.json` dependencies are unchanged from before this plan
- [ ] `FE/package.json` gained exactly one dependency: `react-router-dom`
