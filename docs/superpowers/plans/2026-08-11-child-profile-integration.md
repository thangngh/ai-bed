# Child Profile Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the broken navigation graph so a parent can create, edit and delete a child profile, and fix the three BE defects that would corrupt or lose that profile's data once it is reachable.

**Architecture:** No new modules, tables or dependencies. BE work is confined to `modules/child` (controller, service, update DTO) plus two small additions in `modules/story` (an optional `child_id` on the create DTO and a resolve branch in the service). FE work re-wires `App.tsx`'s screen graph, adds a permanent "Bé" entry point in `Header`, makes `ProfileManager`'s add button unconditional, and turns `FormScreen` into a profile-first form that reads the child from `activeChild` instead of asking for the name and age again.

**Tech Stack:** NestJS 11 + TypeORM + SQLite (two datasources, `core` and `local`) + Jest/supertest on the BE. React 19 + Vite + TypeScript + Tailwind + lucide-react + Vitest/@testing-library on the FE.

**Source spec:** `docs/superpowers/specs/2026-08-11-child-profile-integration-design.md`

## Global Constraints

- Branch: `feat/child-profile-integration`. Do not commit to `master`.
- All code comments and all git commit messages are in **English**. UI copy stays **Vietnamese**.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- Field caps, unchanged, must stay identical between `CreateChildProfileDto` and `UpdateChildProfileDto`: `NAME_MAX = 40`, `INTERESTS_MAX = 200`, `CHARACTER_MAX = 60`, `GOAL_MAX = 200`, `GENDER_MAX = 20`.
- `child_name` and `gender` use `@IsChildSafeText()` with **no** `{ content: true }`. `interests`, `preferred_characters`, `bedtime_goal` use `@IsChildSafeText({ content: true })`.
- `age` is bounded `@Min(3) @Max(6)` everywhere. Never widen it.
- Soft delete only: `is_active` flips to `0`; rows are never physically deleted.
- `child_id` on `POST /story/create` stays **optional**. `child_name` and `age` stay **required** on `CreateStoryDto`.
- BE tests run from `BE/`, FE tests run from `FE/`.
- Do not touch `Engine/`. `Engine/__pycache__/main.cpython-313.pyc` is dirty from before this work — leave it alone, never `git add` it.

## File Structure

**BE — modified**
- `BE/src/modules/child/child.service.ts` — add `create()`; add the `isActive: 1` filter to `getOrCreate`/`update`/`delete`; order `findByTenant`; rename-conflict check in `update`.
- `BE/src/modules/child/child.controller.ts` — single `toResponse()` shaping all four responses; `POST` calls `create()`; by-name `GET` calls `findByName()`.
- `BE/src/modules/child/dto/update-child-profile.dto.ts` — add `child_name`.
- `BE/src/modules/story/dto/create-story.dto.ts` — add optional `child_id`.
- `BE/src/modules/story/story.service.ts` — add private `resolveChild()` and branch on `dto.child_id`.

**BE — tests modified**
- `BE/src/modules/child/__tests__/child.service.spec.ts`
- `BE/src/modules/child/__tests__/child.integration.spec.ts`
- `BE/src/modules/story/__tests__/story.integration.spec.ts`

**FE — modified**
- `FE/src/types.ts` — `StoryFormInput.childId`.
- `FE/src/utils/childClient.ts` — map all seven fields; accept `child_name` on update.
- `FE/src/utils/storyGenerator.ts` — send `child_id`.
- `FE/src/components/Header.tsx` — permanent "Bé" button.
- `FE/src/components/ProfileManager.tsx` — unconditional add button, empty-state CTA, `initialEditChild`, auto-select first child.
- `FE/src/components/ProfileEditor.tsx` — surface 409, trust the full update response.
- `FE/src/components/AnalyticsScreen.tsx` — `onAddChild` empty-state CTA.
- `FE/src/components/FormScreen.tsx` — profile-first: empty state, child chip, no name/age inputs.
- `FE/src/App.tsx` — wire everything, drop the auto-open effect.

**FE — tests created/modified**
- `FE/src/utils/__tests__/childClient.test.ts` (create)
- `FE/src/components/__tests__/ProfileManager.test.tsx` (create)
- `FE/src/components/__tests__/Header.test.tsx` (create)
- `FE/src/components/__tests__/AnalyticsScreen.test.tsx` (create)
- `FE/src/components/__tests__/FormScreen.test.tsx` (rewrite)
- `FE/src/utils/__tests__/storyGenerator.test.ts` (modify)

---

### Task 1: ChildService respects the soft-delete flag

The three lookups that mutate or resurrect a row ignore `is_active`, while `findByTenant` filters on it. That mismatch is what makes a deleted child impossible to recreate: `getOrCreate` finds the dead row, returns it, and the list endpoint filters it right back out.

**Files:**
- Modify: `BE/src/modules/child/child.service.ts:32-84`
- Test: `BE/src/modules/child/__tests__/child.service.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ChildService.getOrCreate(tenantId: string, dto: CreateChildProfileDto): Promise<ChildProfile>`, `findByTenant(tenantId: string): Promise<ChildProfile[]>`, `update(childId: string, tenantId: string, dto: UpdateChildProfileDto): Promise<ChildProfile>`, `delete(childId: string, tenantId: string): Promise<void>` — all signatures unchanged, behaviour narrowed to active rows.

- [ ] **Step 1: Write the failing tests**

Append these three tests inside the existing `describe('ChildService', ...)` block in `BE/src/modules/child/__tests__/child.service.spec.ts`, after the last `it(...)`:

```ts
  it('creates a new row instead of resurrecting a soft-deleted child', async () => {
    // A deleted child that comes back must not inherit the old row: stories,
    // memories and analytics are all keyed by childId, and the parent who
    // pressed "delete" does not expect them to reappear.
    const first = await service.getOrCreate('tenant-2', { child_name: 'Reborn', age: 4 } as any);
    await service.delete(first.childId, 'tenant-2');

    const second = await service.getOrCreate('tenant-2', { child_name: 'Reborn', age: 4 } as any);

    expect(second.childId).not.toBe(first.childId);
    expect(second.isActive).toBe(1);
    expect((await service.findById(first.childId))!.isActive).toBe(0);
  });

  it('refuses to update a soft-deleted child', async () => {
    const p = await service.getOrCreate('tenant-2', { child_name: 'GoneUpdate', age: 4 } as any);
    await service.delete(p.childId, 'tenant-2');

    await expect(service.update(p.childId, 'tenant-2', { age: 5 } as any)).rejects.toThrow(NotFoundException);
  });

  it('refuses to delete a soft-deleted child twice', async () => {
    const p = await service.getOrCreate('tenant-2', { child_name: 'GoneDelete', age: 4 } as any);
    await service.delete(p.childId, 'tenant-2');

    await expect(service.delete(p.childId, 'tenant-2')).rejects.toThrow(NotFoundException);
  });

  it('returns children in creation order', async () => {
    const t = 'tenant-order';
    const a = await service.getOrCreate(t, { child_name: 'Alpha', age: 4 } as any);
    const b = await service.getOrCreate(t, { child_name: 'Beta', age: 5 } as any);
    const c = await service.getOrCreate(t, { child_name: 'Gamma', age: 6 } as any);

    const list = await service.findByTenant(t);

    expect(list.map(p => p.childId)).toEqual([a.childId, b.childId, c.childId]);
  });
```

Add `NotFoundException` to the imports at the top of that spec file:

```ts
import { NotFoundException } from '@nestjs/common';
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd BE
npx jest src/modules/child/__tests__/child.service.spec.ts
```

Expected: FAIL. `resurrecting` fails on `expect(second.childId).not.toBe(first.childId)`; both `refuses to...` tests fail because no exception is thrown; the ordering test may pass by accident on SQLite — that is fine, it is a regression guard.

- [ ] **Step 3: Add the `isActive` filters and the ordering**

In `BE/src/modules/child/child.service.ts`, change the `getOrCreate` lookup (line 33-35) to:

```ts
    // Deleted profiles must not match: a name that comes back is a new child
    // as far as stories, memories and analytics are concerned. Without this
    // filter the dead row was returned, the API reported success, and the
    // child never appeared in `findByTenant` again.
    const existing = await this.repo.findOne({
      where: { tenantId, childName: dto.child_name, isActive: 1 },
    });
```

Change `findByTenant` (line 56-58) to:

```ts
  async findByTenant(tenantId: string): Promise<ChildProfile[]> {
    // Without an explicit order the list is whatever SQLite hands back, so the
    // children could swap places between two loads of the same screen.
    return this.repo.find({ where: { tenantId, isActive: 1 }, order: { createdAt: 'ASC' } });
  }
```

