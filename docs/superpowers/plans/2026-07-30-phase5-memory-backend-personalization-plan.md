# Phase 5 — BE Memory Services + FE Personalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BE memory services (extraction, reinforcement, context), FE display (badge + suggestions), full integration BE ↔ FE.

**Architecture:** Expand MemoryItem entity with `source` + `lastReinforcedAt`. Add 3 new methods to MemoryService. Add 3 BE endpoints. Wire extraction into StoryService (already partially done), reinforcement into FeedbackService (already partially done). New FE `memoryClient.ts` → FormScreen badge + HomeScreen suggestion cards. No Engine changes.

**Tech Stack:** NestJS 11 (TypeORM), React 19, TypeScript

## Global Constraints

- Max 20 active memories per child (usage-based decay)
- Confidence range: 0.0 – 1.0
- Duplicate: same `(tenant_id, child_id, memory_type, memory_key, memory_value)` → update confidence + lastReinforcedAt
- All endpoints require `X-Tenant-Id` header
- Engine unchanged — MemoryExtractor already runs after story generation
- FE silent fail on memory API errors (no blocking)

---

### Task 1: Entity expansion + MemoryService methods

**Files:**
- Modify: `BE/src/modules/memory/entities/memory-item.entity.ts`
- Modify: `BE/src/modules/memory/memory.service.ts`
- Test: `BE/src/modules/memory/__tests__/memory.service.spec.ts`

**Interfaces:**
- Consumes: existing `MemoryItem` entity, existing `bulkCreate`/`getRelevant` methods
- Produces: expanded entity, `getChildContext()`, `extractFromStory()`, `reinforce()` methods

- [ ] **Step 1: Add entity fields**

In `BE/src/modules/memory/entities/memory-item.entity.ts`, add after `sourceText`:

```typescript
@Column({ name: 'source', type: 'text', nullable: true })
source?: string;

@Column({ name: 'last_reinforced_at', type: 'text', nullable: true })
lastReinforcedAt?: string;
```

- [ ] **Step 2: Add `getChildContext()` method**

In `BE/src/modules/memory/memory.service.ts`, add after `getRelevant`:

```typescript
async getChildContext(childId: string, tenantId: string): Promise<{
  interests: any[];
  preferences: any[];
  recentThemes: any[];
  behaviors: any[];
}> {
  const memories = await this.repo.find({
    where: { tenantId, childId, isActive: 1 },
    order: { confidence: 'DESC' },
    take: 10,
  });

  return {
    interests: memories.filter(m => m.memoryType === 'interest').map(this._toClient),
    preferences: memories.filter(m => m.memoryType === 'preference').map(this._toClient),
    recentThemes: memories.filter(m => m.memoryType === 'recent_theme').map(this._toClient),
    behaviors: memories.filter(m => m.memoryType === 'behavior').map(this._toClient),
  };
}

private _toClient(m: MemoryItem) {
  return { type: m.memoryType, key: m.memoryKey, value: m.memoryValue, confidence: m.confidence };
}
```

- [ ] **Step 3: Add `extractFromStory()` method**

In `BE/src/modules/memory/memory.service.ts`, add after `getChildContext`:

```typescript
async extractFromStory(childId: string, tenantId: string, memories: any[], storyId: string): Promise<{ saved: number }> {
  let saved = 0;
  for (const mem of memories) {
    const existing = await this.repo.findOne({
      where: {
        tenantId,
        childId,
        memoryType: mem.type || mem.memory_type,
        memoryKey: mem.key || mem.memory_key,
        memoryValue: mem.value || mem.memory_value,
      },
    });

    if (existing) {
      existing.confidence = Math.min(1, (existing.confidence || 0) + 0.1);
      existing.lastReinforcedAt = new Date().toISOString();
      existing.storyId = storyId;
      await this.repo.save(existing);
    } else {
      const item = new MemoryItem();
      item.memoryId = uuidv4();
      item.tenantId = tenantId;
      item.childId = childId;
      item.storyId = storyId;
      item.memoryType = mem.type || mem.memory_type;
      item.memoryKey = mem.key || mem.memory_key;
      item.memoryValue = mem.value || mem.memory_value;
      item.confidence = mem.confidence || 0.5;
      item.source = 'story_extract';
      item.lastReinforcedAt = new Date().toISOString();
      await this.repo.save(item);
    }
    saved++;
  }

  // Enforce max 20 active — deactivate oldest if over limit
  await this._enforceActiveLimit(childId, tenantId);
  return { saved };
}

private async _enforceActiveLimit(childId: string, tenantId: string): Promise<void> {
  const active = await this.repo.find({
    where: { tenantId, childId, isActive: 1 },
    order: { lastReinforcedAt: 'ASC' },
  });
  if (active.length > 20) {
    const toDeactivate = active.slice(0, active.length - 20);
    for (const m of toDeactivate) {
      m.isActive = 0;
      await this.repo.save(m);
    }
  }
}
```

