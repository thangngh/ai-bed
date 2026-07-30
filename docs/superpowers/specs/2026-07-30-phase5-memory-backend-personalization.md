# Phase 5 Spec — BE Memory Services + FE Personalization Integration

> **Date:** 2026-07-30
> **Status:** Draft
> **Scope:** BE memory services (decay, extraction, reinforcement), FE memory display (badge + suggestions), full integration BE ↔ FE

---

## 1. Overview

Phase 4 đã xử lý Engine-side: parse memories JSON → natural language → inject vào prompt. Phase 5 là phần BE + FE còn lại của Memory-Driven Personalization:

- **BE:** MemoryService mới (extract, reinforce, context), entity expansion, 3 endpoints
- **FE:** Memory context badge trên FormScreen, memory-based suggestions trên HomeScreen
- **Integration:** BE nhận memories từ Engine → save → FE query → display

**Engine KHÔNG thay đổi** — MemoryExtractor đã chạy sẵn sau mỗi story, build_memory_context đã xong.

---

## 2. Memory Entity Expansion

### Current (local.db: memory_items)
```typescript
memory_id, tenant_id, child_id, story_id,
memory_type, memory_key, memory_value,
confidence, source_text, is_active, expires_at, created_at
```

### New fields
```typescript
source: string;          // 'story_extract' | 'feedback' | 'parent_input' | 'inference'
lastReinforcedAt: string; // ISO timestamp của lần reinforce gần nhất
```

**Usage-based decay (không time-based):**
- Max 20 active memories per child
- Khi đạt limit, memory cũ nhất (by lastReinforcedAt) bị deactivate (is_active = false)
- Confidence chỉ thay đổi khi có reinforce — không tự decay theo thời gian
- Duplicate: same `(tenant_id, child_id, memory_type, memory_key, memory_value)` → update confidence + lastReinforcedAt

---

## 3. BE MemoryService — New Methods

```typescript
// BE/src/modules/memory/memory.service.ts

async getChildContext(childId: string, tenantId: string): Promise<MemoryContext> {
  // Return top 10 active memories, ordered by confidence desc
  // Group by type: interests, preferences, recentThemes, behaviors
  return { interests: [...], preferences: [...], recentThemes: [...], behaviors: [...] };
}

async extractFromStory(story: any, childId: string, tenantId: string): Promise<void> {
  // Called after BE receives Engine response with memories array
  // For each memory in response:
  //   - Find or create by (tenant_id, child_id, type, key, value)
  //   - If exists: confidence = min(1, confidence + 0.1), update lastReinforcedAt
  //   - If new: create with confidence from Engine, source='story_extract'
  //   - Enforce max 20 active: deactivate oldest if over limit
}

async reinforce(childId: string, tenantId: string, dto: ReinforceDto): Promise<void> {
  const { type, key, value, action } = dto;
  // action = 'boost' | 'reduce'
  // Find existing memory by (tenant_id, child_id, type, key, value)
  // If found:
  //   boost: confidence = min(1, confidence + 0.2)
  //   reduce: confidence = max(0.1, confidence - 0.2)
  //   update lastReinforcedAt
  // If not found and boost: create with confidence 0.5, source='feedback'
  // If not found and reduce: no-op
}
```

### Trigger points
- **extractFromStory** — gọi từ StoryService ngay sau khi nhận Engine response (memories array)
- **reinforce** — gọi từ FeedbackService khi rating >= 4 (boost) hoặc rating <= 2 (reduce)

---

## 4. BE Endpoints

| Method | Path | Purpose | Request | Response |
|--------|------|---------|---------|----------|
| GET | `/memory/context/:childId` | Get child memory context | params: childId | MemoryContext (grouped by type) |
| POST | `/memory/extract` | Save extracted memories | `{story_id, child_id, memories: [...]}` | `{saved: number}` |
| POST | `/memory/reinforce` | Reinforce/reduce memory | `{child_id, type, key, value, action: 'boost'\|'reduce'}` | `{success: true}` |

All endpoints require `X-Tenant-Id` header.

---

## 5. FE Changes

### 5.1 FormScreen — Memory Context Badge

**When:** FormScreen mounts → call `GET /memory/context/:childId`
**Where:** Below form title, before input fields
**What:** Nếu có memories, hiển thị badge nhẹ:

```
🧠 Bé An thích: khủng long, công chúa · Lần trước: truyện về Động vật
```

**States:**
- Loading: skeleton 1 dòng
- Has memories: badge text
- No memories: ẩn hoàn toàn (không render)
- Error: ẩn (silent fail)

### 5.2 HomeScreen — Memory Suggestions