Change the first line of `update` (line 69) to:

```ts
    const profile = await this.repo.findOne({ where: { childId, tenantId, isActive: 1 } });
```

Change the first line of `delete` (line 80) to:

```ts
    const profile = await this.repo.findOne({ where: { childId, tenantId, isActive: 1 } });
```

- [ ] **Step 4: Run the tests to verify they pass**

```
cd BE
npx jest src/modules/child/__tests__/child.service.spec.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Run the whole BE suite to catch fallout**

```
cd BE
npx jest
```

Expected: PASS. If `child.integration.spec.ts` or `story.integration.spec.ts` fail here, stop and report — nothing in this task should change their behaviour.

- [ ] **Step 6: Commit**

```bash
git add BE/src/modules/child/child.service.ts BE/src/modules/child/__tests__/child.service.spec.ts
git commit -m "fix(child): scope profile lookups to active rows

getOrCreate matched soft-deleted rows, so recreating a deleted child
returned the dead row and the child never reappeared in the list.
update and delete had the same gap. findByTenant now orders by
createdAt so the list is stable between loads.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: ChildService.create() rejects duplicate names

`POST /child-profile` currently calls `getOrCreate`, so creating a child that already exists silently returns the existing one with a different age. With profile-first navigation, "create" has to mean create.

**Files:**
- Modify: `BE/src/modules/child/child.service.ts`
- Test: `BE/src/modules/child/__tests__/child.service.spec.ts`

**Interfaces:**
- Consumes: `ChildService` as left by Task 1.
- Produces: `ChildService.create(tenantId: string, dto: CreateChildProfileDto): Promise<ChildProfile>` — throws `ConflictException` when an active row in the same tenant already has that `childName`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('ChildService', ...)` in `BE/src/modules/child/__tests__/child.service.spec.ts`:

```ts
  it('create() stores every field from the DTO', async () => {
    const p = await service.create('tenant-3', {
      child_name: 'Full',
      age: 5,
      gender: 'girl',
      interests: 'khủng long',
      preferred_characters: 'Thỏ Bông',
      bedtime_goal: 'Chia sẻ',
    } as any);

    expect(p.childId).toBeDefined();
    expect(p.gender).toBe('girl');
    expect(p.interests).toBe('khủng long');
    expect(p.preferredCharacters).toBe('Thỏ Bông');
    expect(p.bedtimeGoal).toBe('Chia sẻ');
    expect(p.isActive).toBe(1);
  });

  it('create() rejects a name already used by an active child', async () => {
    await service.create('tenant-3', { child_name: 'Dup', age: 4 } as any);

    await expect(service.create('tenant-3', { child_name: 'Dup', age: 5 } as any))
      .rejects.toThrow(ConflictException);
  });

  it('create() allows a name freed by a soft delete', async () => {
    const first = await service.create('tenant-3', { child_name: 'Freed', age: 4 } as any);
    await service.delete(first.childId, 'tenant-3');

    const second = await service.create('tenant-3', { child_name: 'Freed', age: 4 } as any);

    expect(second.childId).not.toBe(first.childId);
  });

  it('create() does not collide across tenants', async () => {
    await service.create('tenant-3', { child_name: 'Shared', age: 4 } as any);

    const other = await service.create('tenant-4', { child_name: 'Shared', age: 4 } as any);

    expect(other.childId).toBeDefined();
  });
```

Extend the `@nestjs/common` import line added in Task 1 to:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd BE
npx jest src/modules/child/__tests__/child.service.spec.ts -t "create()"
```

Expected: FAIL with `service.create is not a function`.

- [ ] **Step 3: Implement `create()`**

In `BE/src/modules/child/child.service.ts`, extend the imports:

```ts
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
```

Insert this method directly above `getOrCreate`:

```ts
  /**
   * A profile the parent asked for explicitly.
   *
   * Unlike `getOrCreate`, a name that is already taken is an error rather than
   * a silent hand-back of the existing row. `getOrCreate` exists to keep the
   * story endpoint working for callers that only know a name; this one backs
   * the profile screen, where "add" must not quietly edit someone else.
   */
  async create(tenantId: string, dto: CreateChildProfileDto): Promise<ChildProfile> {
    const clash = await this.repo.findOne({
      where: { tenantId, childName: dto.child_name, isActive: 1 },
    });
    if (clash) throw new ConflictException('Child profile with this name already exists');

    const profile = new ChildProfile();
    profile.childId = uuidv4();
    profile.tenantId = tenantId;
    profile.childName = dto.child_name;
    profile.age = dto.age;
    profile.interests = dto.interests || null;
    profile.preferredCharacters = dto.preferred_characters || null;
    profile.bedtimeGoal = dto.bedtime_goal || null;
    profile.gender = dto.gender || null;
    return this.repo.save(profile);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```
cd BE
npx jest src/modules/child/__tests__/child.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add BE/src/modules/child/child.service.ts BE/src/modules/child/__tests__/child.service.spec.ts
git commit -m "feat(child): add create() that rejects duplicate names

The profile screen needs an explicit create. getOrCreate stays for the
story endpoint, which only knows a name and must keep working.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Controller returns the full profile

All four handlers build their response object by hand and all four drop `gender`, `interests`, `preferred_characters` and `bedtime_goal`. That is the data-loss bug: the editor prefills from a response that never carried those fields, then `PUT`s the blanks back over the stored values — the very values `StoryService` reads to build the prompt.

**Files:**
- Modify: `BE/src/modules/child/child.controller.ts`
- Test: `BE/src/modules/child/__tests__/child.integration.spec.ts`

**Interfaces:**
- Consumes: `ChildService.create()` from Task 2; `ChildService.findByName()` (already exists, unchanged).
- Produces: every `child-profile` response body is `{ child_id, child_name, age, gender, interests, preferred_characters, bedtime_goal }`, with `null` for unset optional fields. The by-name miss keeps its old shape, `{ child_id: null }`.

- [ ] **Step 1: Replace the obsolete duplicate-name test and add the new ones**

In `BE/src/modules/child/__tests__/child.integration.spec.ts`, **delete** the whole existing test `'POST /child-profile duplicate name returns existing child (same child_id)'` (lines 93-108) and put this in its place:

```ts
  it('POST /child-profile duplicate name returns 409', async () => {
    const tenant = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Chi', age: 4 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Chi', age: 5 })
      .expect(409);
  });
```

Then append these tests at the end of the same `describe` block, before its closing `});`:

```ts
  it('POST then GET returns every profile field', async () => {
    const tenant = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({
        child_name: 'Đủ',
        age: 5,
        gender: 'girl',
        interests: 'khủng long',
        preferred_characters: 'Thỏ Bông',
        bedtime_goal: 'Chia sẻ',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', tenant)
      .query({ child_name: 'Đủ' })
      .expect(200);

    expect(res.body).toMatchObject({
      child_name: 'Đủ',
      age: 5,
      gender: 'girl',
      interests: 'khủng long',
      preferred_characters: 'Thỏ Bông',
      bedtime_goal: 'Chia sẻ',
    });
    expect(res.body.child_id).toBeDefined();
  });

  it('PUT with only age leaves the other profile fields untouched', async () => {
    // The bug this guards: GET used to omit these fields, so the editor
    // prefilled them empty and sent the blanks back. StoryService reads
    // preferredCharacters and bedtimeGoal to build the prompt, so editing an
    // age used to silently change what every later story was written from.
    const tenant = freshTenant();
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({
        child_name: 'GiuNguyen',
        age: 4,
        interests: 'tàu hỏa',
        preferred_characters: 'Gấu Pooh',
        bedtime_goal: 'Dũng cảm',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .put(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .send({ age: 6 })
      .expect(200);

    expect(res.body.age).toBe(6);
    expect(res.body.interests).toBe('tàu hỏa');
    expect(res.body.preferred_characters).toBe('Gấu Pooh');
    expect(res.body.bedtime_goal).toBe('Dũng cảm');

    const saved = await core.getRepository(ChildProfile).findOneBy({ childId: created.body.child_id });
    expect(saved?.interests).toBe('tàu hỏa');
    expect(saved?.preferredCharacters).toBe('Gấu Pooh');
    expect(saved?.bedtimeGoal).toBe('Dũng cảm');
  });

  it('GET list returns every profile field', async () => {
    const tenant = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Danh', age: 3, interests: 'công chúa' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', tenant)
      .expect(200);

    const found = res.body.children.find((c: any) => c.child_name === 'Danh');
    expect(found.interests).toBe('công chúa');
    expect(found.bedtime_goal).toBeNull();
  });

  it('PUT /child-profile/:childId returns 404 for a deleted child', async () => {
    const tenant = freshTenant();
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'DaXoa', age: 4 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .expect(204);

    await request(app.getHttpServer())
      .put(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .send({ age: 5 })
      .expect(404);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd BE
npx jest src/modules/child/__tests__/child.integration.spec.ts
```