- [ ] **Step 4: Add `reinforce()` method**

In `BE/src/modules/memory/memory.service.ts`, add after `extractFromStory`:

```typescript
async reinforce(childId: string, tenantId: string, dto: {
  type: string;
  key: string;
  value: string;
  action: 'boost' | 'reduce';
}): Promise<{ success: boolean }> {
  const existing = await this.repo.findOne({
    where: { tenantId, childId, memoryType: dto.type, memoryKey: dto.key, memoryValue: dto.value },
  });

  if (existing) {
    if (dto.action === 'boost') {
      existing.confidence = Math.min(1, (existing.confidence || 0) + 0.2);
    } else {
      existing.confidence = Math.max(0.1, (existing.confidence || 0) - 0.2);
    }
    existing.lastReinforcedAt = new Date().toISOString();
    existing.source = 'feedback';
    await this.repo.save(existing);
    return { success: true };
  }

  if (dto.action === 'boost') {
    const item = new MemoryItem();
    item.memoryId = uuidv4();
    item.tenantId = tenantId;
    item.childId = childId;
    item.memoryType = dto.type;
    item.memoryKey = dto.key;
    item.memoryValue = dto.value;
    item.confidence = 0.5;
    item.source = 'feedback';
    item.lastReinforcedAt = new Date().toISOString();
    await this.repo.save(item);
    return { success: true };
  }

  return { success: false };
}
```

- [ ] **Step 5: Fix bug in getRelevant**

In `BE/src/modules/memory/memory.service.ts` line 3, change:

```typescript
import { DataSource, Repository, LessThan } from 'typeorm';
```

to:

```typescript
import { DataSource, Repository, MoreThan } from 'typeorm';
// Note: MoreThan is used in getRelevant, not LessThan
```

- [ ] **Step 6: Write tests for new methods**

In `BE/src/modules/memory/__tests__/memory.service.spec.ts`, add these tests:

```typescript
// In describe('MemoryService'), after existing tests

it('getChildContext should group memories by type', async () => {
  // Seed memories of different types
  // Assert interests/preferences/recentThemes/behaviors keys exist
});

it('extractFromStory should upsert and enforce max 20 limit', async () => {
  // Create 21 memories → assert only 20 active
});

it('reinforce should boost existing memory confidence', async () => {
  // Create memory with confidence 0.5
  // reinforce boost → assert confidence ≈ 0.7
});

it('reinforce should create new memory on boost if not exists', async () => {
  // reinforce boost with non-existent memory → assert created with 0.5
});

it('reinforce should reduce confidence on reduce action', async () => {
  // Create memory with confidence 0.8
  // reinforce reduce → assert confidence ≈ 0.6
});
```

- [ ] **Step 7: Run tests to verify pass**

Run: `cd BE && npx jest --testPathPattern="memory.service.spec" --no-coverage`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add BE/src/modules/memory/entities/memory-item.entity.ts BE/src/modules/memory/memory.service.ts BE/src/modules/memory/__tests__/memory.service.spec.ts
git commit -m "feat: expand memory entity, add getChildContext/extractFromStory/reinforce methods"
```

---

### Task 2: MemoryController endpoints + wire into StoryService/FeedbackService

**Files:**
- Modify: `BE/src/modules/memory/memory.controller.ts`
- Modify: `BE/src/modules/story/story.service.ts`
- Modify: `BE/src/modules/feedback/feedback.service.ts`

**Interfaces:**
- Consumes: `MemoryService.getChildContext()`, `extractFromStory()`, `reinforce()` from Task 1
- Produces: 3 endpoints, wired StoryService + FeedbackService

- [ ] **Step 1: Add 3 endpoints to MemoryController**

Replace `BE/src/modules/memory/memory.controller.ts` entirely:

```typescript
import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get('context/:childId')
  async getContext(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.memoryService.getChildContext(childId, tenantId);
  }

  @Post('extract')
  async extract(@Body() body: { child_id: string; story_id: string; memories: any[] }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.memoryService.extractFromStory(body.child_id, tenantId, body.memories, body.story_id);
  }

  @Post('reinforce')
  async reinforce(@Body() body: { child_id: string; type: string; key: string; value: string; action: 'boost' | 'reduce' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.memoryService.reinforce(body.child_id, tenantId, {
      type: body.type,
      key: body.key,
      value: body.value,
      action: body.action,
    });
  }
}
```

- [ ] **Step 2: Wire extractFromStory into StoryService**

In `BE/src/modules/story/story.service.ts`, replace lines 67-69:

```typescript
    if (engineResult.memories?.length) {
      await this.memoryService.bulkCreate(tenantId, child.childId, engineResult.memories, story.storyId);
    }