**When:** HomeScreen mounts → call `GET /memory/context/:childId`
**Where:** Below greeting, above "Tạo truyện mới" button
**What:** Nếu có interests/themes, hiển thị section:

```
Gợi ý cho bé {name}
┌──────────────────────────┐
│ 🦕 Truyện về khủng long  │  ← quick-action card
│ 👸 Truyện về công chúa    │
└──────────────────────────┘
```

Click card → pre-fill FormScreen với theme tương ứng + chuyển đến FormScreen.

**States:**
- Loading: 2 skeleton cards
- Has suggestions: card grid (max 4 cards)
- No suggestions: ẩn section hoàn toàn

---

## 6. Integration Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Story Generation Flow                                       │
│                                                              │
│  FE submit form → BE /story/create → Engine /generate       │
│                                                              │
│  Engine runs pipeline → MemoryExtractor.extract()            │
│  Engine response includes: { ..., memories: [...] }          │
│                                                              │
│  BE StoryService receives response →                        │
│    ├─ Save story to DB                                       │
│    ├─ POST /memory/extract (internal) → save memories        │
│    └─ Return story to FE                                     │
│                                                              │
│  Next time FE loads FormScreen/HomeScreen:                   │
│    └─ GET /memory/context/:childId → display                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Feedback Flow                                               │
│                                                              │
│  FE submit feedback → BE /story/feedback                    │
│  BE FeedbackService:                                         │
│    ├─ Save feedback to DB                                    │
│    ├─ If rating >= 4 → POST /memory/reinforce (boost)       │
│    ├─ If rating <= 2 → POST /memory/reinforce (reduce)      │
│    └─ Return response to FE                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Error & Edge Cases

| Scenario | Handling |
|----------|----------|
| No memories yet (new child) | GET /memory/context → empty object; FE ẩn badge/suggestions |
| Engine returns no memories | extractFromStory → no-op (0 saved) |
| Duplicate reinforce | Upsert — update confidence + lastReinforcedAt |
| Over 20 active memories | Deactivate oldest by lastReinforcedAt |
| FE fails to load context | Silent fail, ẩn badge/suggestions |
| Tenant mismatch on memory | 403 TENANT_MISMATCH (through TenantGuard) |
| Story has is_fallback=true | Engine trả memories=[] → skip extract |

---

## 8. Files Changed Summary

| File | Change |
|------|--------|
| **BE** | |
| `BE/src/modules/memory/memory.entity.ts` | Add `source`, `lastReinforcedAt` |
| `BE/src/modules/memory/memory.service.ts` | Add `getChildContext`, `extractFromStory`, `reinforce` |
| `BE/src/modules/memory/memory.controller.ts` | Add 3 endpoints |
| `BE/src/modules/story/story.service.ts` | Call `extractFromStory` after Engine response |
| `BE/src/modules/feedback/feedback.service.ts` | Call `reinforce` based on rating |
| `BE/src/modules/memory/__tests__/memory.service.spec.ts` | Add tests |
| **FE** | |
| `FE/src/utils/memoryClient.ts` | **NEW** — API wrapper cho memory endpoints |
| `FE/src/components/FormScreen.tsx` | Add memory context badge |
| `FE/src/components/HomeScreen.tsx` | Add memory suggestions section |
| `FE/src/types.ts` | Add memory context types |

**Total: ~10 files, ~300 lines new code**

---

## 9. Testing Strategy

| Layer | Test | Coverage |
|-------|------|----------|
| BE unit | MemoryService.getChildContext | Empty, has memories, tenant filter, sort order |
| BE unit | MemoryService.extractFromStory | Save new, update duplicate, max 20 limit |
| BE unit | MemoryService.reinforce | Boost existing, reduce existing, create new |
| BE unit | MemoryController | 3 endpoints response shape, error codes |
| FE unit | FormScreen badge | Loading, has memories, empty, error states |
| FE unit | HomeScreen suggestions | Loading, has suggestions, empty, click card |
| Integration | StoryService + extract | Story created → memories saved to DB |
| Integration | Feedback + reinforce | Rating >= 4 → memory boosted |

---

## 10. Implementation Order

1. Memory entity expansion (source, lastReinforcedAt)
2. MemoryService — getChildContext
3. MemoryService — extractFromStory (upsert + max 20)
4. MemoryService — reinforce (boost/reduce)
5. MemoryController — 3 endpoints
6. Wire StoryService → extractFromStory after Engine response
7. Wire FeedbackService → reinforce on feedback
8. FE memoryClient.ts
9. FE FormScreen — memory badge
10. FE HomeScreen — suggestion cards
11. Integration tests (StoryService + FeedbackService)