Expected: FAIL — the duplicate test gets 201 instead of 409, and every field assertion gets `undefined`.

- [ ] **Step 3: Rewrite the controller**

Replace the whole body of `BE/src/modules/child/child.controller.ts` with:

```ts
import { Controller, Post, Get, Put, Delete, Param, Body, Query, Req, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { ChildService } from './child.service';
import { ChildProfile } from './entities/child-profile.entity';
import { CreateChildProfileDto } from './dto/child-profile.dto';
import { UpdateChildProfileDto } from './dto/update-child-profile.dto';

@Controller('child-profile')
export class ChildController {
  constructor(private readonly childService: ChildService) {}

  /**
   * One shape for every response.
   *
   * Each handler used to build its own object and all of them stopped at
   * name/age, so the SPA's editor could not prefill the rest -- it sent blanks
   * back and wiped the fields the Engine writes stories from. Keeping this in
   * one place is what stops the four responses drifting apart again.
   */
  private toResponse(p: ChildProfile) {
    return {
      child_id: p.childId,
      child_name: p.childName,
      age: p.age,
      gender: p.gender ?? null,
      interests: p.interests ?? null,
      preferred_characters: p.preferredCharacters ?? null,
      bedtime_goal: p.bedtimeGoal ?? null,
    };
  }

  @Post()
  async create(@Body() dto: CreateChildProfileDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.toResponse(await this.childService.create(tenantId, dto));
  }

  @Get()
  async get(@Query('child_name') childName: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    if (childName) {
      const found = await this.childService.findByName(tenantId, childName);
      // The miss keeps its bare shape: the SPA tests `data.child_id` for null.
      return found ? this.toResponse(found) : { child_id: null };
    }
    const profiles = await this.childService.findByTenant(tenantId);
    return { children: profiles.map(p => this.toResponse(p)) };
  }

  @Put(':childId')
  async update(
    @Param('childId') childId: string,
    @Body() dto: UpdateChildProfileDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return this.toResponse(await this.childService.update(childId, tenantId, dto));
  }

  @Delete(':childId')
  @HttpCode(204)
  async delete(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    await this.childService.delete(childId, tenantId);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```
cd BE
npx jest src/modules/child/__tests__/child.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run the whole BE suite**

```
cd BE
npx jest
```

Expected: PASS. `POST /child-profile` no longer upserts, so if any other spec relied on that, fix it here.

- [ ] **Step 6: Commit**

```bash
git add BE/src/modules/child/child.controller.ts BE/src/modules/child/__tests__/child.integration.spec.ts
git commit -m "fix(child): return the full profile from every endpoint

All four handlers built their own response and all four stopped at
name/age. The editor prefilled the missing fields with blanks and PUT
them back, wiping the interests and characters StoryService feeds to
the Engine. POST now creates instead of upserting, and the by-name GET
uses findByName so it honours the soft-delete filter.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Renaming a child

`UpdateChildProfileDto` has no `child_name`, but the editor still shows a name box — so a parent fixing a typo presses Cập nhật and nothing happens.

**Files:**
- Modify: `BE/src/modules/child/dto/update-child-profile.dto.ts`
- Modify: `BE/src/modules/child/child.service.ts` (`update`)
- Test: `BE/src/modules/child/__tests__/child.service.spec.ts`, `BE/src/modules/child/__tests__/child.integration.spec.ts`

**Interfaces:**
- Consumes: `ChildService.update()` and the controller from Task 3.
- Produces: `UpdateChildProfileDto.child_name?: string`; `update()` throws `ConflictException` when the new name belongs to a **different** active child in the same tenant.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('ChildService', ...)` in `BE/src/modules/child/__tests__/child.service.spec.ts`:

```ts
  it('update() renames a child', async () => {
    const p = await service.create('tenant-5', { child_name: 'Sai', age: 4 } as any);

    const renamed = await service.update(p.childId, 'tenant-5', { child_name: 'Đúng' } as any);

    expect(renamed.childName).toBe('Đúng');
    expect(await service.findByName('tenant-5', 'Sai')).toBeNull();
  });

  it('update() rejects a rename onto another active child', async () => {
    await service.create('tenant-5', { child_name: 'Taken', age: 4 } as any);
    const other = await service.create('tenant-5', { child_name: 'Mover', age: 4 } as any);

    await expect(service.update(other.childId, 'tenant-5', { child_name: 'Taken' } as any))
      .rejects.toThrow(ConflictException);
  });

  it('update() accepts a no-op rename to the child own name', async () => {
    const p = await service.create('tenant-5', { child_name: 'Same', age: 4 } as any);

    const saved = await service.update(p.childId, 'tenant-5', { child_name: 'Same', age: 5 } as any);

    expect(saved.childName).toBe('Same');
    expect(saved.age).toBe(5);
  });

  it('update() leaves fields absent from the DTO alone', async () => {
    const p = await service.create('tenant-5', {
      child_name: 'Keep',
      age: 4,
      interests: 'tàu hỏa',
      preferred_characters: 'Gấu Pooh',
      bedtime_goal: 'Dũng cảm',
      gender: 'boy',
    } as any);

    const saved = await service.update(p.childId, 'tenant-5', { age: 6 } as any);

    expect(saved.age).toBe(6);
    expect(saved.interests).toBe('tàu hỏa');
    expect(saved.preferredCharacters).toBe('Gấu Pooh');
    expect(saved.bedtimeGoal).toBe('Dũng cảm');
    expect(saved.gender).toBe('boy');
  });
```

Append inside the integration `describe` in `BE/src/modules/child/__tests__/child.integration.spec.ts`:

```ts
  it('PUT /child-profile/:childId renames a child', async () => {
    const tenant = freshTenant();
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Cu', age: 4 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .put(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'Moi' })
      .expect(200);

    expect(res.body.child_name).toBe('Moi');
  });

  it('PUT /child-profile/:childId returns 409 when the new name is taken', async () => {
    const tenant = freshTenant();
    await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'DaCo', age: 4 })
      .expect(201);
    const mover = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'SeDoi', age: 4 })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/child-profile/${mover.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'DaCo' })
      .expect(409);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd BE
npx jest src/modules/child/__tests__/
```

Expected: FAIL — the rename tests see the old name unchanged, and the 409 test gets 200.

- [ ] **Step 3: Add `child_name` to the update DTO**

In `BE/src/modules/child/dto/update-child-profile.dto.ts`, extend the import line to:

```ts
import { IsOptional, IsString, IsNotEmpty, IsInt, Min, Max, MaxLength } from 'class-validator';
```

Add `NAME_MAX` beside the other caps:

```ts
const NAME_MAX = 40;
```

Insert this as the first property of `UpdateChildProfileDto`, above `age`:

```ts
  /**
   * Renaming is allowed because a mistyped name is common and forcing a
   * delete-and-recreate would strand the child's stories on the old row.
   * Structural checks only, exactly as on create -- the content blocklist
   * contains `dao`, and a child can be called Dao.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  @IsChildSafeText()
  child_name?: string;
```

- [ ] **Step 4: Add the rename branch to the service**

In `BE/src/modules/child/child.service.ts`, in `update`, insert this immediately after the `if (!profile) throw new NotFoundException(...)` line and before the `dto.age` assignment:

```ts
    if (dto.child_name !== undefined && dto.child_name !== profile.childName) {
      const clash = await this.repo.findOne({
        where: { tenantId, childName: dto.child_name, isActive: 1 },
      });
      // Renaming to the child's own name is a no-op, not a conflict; only
      // another live row blocks it.
      if (clash && clash.childId !== profile.childId) {
        throw new ConflictException('Child profile with this name already exists');
      }
      profile.childName = dto.child_name;
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

```
cd BE
npx jest src/modules/child/__tests__/
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add BE/src/modules/child/dto/update-child-profile.dto.ts BE/src/modules/child/child.service.ts BE/src/modules/child/__tests__/
git commit -m "feat(child): allow renaming a profile

The editor already showed a name box, but the update DTO had no
child_name so the field was silently dropped. Renaming onto another
live child in the same tenant is a 409.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: POST /story/create accepts child_id

Once the SPA is profile-first it knows the `childId` and should say so, instead of round-tripping a name that `getOrCreate` might match to something else. The name path stays, so existing tests and clients keep working.