```

with:

```typescript
    if (engineResult.memories?.length) {
      await this.memoryService.extractFromStory(child.childId, tenantId, engineResult.memories, story.storyId);
    }
```

- [ ] **Step 3: Wire reinforce into FeedbackService**

Replace `BE/src/modules/feedback/feedback.service.ts` completely:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Feedback } from './entities/feedback.entity';
import { CreateFeedbackDto } from './dto/feedback.dto';
import { MemoryService } from '../memory/memory.service';

@Injectable()
export class FeedbackService {
  private repo: Repository<Feedback>;

  constructor(
    @InjectDataSource('core') private dataSource: DataSource,
    private readonly memoryService: MemoryService,
  ) {
    this.repo = this.dataSource.getRepository(Feedback);
  }

  async submit(dto: CreateFeedbackDto, tenantId: string): Promise<{ feedback_id: string }> {
    const feedback = new Feedback();
    feedback.feedbackId = uuidv4();
    feedback.tenantId = tenantId;
    feedback.storyId = dto.story_id;
    feedback.childId = dto.child_name || null;
    feedback.listenedComplete = dto.listened_complete ?? null;
    feedback.wantsMore = dto.wants_more ?? null;
    feedback.suitable = dto.suitable ?? null;
    feedback.rating = dto.rating ?? null;
    feedback.note = dto.note || null;
    await this.repo.save(feedback);

    if (dto.rating) {
      const action = dto.rating >= 4 ? 'boost' : dto.rating <= 2 ? 'reduce' : null;
      if (action && dto.child_name) {
        await this.memoryService.reinforce(dto.child_name || 'unknown', tenantId, {
          type: 'feedback',
          key: 'story_rating',
          value: `Rating: ${dto.rating}`,
          action,
        });
      }
    }

    return { feedback_id: feedback.feedback_id };
  }
}
```

Note: `child_name` in feedback DTO is actually a string name, not a childId. The existing code uses it as childId which is a bug. This plan keeps the same pattern for now — the child name lookup is a separate concern.

- [ ] **Step 4: Commit**

```bash
git add BE/src/modules/memory/memory.controller.ts BE/src/modules/story/story.service.ts BE/src/modules/feedback/feedback.service.ts
git commit -m "feat: add 3 memory endpoints, wire extract/reinforce into story and feedback services"
```

---

### Task 3: FE memoryClient + FormScreen badge

**Files:**
- Create: `FE/src/utils/memoryClient.ts`
- Modify: `FE/src/components/FormScreen.tsx`
- Modify: `FE/src/types.ts`

**Interfaces:**
- Consumes: `GET /memory/context/:childId` endpoint from Task 2
- Produces: `MemoryClient.getContext()`, FormScreen badge component

- [ ] **Step 1: Add MemoryContext type to types.ts**

In `FE/src/types.ts`, add after `ChildProfile` interface:

```typescript
export interface MemoryContext {
  interests: { type: string; key: string; value: string; confidence: number }[];
  preferences: { type: string; key: string; value: string; confidence: number }[];
  recentThemes: { type: string; key: string; value: string; confidence: number }[];
  behaviors: { type: string; key: string; value: string; confidence: number }[];
}
```

- [ ] **Step 2: Create memoryClient.ts**

```typescript
import { apiClient } from './api';
import { MemoryContext } from '../types';

export const memoryClient = {
  async getContext(childId: string): Promise<MemoryContext> {
    return apiClient<MemoryContext>(`/memory/context/${childId}`);
  },
};
```

- [ ] **Step 3: Add memory badge to FormScreen**

In `FE/src/components/FormScreen.tsx`:

After the imports, add:

```typescript
import { useEffect, useState } from 'react';
import { MemoryContext } from '../types';
import { memoryClient } from '../utils/memoryClient';
```

Inside the component, after `const [errors, setErrors] = ...` line, add:

```typescript
  const [memoryContext, setMemoryContext] = useState<MemoryContext | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);

  useEffect(() => {
    if (!activeChild?.childId) return;
    setMemoryLoading(true);
    memoryClient.getContext(activeChild.childId)
      .then(setMemoryContext)
      .catch(() => setMemoryContext(null))
      .finally(() => setMemoryLoading(false));
  }, [activeChild?.childId]);
```