**Files:**
- Modify: `BE/src/modules/story/dto/create-story.dto.ts`
- Modify: `BE/src/modules/story/story.service.ts:30-37`
- Test: `BE/src/modules/story/__tests__/story.integration.spec.ts`

**Interfaces:**
- Consumes: `ChildService.findById(childId: string): Promise<ChildProfile | null>` (already exists).
- Produces: `CreateStoryDto.child_id?: string` (UUID); `StoryService` resolves it to an existing active profile in the caller's tenant or answers 404. Never creates on this branch.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('Story Module (integration)', ...)` block in `BE/src/modules/story/__tests__/story.integration.spec.ts`, before its closing `});`:

```ts
  it('POST /story/create with child_id reuses that profile and creates no new one', async () => {
    const tenant = '52345678-1234-4123-8123-123456789abc';
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'CoId', age: 5 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', tenant)
      .send({ child_id: created.body.child_id, child_name: 'CoId', age: 5, theme: 'Động vật' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/child-profile')
      .set('X-Tenant-Id', tenant)
      .expect(200);
    expect(list.body.children).toHaveLength(1);
    expect(list.body.children[0].child_id).toBe(created.body.child_id);
  });

  it('POST /story/create with a child_id from another tenant returns 404', async () => {
    const owner = '62345678-1234-4123-8123-123456789abc';
    const stranger = '72345678-1234-4123-8123-123456789abc';
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', owner)
      .send({ child_name: 'RiengTu', age: 4 })
      .expect(201);

    await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', stranger)
      .send({ child_id: created.body.child_id, child_name: 'RiengTu', age: 4, theme: 'Động vật' })
      .expect(404);
  });

  it('POST /story/create with a deleted child_id returns 404', async () => {
    const tenant = '82345678-1234-4123-8123-123456789abc';
    const created = await request(app.getHttpServer())
      .post('/child-profile')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'DaXoaTruyen', age: 4 })
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/child-profile/${created.body.child_id}`)
      .set('X-Tenant-Id', tenant)
      .expect(204);

    await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', tenant)
      .send({ child_id: created.body.child_id, child_name: 'DaXoaTruyen', age: 4, theme: 'Động vật' })
      .expect(404);
  });

  it('POST /story/create without child_id still works', async () => {
    const tenant = '92345678-1234-4123-8123-123456789abc';
    const res = await request(app.getHttpServer())
      .post('/story/create')
      .set('X-Tenant-Id', tenant)
      .send({ child_name: 'KhongId', age: 4, theme: 'Động vật' })
      .expect(201);

    expect(res.body.story_id).toBeDefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd BE
npx jest src/modules/story/__tests__/story.integration.spec.ts -t "child_id"
```

Expected: FAIL — `child_id` is rejected or ignored, so the tenant ends up with two profiles and the 404 cases return 201.

- [ ] **Step 3: Add `child_id` to the DTO**

In `BE/src/modules/story/dto/create-story.dto.ts`, extend the import line to:

```ts
import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional, IsIn, IsUUID, MaxLength } from 'class-validator';
```

Insert this as the first property of `CreateStoryDto`, above `child_name`:

```ts
  /**
   * The profile this story belongs to, when the caller already has one.
   *
   * Optional on purpose: without it the service falls back to matching by
   * name, which is what older clients and the integration suite do.
   * `child_name` and `age` therefore stay required -- the fallback needs them.
   */
  @IsOptional()
  @IsUUID()
  child_id?: string;
```

- [ ] **Step 4: Branch on `child_id` in the service**

In `BE/src/modules/story/story.service.ts`, add the entity import beside the others:

```ts
import { ChildProfile } from '../child/entities/child-profile.entity';
```

Replace the opening of `create` (lines 30-37) with:

```ts
  async create(dto: CreateStoryDto, tenantId: string): Promise<StoryResponse> {
    const child = dto.child_id
      ? await this.resolveChild(dto.child_id, tenantId)
      : await this.childService.getOrCreate(tenantId, {
          child_name: dto.child_name,
          age: dto.age,
          gender: dto.gender,
          preferred_characters: dto.favorite_character,
          bedtime_goal: dto.goal,
        });
```

Add this private method directly after `create` (above `saveSections`):

```ts
  /**
   * The profile behind an explicit `child_id`.
   *
   * This branch never creates. A caller that names an id is claiming the
   * profile already exists, so a miss -- unknown, deleted, or owned by another
   * tenant -- is a 404 rather than a quietly conjured second profile. The
   * tenant check is the isolation boundary: `findById` looks up by primary key
   * alone and would otherwise hand out another tenant's child.
   */
  private async resolveChild(childId: string, tenantId: string): Promise<ChildProfile> {
    const child = await this.childService.findById(childId);
    if (!child || child.tenantId !== tenantId || child.isActive !== 1) {
      throw new NotFoundException('Child profile not found');
    }
    return child;
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

```
cd BE
npx jest src/modules/story/__tests__/story.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Run the full BE suite and the type check**

```
cd BE
npx jest
npm run lint
```

Expected: both PASS. This is the last BE task — the whole backend must be green here.

- [ ] **Step 7: Commit**

```bash
git add BE/src/modules/story/dto/create-story.dto.ts BE/src/modules/story/story.service.ts BE/src/modules/story/__tests__/story.integration.spec.ts
git commit -m "feat(story): accept an explicit child_id

A profile-first client knows which child the story is for, so it should
not round-trip a name that getOrCreate might match to a different row.
The id branch resolves an existing active profile in the caller's tenant
and 404s otherwise; it never creates. The name path is untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: childClient carries the whole profile

The client maps three fields out of the seven the BE now returns, so every consumer sees `interests`, `preferredCharacters` and `bedtimeGoal` as `undefined` no matter what is stored.

**Files:**
- Modify: `FE/src/utils/childClient.ts`
- Modify: `FE/src/types.ts`
- Test: `FE/src/utils/__tests__/childClient.test.ts` (create)

**Interfaces:**
- Consumes: the seven-field response shape from Task 3.
- Produces:
  - `StoryFormInput` gains a required `childId: string`.
  - `childClient.list(): Promise<ChildProfile[]>`, `getByName(name: string): Promise<ChildProfile | null>`, `create(input: ChildProfileInput): Promise<ChildProfile>`, `update(childId: string, input: ChildProfileUpdateInput): Promise<ChildProfile>`, `delete(childId: string): Promise<void>` — all returning fully populated `ChildProfile` objects.
  - `ChildProfileInput = { child_name: string; age: number; gender?: string; interests?: string; preferred_characters?: string; bedtime_goal?: string }`
  - `ChildProfileUpdateInput = Partial<ChildProfileInput>`

- [ ] **Step 1: Write the failing test**

Create `FE/src/utils/__tests__/childClient.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { childClient } from '../childClient';

const VALID_TENANT = '12345678-1234-4123-8123-123456789abc';

describe('childClient', () => {
  beforeEach(() => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps every profile field from the list response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        children: [{
          child_id: 'c1',
          child_name: 'An',
          age: 4,
          gender: 'girl',
          interests: 'khủng long',
          preferred_characters: 'Thỏ Bông',
          bedtime_goal: 'Chia sẻ',
        }],
      }),
    }));

    const list = await childClient.list();

    expect(list).toEqual([{
      childId: 'c1',
      childName: 'An',
      age: 4,
      gender: 'girl',
      interests: 'khủng long',
      preferredCharacters: 'Thỏ Bông',
      bedtimeGoal: 'Chia sẻ',
    }]);
  });

  it('turns null optional fields into undefined', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        children: [{
          child_id: 'c2',
          child_name: 'Bo',
          age: 3,
          gender: null,
          interests: null,
          preferred_characters: null,
          bedtime_goal: null,
        }],
      }),
    }));

    const [child] = await childClient.list();

    expect(child.interests).toBeUndefined();
    expect(child.bedtimeGoal).toBeUndefined();
  });

  it('returns null when a by-name lookup misses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ child_id: null }),
    }));

    expect(await childClient.getByName('Khong')).toBeNull();
  });

  it('sends child_name on update so a rename reaches the BE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        child_id: 'c3', child_name: 'Moi', age: 4,
        gender: null, interests: null, preferred_characters: null, bedtime_goal: null,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const updated = await childClient.update('c3', { child_name: 'Moi', age: 4 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/child-profile/c3');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ child_name: 'Moi', age: 4 });
    expect(updated.childName).toBe('Moi');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
cd FE
npx vitest run src/utils/__tests__/childClient.test.ts
```

Expected: FAIL — `list()` returns objects with only `childId`/`childName`/`age`, and `update` has no `child_name` in its input type.

- [ ] **Step 3: Add `childId` to `StoryFormInput`**

In `FE/src/types.ts`, replace the `StoryFormInput` interface with:

```ts
export interface StoryFormInput {
  /** The profile the story belongs to. The form no longer asks for a name. */
  childId: string;
  childName: string;
  childAge: AgeGroup;
  favoriteTopic: string;
  gender?: GenderOption;
  lesson?: string;
  mood?: string;
  favoriteCharacter?: string;
}
```

- [ ] **Step 4: Rewrite the client**

Replace the whole contents of `FE/src/utils/childClient.ts` with:

```ts
import { apiClient } from './api';
import { AgeGroup, ChildProfile } from '../types';

interface ChildApiResponse {
  child_id: string;
  child_name: string;
  age: number;
  gender: string | null;
  interests: string | null;
  preferred_characters: string | null;
  bedtime_goal: string | null;
}

export interface ChildProfileInput {
  child_name: string;
  age: number;
  gender?: string;
  interests?: string;
  preferred_characters?: string;
  bedtime_goal?: string;
}

export type ChildProfileUpdateInput = Partial<ChildProfileInput>;

/**
 * The editor prefills from whatever this returns, so a field dropped here is a
 * field the next save writes back empty. Every column the BE sends is mapped.
 */
function toProfile(c: ChildApiResponse): ChildProfile {
  return {
    childId: c.child_id,
    childName: c.child_name,
    age: c.age as AgeGroup,
    gender: c.gender ?? undefined,
    interests: c.interests ?? undefined,
    preferredCharacters: c.preferred_characters ?? undefined,
    bedtimeGoal: c.bedtime_goal ?? undefined,
  };
}

export const childClient = {
  list: async (): Promise<ChildProfile[]> => {
    const data = await apiClient<{ children?: ChildApiResponse[] }>('/child-profile');
    return (data.children || []).map(toProfile);
  },

  getByName: async (name: string): Promise<ChildProfile | null> => {
    const data = await apiClient<any>(`/child-profile?child_name=${encodeURIComponent(name)}`);
    if (!data.child_id) return null;
    return toProfile(data);
  },

  create: async (input: ChildProfileInput): Promise<ChildProfile> => {
    const data = await apiClient<ChildApiResponse>('/child-profile', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return toProfile(data);
  },

  update: async (childId: string, input: ChildProfileUpdateInput): Promise<ChildProfile> => {
    const data = await apiClient<ChildApiResponse>(`/child-profile/${childId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return toProfile(data);
  },

  delete: async (childId: string): Promise<void> => {
    await apiClient(`/child-profile/${childId}`, { method: 'DELETE' });
  },
};
```

- [ ] **Step 5: Run the test to verify it passes**

```
cd FE
npx vitest run src/utils/__tests__/childClient.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

`npm run lint` will still fail at this point — `StoryFormInput.childId` is required and nothing supplies it until Task 9. Do not try to fix that here.

```bash
git add FE/src/utils/childClient.ts FE/src/types.ts FE/src/utils/__tests__/childClient.test.ts
git commit -m "fix(fe): map the whole child profile in childClient

The client kept three of the seven fields the BE returns, so the editor
prefilled the rest as empty and saved the blanks back. Also adds
child_name to the update input so a rename reaches the BE.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: A way into the profile screen

`Header` only renders the child button when `activeChild` exists, and `ProfileManager` only renders "Thêm hồ sơ mới" when `children.length > 0`. Between them there is no path to the first profile.

**Files:**
- Modify: `FE/src/components/Header.tsx:39-48`
- Modify: `FE/src/components/ProfileManager.tsx`
- Modify: `FE/src/App.tsx`
- Test: `FE/src/components/__tests__/Header.test.tsx` (create), `FE/src/components/__tests__/ProfileManager.test.tsx` (create)

**Interfaces:**
- Consumes: `childClient` from Task 6.
- Produces:
  - `Header` renders a button with `id="btn-header-children"` unconditionally; clicking it calls `setScreen('profile')`.
  - `ProfileManagerProps` gains `initialEditChild?: ChildProfile | null`.
  - `App` holds `profileEditTarget: ChildProfile | null`.

- [ ] **Step 1: Write the failing tests**

Create `FE/src/components/__tests__/Header.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../Header';

const baseProps = {
  currentScreen: 'home' as const,
  isNightMode: false,
  setIsNightMode: vi.fn(),
  savedStoriesCount: 0,
  onOpenSavedStories: vi.fn(),
};

describe('Header', () => {
  it('offers a way to the profile screen even with no child yet', () => {
    const setScreen = vi.fn();
    render(<Header {...baseProps} setScreen={setScreen} activeChild={null} />);

    fireEvent.click(screen.getByRole('button', { name: /^bé$/i }));

    expect(setScreen).toHaveBeenCalledWith('profile');
  });

  it('still shows the avatar shortcut once a child is active', () => {
    const onOpenChildSelector = vi.fn();
    render(
      <Header
        {...baseProps}
        setScreen={vi.fn()}
        activeChild={{ childId: 'c1', childName: 'An', age: 4 }}
        onOpenChildSelector={onOpenChildSelector}
      />
    );

    fireEvent.click(screen.getByTitle('An'));

    expect(onOpenChildSelector).toHaveBeenCalled();
  });
});
```

Create `FE/src/components/__tests__/ProfileManager.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileManager } from '../ProfileManager';
import { ChildProfile } from '../../types';

vi.mock('../../utils/childClient', () => ({
  childClient: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const AN: ChildProfile = { childId: 'c1', childName: 'An', age: 4 };

const baseProps = {
  activeChild: null,
  onSelectChild: vi.fn(),
  onUpdate: vi.fn(),
  onBack: vi.fn(),
  isNightMode: false,
};

describe('ProfileManager', () => {
  it('offers a create button when there are no children yet', () => {
    render(<ProfileManager {...baseProps} children={[]} />);

    // The dead end this fixes: the only add button used to be hidden at zero
    // children, so the first profile could never be created.
    expect(screen.getAllByRole('button', { name: /thêm hồ sơ/i }).length).toBeGreaterThan(0);
  });

  it('opens the editor for the child it was asked to edit', () => {
    render(<ProfileManager {...baseProps} children={[AN]} initialEditChild={AN} />);

    expect(screen.getByText('Sửa hồ sơ')).toBeInTheDocument();
    expect(screen.getByDisplayValue('An')).toBeInTheDocument();
  });

  it('shows the list when no edit target is given', () => {
    render(<ProfileManager {...baseProps} children={[AN]} />);

    expect(screen.getByText('Trang các bé')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd FE
npx vitest run src/components/__tests__/Header.test.tsx src/components/__tests__/ProfileManager.test.tsx
```

Expected: FAIL — no "Bé" button, no add button at zero children, `initialEditChild` not a prop.

- [ ] **Step 3: Add the "Bé" button to the header**

In `FE/src/components/Header.tsx`, extend the lucide import:

```tsx
import { Moon, Sun, BookOpen, Sparkles, Heart, BarChart3, Users } from 'lucide-react';
```

Insert this button in the "Right Actions" block, immediately before the Analytics button (`id="btn-header-analytics"`):

```tsx
          {/* Children Button -- unconditional on purpose: the profile screen was
              unreachable until the first child existed, and the first child
              could only be created from the profile screen. */}
          <button
            id="btn-header-children"
            onClick={() => setScreen('profile')}
            className={`p-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all ${
              isNightMode
                ? 'bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200'
                : 'bg-amber-100/80 hover:bg-amber-200/60 border border-amber-200 text-amber-900'
            }`}
            title="Hồ sơ các bé"
          >
            <Users className="w-4 h-4 text-emerald-500" />
            <span className="hidden sm:inline">Bé</span>
          </button>
```

- [ ] **Step 4: Make ProfileManager reachable and directable**

In `FE/src/components/ProfileManager.tsx`:

Add `initialEditChild` to the props interface:

```tsx
interface ProfileManagerProps {
  children: ChildProfile[];
  activeChild: ChildProfile | null;
  onSelectChild: (child: ChildProfile | null) => void;
  onUpdate: (children: ChildProfile[]) => void;
  onBack: () => void;
  isNightMode: boolean;
  /** Open straight into the editor for this child. App remounts on change. */
  initialEditChild?: ChildProfile | null;
}
```

Update the destructuring and the initial state:

```tsx
export const ProfileManager: React.FC<ProfileManagerProps> = ({
  children, activeChild, onSelectChild, onUpdate, onBack, isNightMode, initialEditChild,
}) => {
  const [editingChild, setEditingChild] = useState<ChildProfile | null | 'new'>(initialEditChild ?? null);
```

Add a CTA to the empty state — replace the `children.length === 0 &&` block with:

```tsx
        {children.length === 0 && (
          <div className="text-center py-10 opacity-70">
            <UserPlus className="w-12 h-12 mx-auto mb-3" />
            <p className="font-semibold">Chưa có hồ sơ bé nào</p>
            <p className="text-xs mt-1 mb-4">Thêm hồ sơ đầu tiên để bắt đầu!</p>
            <button
              id="btn-profile-add-first"
              onClick={handleAddNew}
              className="px-5 py-3 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" /><span>Thêm hồ sơ bé</span>
            </button>
          </div>
        )}
```

Drop the `children.length > 0` guard on the bottom button — replace the whole trailing block with:

```tsx
      <button id="btn-profile-add" onClick={handleAddNew} className={`w-full py-3.5 rounded-2xl text-sm font-bold border-2 border-dashed flex items-center justify-center gap-2 transition-colors cursor-pointer ${
        isNightMode ? 'border-slate-600 text-slate-300 hover:border-indigo-500' : 'border-amber-300 text-amber-800 hover:border-indigo-400'
      }`}>
        <Plus className="w-4 h-4" /><span>Thêm hồ sơ mới</span>
      </button>
```

- [ ] **Step 5: Wire it up in App**

In `FE/src/App.tsx`:

Add the edit-target state directly below the `isChildSelectorOpen` declaration:

```tsx
  const [profileEditTarget, setProfileEditTarget] = useState<ChildProfile | null>(null);
```

**Delete** the auto-open effect (lines 122-127):

```tsx
  // Auto-open child selector when no children exist
  useEffect(() => {
    if (children.length === 0 && currentScreen === 'form') {
      setIsChildSelectorOpen(true);
    }
  }, [children.length, currentScreen]);
```

Replace the `currentScreen === 'profile'` block with:

```tsx
        {currentScreen === 'profile' && (
          <ProfileManager
            // Remount when the edit target changes: the editor seeds its state
            // once, so a prop change alone would keep showing the old child.
            key={profileEditTarget?.childId ?? 'list'}
            children={children}
            activeChild={activeChild}
            onSelectChild={handleSelectChild}
            onUpdate={setChildren}
            onBack={() => { setProfileEditTarget(null); setCurrentScreen('home'); }}
            isNightMode={isNightMode}
            initialEditChild={profileEditTarget}
          />
        )}
```

Fix the `onEdit` handler on `ChildSelector`, which currently ignores its argument:

```tsx
        onEdit={(child) => {
          setIsChildSelectorOpen(false);
          setProfileEditTarget(child);
          setCurrentScreen('profile');
        }}
```

And clear the target on `onAddNew`:

```tsx
        onAddNew={() => {
          setIsChildSelectorOpen(false);
          setProfileEditTarget(null);
          setCurrentScreen('profile');
        }}
```

- [ ] **Step 6: Run the tests to verify they pass**

```
cd FE
npx vitest run src/components/__tests__/Header.test.tsx src/components/__tests__/ProfileManager.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add FE/src/components/Header.tsx FE/src/components/ProfileManager.tsx FE/src/App.tsx FE/src/components/__tests__/Header.test.tsx FE/src/components/__tests__/ProfileManager.test.tsx
git commit -m "fix(fe): reconnect the child profile screen

The header only showed the child button once a child existed, and the
profile screen only showed its add button once a child existed, so the
first profile could never be created. The header now always offers a
way in, the add button is unconditional, and editing from the child
selector opens the right child instead of dropping the argument.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Analytics empty state gets a CTA

The analytics screen tells a parent with no children that they should add one, then gives them nothing to click.

**Files:**
- Modify: `FE/src/components/AnalyticsScreen.tsx:138-144`
- Modify: `FE/src/App.tsx`
- Test: `FE/src/components/__tests__/AnalyticsScreen.test.tsx` (create)

**Interfaces:**
- Consumes: `App`'s `setProfileEditTarget` / `setCurrentScreen` from Task 7.
- Produces: `AnalyticsScreenProps` gains a required `onAddChild: () => void`.

- [ ] **Step 1: Write the failing test**

Create `FE/src/components/__tests__/AnalyticsScreen.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnalyticsScreen } from '../AnalyticsScreen';

vi.mock('../../utils/analyticsClient', () => ({
  analyticsClient: {
    getStoryStats: vi.fn().mockResolvedValue(null),
    getFeedbackStats: vi.fn().mockResolvedValue(null),
    getMemoryStats: vi.fn().mockResolvedValue(null),
  },
}));

describe('AnalyticsScreen', () => {
  it('lets a parent with no children add one from the empty state', async () => {
    const onAddChild = vi.fn();
    render(
      <AnalyticsScreen
        childProfiles={[]}
        activeChild={null}
        onBack={vi.fn()}
        isNightMode={false}
        onAddChild={onAddChild}
      />
    );

    const button = await screen.findByRole('button', { name: /thêm hồ sơ bé/i });
    fireEvent.click(button);

    await waitFor(() => expect(onAddChild).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
cd FE
npx vitest run src/components/__tests__/AnalyticsScreen.test.tsx
```

Expected: FAIL — no such button.

- [ ] **Step 3: Add the prop and the button**

In `FE/src/components/AnalyticsScreen.tsx`, extend the props interface and the destructuring:

```tsx
interface AnalyticsScreenProps {
  childProfiles: ChildProfile[];
  activeChild: ChildProfile | null;
  onBack: () => void;
  isNightMode: boolean;
  onAddChild: () => void;
}

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({
  childProfiles,
  activeChild,
  onBack,
  isNightMode,
  onAddChild,
}) => {
```

Replace the `!loading && !selectedChildId` empty-state block with:

```tsx
        {!loading && !selectedChildId && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">👶</div>
            <p className="text-lg font-semibold mb-2">Chưa có hồ sơ bé nào</p>
            <p className="text-sm opacity-70 mb-5">Thêm hồ sơ để xem thống kê</p>
            <button
              id="btn-analytics-add-child"
              onClick={onAddChild}
              className="px-5 py-3 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            >
              Thêm hồ sơ bé
            </button>
          </div>
        )}
```

- [ ] **Step 4: Pass the handler from App**

In `FE/src/App.tsx`, replace the `currentScreen === 'analytics'` block with:

```tsx
        {currentScreen === 'analytics' && (
          <AnalyticsScreen
            childProfiles={children}
            activeChild={activeChild}
            onBack={() => setCurrentScreen('home')}
            isNightMode={isNightMode}
            onAddChild={() => { setProfileEditTarget(null); setCurrentScreen('profile'); }}
          />
        )}
```

- [ ] **Step 5: Run the test to verify it passes**

```
cd FE
npx vitest run src/components/__tests__/AnalyticsScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add FE/src/components/AnalyticsScreen.tsx FE/src/App.tsx FE/src/components/__tests__/AnalyticsScreen.test.tsx
git commit -m "fix(fe): give the analytics empty state somewhere to go

It told a parent with no children to add one and offered no button.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Profile-first story form

The form asks for a name and an age that the profile already holds, which is how a second, divergent source of truth got created. It now reads the child from `activeChild` and sends `childId`.

**Files:**
- Modify: `FE/src/components/FormScreen.tsx`
- Modify: `FE/src/utils/storyGenerator.ts:118-133`
- Modify: `FE/src/App.tsx`
- Test: `FE/src/components/__tests__/FormScreen.test.tsx` (rewrite), `FE/src/utils/__tests__/storyGenerator.test.ts` (modify)

**Interfaces:**
- Consumes: `StoryFormInput.childId` from Task 6; `CreateStoryDto.child_id` from Task 5.
- Produces: `FormScreenProps` gains a required `onOpenChildSelector: () => void`; `activeChild` stays optional (the empty state is the no-child case). `generateBedtimeStory` posts `child_id`.

- [ ] **Step 1: Rewrite the FormScreen test**

Replace the whole contents of `FE/src/components/__tests__/FormScreen.test.tsx` with:

```tsx
import { ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormScreen } from '../FormScreen';
import { ChildProfile, StoryFormInput } from '../../types';

vi.mock('../../utils/memoryClient', () => ({
  memoryClient: {
    getContext: vi.fn().mockResolvedValue({
      interests: [], preferences: [], recentThemes: [], behaviors: [],
    }),
  },
}));

const AN: ChildProfile = { childId: 'c1', childName: 'An', age: 4 };

const renderForm = (overrides: Partial<ComponentProps<typeof FormScreen>> = {}) =>
  render(
    <FormScreen
      onSubmit={vi.fn()}
      onBack={vi.fn()}
      isNightMode={false}
      activeChild={AN}
      onOpenChildSelector={vi.fn()}
      {...overrides}
    />
  );

describe('FormScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for a child before showing the form when none is active', () => {
    const onOpenChildSelector = vi.fn();
    renderForm({ activeChild: null, onOpenChildSelector });

    expect(screen.queryByRole('button', { name: /tạo câu chuyện/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /chọn bé/i }));
    expect(onOpenChildSelector).toHaveBeenCalled();
  });

  it('does not ask again for a name the profile already holds', () => {
    renderForm();

    expect(screen.queryByLabelText(/tên của bé/i)).not.toBeInTheDocument();
    expect(screen.getByText(/đang kể cho bé an/i)).toBeInTheDocument();
    expect(screen.getByText(/4 tuổi/i)).toBeInTheDocument();
  });

  it('submits the active child id and age', async () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });

    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload: StoryFormInput = onSubmit.mock.calls[0][0];
    expect(payload.childId).toBe('c1');
    expect(payload.childName).toBe('An');
    expect(payload.childAge).toBe(4);
    expect(payload.favoriteTopic).toBe('Động vật');
  });

  it('uses custom topic when provided', async () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText(/nhập chủ đề khác/i), { target: { value: 'Tàu hỏa' } });
    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].favoriteTopic).toBe('Tàu hỏa');
  });

  it('still validates the free-text boxes it does own', async () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText(/nhập chủ đề khác/i), { target: { value: 'ｆｕｌｌｗｉｄｔｈ' } });
    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));

    expect(await screen.findByText(/ký tự rộng \(fullwidth\)/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers a way to switch child from the chip', () => {
    const onOpenChildSelector = vi.fn();
    renderForm({ onOpenChildSelector });

    fireEvent.click(screen.getByRole('button', { name: /đổi bé/i }));

    expect(onOpenChildSelector).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
cd FE
npx vitest run src/components/__tests__/FormScreen.test.tsx
```

Expected: FAIL — the name input is still rendered, there is no chip and no empty state, and `onSubmit` payloads have no `childId`.

- [ ] **Step 3: Rewrite FormScreen's state, submit and required section**

In `FE/src/components/FormScreen.tsx`:

Extend the lucide import to include `UserPlus` and `Users`, and drop the now-unused `User` and `Calendar`:

```tsx
import {
  Sparkles,
  Compass,
  HeartHandshake,
  Smile,
  Cat,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Users,
} from 'lucide-react';
```

Drop `AgeGroup` from the types import — it is no longer referenced:

```tsx
import { GenderOption, StoryFormInput, ChildProfile, MemoryContext } from '../types';
```

Replace the props interface and the component's opening state block (lines 19-50) with:

```tsx
interface FormScreenProps {
  onSubmit: (data: StoryFormInput) => void;
  onBack: () => void;
  isNightMode: boolean;
  activeChild?: ChildProfile | null;
  /** Opens the shared ChildSelector -- the one path to switching child. */
  onOpenChildSelector: () => void;
}

export const FormScreen: React.FC<FormScreenProps> = ({
  onSubmit,
  onBack,
  isNightMode,
  activeChild,
  onOpenChildSelector,
}) => {
  const [favoriteTopic, setFavoriteTopic] = useState('Động vật');
  const [customTopic, setCustomTopic] = useState('');

  // Optional fields
  const [showOptional, setShowOptional] = useState(true);
  const [gender, setGender] = useState<GenderOption>((activeChild?.gender as GenderOption) || 'unspecified');
  const [lesson, setLesson] = useState(activeChild?.bedtimeGoal || 'Chia sẻ');
  const [customLesson, setCustomLesson] = useState('');
  const [mood, setMood] = useState('Vui vẻ');
  const [favoriteCharacter, setFavoriteCharacter] = useState(activeChild?.preferredCharacters || '');

  const [errors, setErrors] = useState<{
    customTopic?: string;
    customLesson?: string;
    favoriteCharacter?: string;
  }>({});
```

Replace `handleSubmit` (lines 64-106) with:

```tsx
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChild) return;

    // The same rules the BE and the Engine enforce, said here so a parent
    // learns about them at the keyboard rather than after a loading screen.
    // The child's name is no longer among them: it comes from the stored
    // profile, which was validated when it was saved.
    const trimmedCharacter = favoriteCharacter.trim();
    const found = {
      customTopic: childTextError(customTopic.trim()),
      customLesson: childTextError(customLesson.trim()),
      favoriteCharacter: childTextError(trimmedCharacter),
    };
    if (Object.values(found).some(Boolean)) {
      setErrors({
        customTopic: found.customTopic ?? undefined,
        customLesson: found.customLesson ?? undefined,
        favoriteCharacter: found.favoriteCharacter ?? undefined,
      });
      return;
    }

    setErrors({});
    const finalTopic = customTopic.trim() || favoriteTopic;
    const finalLesson = customLesson.trim() || lesson;

    onSubmit({
      childId: activeChild.childId,
      childName: activeChild.childName,
      childAge: activeChild.age,
      favoriteTopic: finalTopic,
      gender,
      lesson: finalLesson,
      mood,
      favoriteCharacter: trimmedCharacter,
    });
  };
```

Immediately after `handleSubmit`, before the `return (`, add the empty state. It sits after every hook so the hook order never changes:

```tsx
  // Every hook above runs unconditionally; only the render forks. Without an
  // active child there is nothing to personalise, so asking for one is the
  // whole screen.
  if (!activeChild) {
    return (
      <div className="max-w-2xl mx-auto py-10 animate-fadeIn text-center space-y-5">
        <UserPlus className="w-14 h-14 mx-auto opacity-60" />
        <div className="space-y-1.5">
          <h2 className="text-2xl font-extrabold">Chọn bé trước khi kể chuyện</h2>
          <p className="text-sm opacity-80">
            Câu chuyện được viết riêng theo tuổi và sở thích của bé, nên cần biết đang kể cho ai.
          </p>
        </div>
        <button
          id="btn-form-pick-child"
          onClick={onOpenChildSelector}
          className="px-6 py-3.5 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 inline-flex items-center gap-2 cursor-pointer"
        >
          <Users className="w-4 h-4" /><span>Chọn bé</span>
        </button>
        <div>
          <button
            onClick={onBack}
            className={`inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer ${
              isNightMode ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-300' : 'bg-amber-100/80 hover:bg-amber-200/60 text-amber-900'
            }`}
          >
            <ArrowLeft className="w-4 h-4" /><span>Trở về trang chủ</span>
          </button>
        </div>
      </div>
    );
  }
```

Now replace the two obsolete blocks inside the required section. Delete the whole `{/* 1. Tên bé */}` block (lines 171-201) and the whole `{/* 2. Tuổi bé */}` block (lines 203-228), and put this chip in their place, directly under the "Thông tin bắt buộc" heading:

```tsx
          {/* Who this story is for. Read-only: the profile owns it. */}
          <div className={`flex items-center gap-3 p-3 rounded-2xl border ${
            isNightMode ? 'bg-slate-900/60 border-slate-700' : 'bg-amber-50/60 border-amber-200'
          }`}>
            <div className="flex-1 min-w-0 text-sm">
              <span className="font-bold">Đang kể cho bé {activeChild.childName}</span>
              <span className="opacity-70"> · {activeChild.age} tuổi</span>
            </div>
            <button
              type="button"
              id="btn-form-change-child"
              onClick={onOpenChildSelector}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-indigo-400/40 text-indigo-500 hover:bg-indigo-500/10 transition-colors cursor-pointer shrink-0"
            >
              Đổi bé
            </button>
          </div>
```

- [ ] **Step 4: Send `child_id` from the generator**

In `FE/src/utils/storyGenerator.ts`, add `child_id` as the first entry of the posted body:

```ts
    body: JSON.stringify({
      child_id: input.childId,
      child_name: input.childName,
      age: input.childAge,
      theme: input.favoriteTopic,
      goal: input.lesson || '',
      mood: input.mood || 'vui vẻ',
      language: 'vi',
      gender: input.gender || 'unspecified',
      favorite_character: input.favoriteCharacter || '',
    }),
```

- [ ] **Step 5: Update the generator tests for the new field**

In `FE/src/utils/__tests__/storyGenerator.test.ts`:

Add `childId: 'c1',` as the first property of the `input` object at line 29, and add `child_id: 'c1',` as the first property of the expected body object at line 43.

Add `childId: 'c1',` to each of the three inline inputs — the two `generateBedtimeStory({ childName: 'An', childAge: 4, favoriteTopic: 'Động vật' })` calls and the `const input: StoryFormInput = { childName: 'An', ... }` in the rethrow test. Each becomes:

```ts
{ childId: 'c1', childName: 'An', childAge: 4, favoriteTopic: 'Động vật' }
```

- [ ] **Step 6: Pass the new prop from App**

In `FE/src/App.tsx`, replace the `currentScreen === 'form'` block with:

```tsx
        {currentScreen === 'form' && (
          <FormScreen
            // Remount on child change: the optional fields seed from the
            // profile once, so switching child mid-form would keep the old
            // one's favourite character and bedtime goal.
            key={activeChild?.childId ?? 'none'}
            onSubmit={handleFormSubmit}
            onBack={() => setCurrentScreen('home')}
            isNightMode={isNightMode}
            activeChild={activeChild}
            onOpenChildSelector={() => setIsChildSelectorOpen(true)}
          />
        )}
```

- [ ] **Step 7: Run the tests to verify they pass**

```
cd FE
npx vitest run src/components/__tests__/FormScreen.test.tsx src/utils/__tests__/storyGenerator.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add FE/src/components/FormScreen.tsx FE/src/utils/storyGenerator.ts FE/src/App.tsx FE/src/components/__tests__/FormScreen.test.tsx FE/src/utils/__tests__/storyGenerator.test.ts
git commit -m "feat(fe): make the story form profile-first

The form asked for a name and age the profile already stored, which is
how a second source of truth appeared and how ghost profiles were
created. It now reads the child from activeChild, sends child_id, and
asks a parent to pick a child instead of rendering an unusable form.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The editor tells the parent what went wrong

`ProfileEditor` swallows every failure into `console.error`, so a 409 from a duplicate name looks like a button that does nothing. It also patches the update response by hand, which is unnecessary now that the BE returns everything.

**Files:**
- Modify: `FE/src/components/ProfileEditor.tsx:32-57`
- Modify: `FE/src/components/ProfileManager.tsx` (`handleSave`)
- Test: `FE/src/components/__tests__/ProfileManager.test.tsx`

**Interfaces:**
- Consumes: `childClient` from Task 6; `ApiError` from `FE/src/utils/api.ts` (`code`, `detail`, `status`).
- Produces: no prop changes. `ProfileManager.handleSave` calls `onSelectChild(saved)` when it saves the first child.

- [ ] **Step 1: Write the failing tests**

Append these two tests inside `describe('ProfileManager', ...)` in `FE/src/components/__tests__/ProfileManager.test.tsx`:

```tsx
  it('makes the first saved child the active one', async () => {
    const { childClient } = await import('../../utils/childClient');
    const created: ChildProfile = { childId: 'c9', childName: 'Bo', age: 5 };
    vi.mocked(childClient.create).mockResolvedValue(created);
    const onSelectChild = vi.fn();
    const onUpdate = vi.fn();

    render(<ProfileManager {...baseProps} children={[]} onSelectChild={onSelectChild} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: /thêm hồ sơ bé/i }));
    fireEvent.change(screen.getByLabelText(/tên bé/i), { target: { value: 'Bo' } });
    fireEvent.click(screen.getByRole('button', { name: /thêm bé/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith([created]));
    expect(onSelectChild).toHaveBeenCalledWith(created);
  });

  it('shows a message when the name is already taken', async () => {
    const { childClient } = await import('../../utils/childClient');
    const { ApiError } = await import('../../utils/api');
    vi.mocked(childClient.create).mockRejectedValue(new ApiError('API_ERROR', 'Conflict', 409));

    render(<ProfileManager {...baseProps} children={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /thêm hồ sơ bé/i }));
    fireEvent.change(screen.getByLabelText(/tên bé/i), { target: { value: 'Trung' } });
    fireEvent.click(screen.getByRole('button', { name: /thêm bé/i }));

    expect(await screen.findByText(/đã có bé tên này rồi/i)).toBeInTheDocument();
  });
```

Extend the imports at the top of that file:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
```

The label lookup needs the name input to be associated with its label. That is done in Step 3.

- [ ] **Step 2: Run the tests to verify they fail**

```
cd FE
npx vitest run src/components/__tests__/ProfileManager.test.tsx
```

Expected: FAIL — no label association, no error message, `onSelectChild` never called.

- [ ] **Step 3: Surface the error in ProfileEditor**

In `FE/src/components/ProfileEditor.tsx`:

Extend the imports:

```tsx
import { childClient } from '../utils/childClient';
import { ApiError } from '../utils/api';
```

Add an error state beside `saving`:

```tsx
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
```

Replace `handleSubmit` (lines 32-57) with:

```tsx
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!childName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        child_name: childName.trim(),
        age,
        gender: gender !== 'unspecified' ? gender : undefined,
        interests: interests.trim() || undefined,
        preferred_characters: preferredCharacters.trim() || undefined,
        bedtime_goal: bedtimeGoal.trim() || undefined,
      };
      if (isEdit && editChild) {
        // The response now carries every field, so there is nothing to patch
        // back in by hand -- doing so was how stale values got re-saved.
        onSave(await childClient.update(editChild.childId, payload));
      } else {
        onSave(await childClient.create(payload));
      }
    } catch (err) {
      // A silent failure here reads as a dead button. 409 is the only case a
      // parent can act on, so it gets its own words.
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Đã có bé tên này rồi. Ba mẹ chọn tên khác nhé!'
          : 'Lưu hồ sơ thất bại. Ba mẹ thử lại nhé!'
      );
    } finally {
      setSaving(false);
    }
  };