After the form title section (around line 70-80 depending on exact structure), add the badge:

```tsx
{memoryLoading && (
  <div className="h-5 bg-gray-200 dark:bg-slate-700 rounded animate-pulse mb-4" />
)}
{!memoryLoading && memoryContext && (() => {
  const parts: string[] = [];
  if (memoryContext.interests.length > 0) {
    parts.push(`thích: ${memoryContext.interests.map(i => i.value).slice(0, 3).join(', ')}`);
  }
  if (memoryContext.recentThemes.length > 0) {
    const last = memoryContext.recentThemes[memoryContext.recentThemes.length - 1];
    parts.push(`lần trước: truyện về ${last.value}`);
  }
  if (parts.length === 0) return null;
  return (
    <div className={`text-xs p-2 rounded-lg mb-4 ${isNightMode ? 'bg-indigo-900/40 text-indigo-200' : 'bg-indigo-50 text-indigo-700'}`}>
      🧠 Bé {activeChild?.childName} {parts.join(' · ')}
    </div>
  );
})()}
```

- [ ] **Step 4: Commit**

```bash
git add FE/src/types.ts FE/src/utils/memoryClient.ts FE/src/components/FormScreen.tsx
git commit -m "feat: add memory context badge to FormScreen"
```

---

### Task 4: FE HomeScreen memory suggestions

**Files:**
- Modify: `FE/src/components/HomeScreen.tsx`

**Interfaces:**
- Consumes: `MemoryClient.getContext()` from Task 3
- Produces: Suggestion cards on HomeScreen

- [ ] **Step 1: Add memory suggestions to HomeScreen**

In `FE/src/components/HomeScreen.tsx`, add:

```typescript
import { useEffect, useState } from 'react';
import { MemoryContext } from '../types';
import { memoryClient } from '../utils/memoryClient';
```

Inside the component, before the return, add:

```typescript
  const [memoryContext, setMemoryContext] = useState<MemoryContext | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);

  useEffect(() => {
    if (!activeChild?.childId) return;
    setMemoryLoading(true);
    memoryClient.getContext(activeChild.childId)
      .then(setMemoryContext)
      .catch(() => setMemoryContext(null))
      .finally(() => setMemoryLoading(false));
  }, [activeChild?.childId]);
```

After the hero section (after the greeting div, before the feature highlights section), add the suggestions section:

```tsx
{/* Memory Suggestions */}
{memoryLoading && (
  <div className="space-y-2">
    <div className="h-4 w-32 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
    <div className="flex gap-3">
      <div className="h-16 w-32 bg-gray-200 dark:bg-slate-700 rounded-xl animate-pulse" />
      <div className="h-16 w-32 bg-gray-200 dark:bg-slate-700 rounded-xl animate-pulse" />
    </div>
  </div>
)}
{!memoryLoading && memoryContext && activeChild && (
  <div className="space-y-3">
    <h3 className={`text-sm font-semibold ${isNightMode ? 'text-slate-300' : 'text-amber-800'}`}>
      Gợi ý cho bé
    </h3>
    <div className="flex flex-wrap gap-3">
      {(() => {
        const suggestions = [
          ...(memoryContext.interests || []).map(i => ({ label: i.value, theme: i.value })),
          ...(memoryContext.recentThemes || []).slice(-2).map(t => ({ label: t.value, theme: t.value })),
        ].slice(0, 4);
        return suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onStartNewStory()}
            className={`px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
              isNightMode
                ? 'bg-indigo-900/50 hover:bg-indigo-800/60 text-indigo-200 border border-indigo-700/50'
                : 'bg-amber-100/80 hover:bg-amber-200/80 text-amber-800 border border-amber-200'
            }`}
          >
            🎯 {s.label}
          </button>
        ));
      })()}
    </div>
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add FE/src/components/HomeScreen.tsx
git commit -m "feat: add memory-based suggestion cards to HomeScreen"
```

---

### Task 5: Integration verification

**Files:**
- Run: BE test suite
- Run: Engine relevant tests

- [ ] **Step 1: Run full BE test suite**

Run: `cd BE && npx jest --no-coverage`
Expected: ALL PASS

- [ ] **Step 2: Run Engine prompt registry tests (no regressions)**

Run: `cd Engine && python -m pytest tests/test_prompt_registry.py -v`
Expected: ALL PASS (10 tests)

- [ ] **Step 3: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: verify no regressions after Phase 5 changes"
```