```

Associate the name input with its label and show the message. Replace the `{/* Name */}` block with:

```tsx
        {/* Name */}
        <div className="space-y-1.5">
          <label htmlFor="input-profile-child-name" className="text-sm font-bold">Tên bé <span className="text-rose-500">*</span></label>
          <input id="input-profile-child-name" value={childName} onChange={e => { setChildName(e.target.value); setError(null); }}
            className={`w-full px-4 py-3 rounded-2xl text-sm border focus:outline-none focus:ring-2 ${
              error ? 'border-rose-500' : isNightMode ? 'bg-slate-900 border-slate-700' : 'bg-amber-50/50 border-amber-200'
            }`} />
          {error && <p className="text-xs text-rose-500 font-medium pl-1">{error}</p>}
        </div>
```

- [ ] **Step 4: Auto-select the first child**

In `FE/src/components/ProfileManager.tsx`, replace `handleSave` with:

```tsx
  const handleSave = (saved: ChildProfile) => {
    if (editingChild === 'new') {
      onUpdate([...children, saved]);
      // Nothing else would set an active child, and without one the story
      // form has nobody to write for.
      if (children.length === 0) onSelectChild(saved);
    } else {
      onUpdate(children.map(c => c.childId === saved.childId ? { ...c, ...saved } : c));
    }
    setEditingChild(null);
  };
```

- [ ] **Step 5: Run the tests to verify they pass**

```
cd FE
npx vitest run src/components/__tests__/ProfileManager.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run the whole FE suite and the type check**

```
cd FE
npx vitest run
npm run lint
```

Expected: both PASS. This is the last task — `npm run lint` must be clean now that every `StoryFormInput` construction supplies `childId`.

- [ ] **Step 7: Re-run the BE suite to confirm nothing drifted**

```
cd BE
npx jest
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add FE/src/components/ProfileEditor.tsx FE/src/components/ProfileManager.tsx FE/src/components/__tests__/ProfileManager.test.tsx
git commit -m "fix(fe): report save failures and adopt the first child

The editor swallowed every error into console.error, so a duplicate
name looked like a dead button. Saving the first profile now also makes
it the active child, since nothing else would.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Manual verification

After Task 10, with the stack running (`docker compose up` or BE + FE dev servers), walk the path that was impossible before:

1. Clear site data so `bsc_active_child` and `bsc_children_cache` are empty.
2. Open the SPA. The header shows **Bé** even with no profiles.
3. Click **Bé** → empty state with **Thêm hồ sơ bé** → fill in name, age, interests, favourite character, bedtime goal → **Thêm bé**. The child becomes active and the avatar appears in the header.
4. Go to **Tạo câu chuyện**. The name and age boxes are gone; the chip reads `Đang kể cho bé <tên> · <tuổi> tuổi`. Generate a story.
5. Back to **Bé** → edit the child → change only the age → save → re-open the editor. Interests, favourite character and bedtime goal are still there.
6. Add a second child with the same name as the first. The form says `Đã có bé tên này rồi`.
7. Delete a child, then add one with the same name. It is accepted and the old stories do not come back under it.
8. **Phân tích** with no children shows **Thêm hồ sơ bé** and it opens the profile screen.
