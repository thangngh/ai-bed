# Phase 4 Spec — Memory-Driven Personalization, Prompt Quality & Parent Analytics

> **Date:** 2026-07-30
> **Status:** Draft
> **Scope:** Biến memory từ passive storage thành active personalization engine, nâng chất lượng prompt, thêm analytics dashboard cho phụ huynh

---

## 1. Overview

Phase 4 giải quyết 3 gap lớn nhất sau Phase 3:

**4A — Memory-Driven Personalization:** Memory module hiện tại chỉ lưu/thô sơ. Phase 4 biến nó thành "hồ sơ behavior" của từng bé — ghi nhớ sở thích, chủ đề đã thích, nhân vật yêu thích, feedback history — và inject vào prompt mỗi khi tạo truyện.

**4B — Prompt Quality & Story Structure:** Cải thiện prompt templates để truyện có cốt truyện phong phú hơn, interaction points tự nhiên hơn, tiếng Việt hay hơn.

**4C — Parent Analytics Dashboard:** Giao diện cho phụ huynh xem thống kê: số truyện đã tạo, chủ đề phổ biến, thời gian đọc trung bình, feedback trends theo từng bé.

**Key decisions:**
- Memory vẫn là key-value store (không graph) nhưng có confidence scoring + decay
- Prompt templates vẫn là `.txt` files — không hard-code trong code
- Analytics là FE dashboard đọc từ BE aggregation endpoints (không real-time streaming)
- Không cần Auth Google OAuth (vẫn device UUID) — analytics là local per-device
- Không voice/audio trong phase này (TTS cần third-party API + cost)

---

## 2. Architecture Changes

```
FE hiện tại:                          FE mới:
───────────────                       ─────────
App.tsx                                App.tsx
├─ activeChild + localStorage           ├─ (giữ nguyên)
├─ children: ChildProfile[]             ├─ (giữ nguyên)
├─ savedStories/BE stories              ├─ (giữ nguyên)
│                                       │
HomeScreen                              HomeScreen
├─ greeting + age-filtered              ├─ (giữ nguyên + memory-based suggestions)
│                                       │
FormScreen                              FormScreen
├─ pre-filled từ activeChild            ├─ (giữ nguyên + memory context badge)
│                                       │
— NEW —                                AnalyticsScreen
                                         ├─ stories over time (chart)
                                         ├─ topic distribution
                                         ├─ child comparison
                                         └─ feedback summary

BE hiện tại:                          BE mới:
───────────────                       ─────────
MemoryModule                            MemoryModule
├─ CRUD basic                          ├─ getContext(childId): MemoryContext
├─ getRelevant(tenantId, childId)       ├─ aggregateByType(childId): stats
│                                       ├─ pruneOldMemories(ttl_days): void
│                                       └─ confidence decay algorithm
│
— NO —                                 Analytics Endpoints
                                         ├─ GET /memory/stats/:childId
                                         ├─ GET /story/stats/:childId
                                         └─ GET /story/trends/:childId

Engine hiện tại:                      Engine mới:
─────────────────                     ────────────
PromptRegistry                          PromptRegistry
├─ assemble(age, data)                  ├─ assemble(age, data) — enriched
├─ templates: static .txt               ├─ templates: improved dynamic
│                                       ├─ inject memory_context section
│                                       └─ inject behavioral_persona section
│
Pipeline                                Pipeline
├─ Planner → Writer → Reviewer           ├─ (giữ nguyên flow)
├─ retry logic                          ├─ planner: enhanced outline structure
│                                       ├─ writer: richer story arcs
│                                       └─ reviewer: stricter quality checks
```

---

## 3. 4A — Memory-Driven Personalization

### 3.1 Memory Data Model Expansion

**Current model:**
```typescript
MemoryItem {
  id: string;
  tenantId: string;
  childId: string;
  type: string;        // 'interest' | 'behavior' | 'preference'
  key: string;         // e.g. 'favorite_theme', 'liked_character'
  value: string;       // e.g. 'khủng long', 'Gấu Pooh'
  confidence: number;  // 0.0 - 1.0
  createdAt: string;
}
```

**New fields:**
```typescript
MemoryItem {
  // ...existing fields...
  source: string;       // 'story_extract' | 'feedback' | 'parent_input' | 'inference'
  contextIds?: string[]; // referencing story_ids that contributed to this memory
  lastReinforcedAt: string; // timestamp of last reinforcement
  decayFactor: number;  // calculated: confidence * (1 - days_since_reinforced / ttl)
}
```

### 3.2 Memory Extraction — Enhanced

**Current:** MemoryExtractor extracts after story generation (basic).

**Enhanced flow:**
1. **From story content** — extract mentioned themes, characters, settings
2. **From feedback** — if parent rates "phù hợp" (4-5) for a theme → reinforce memory
3. **From repeated topics** — if child gets 3+ stories on "khủng long" → boost confidence
4. **From form input** — parent explicitly sets interests/preferredCharacters → high confidence

### 3.3 Memory Context Injection

```python
# Engine/core/prompts/registry.py
def build_memory_context(memories: list[dict]) -> str:
    """Build a natural-language memory summary for prompt injection."""
    if not memories:
        return ""

    lines = []
    interests = [m for m in memories if m['type'] == 'interest']
    behaviors = [m for m in memories if m['type'] == 'behavior']
    recent_themes = [m for m in memories if m['type'] == 'recent_theme']

    if interests:
        top = sorted(interests, key=lambda m: m['confidence'], reverse=True)[:3]
        lines.append(f"Child's known interests: {', '.join(m['value'] for m in top)}")

    if behaviors:
        lines.append(f"Notable behaviors: {behaviors[-1]['value']}")

    if recent_themes:
        lines.append(f"Recently enjoyed themes: {', '.join(m['value'] for m in recent_themes[-3:])}")

    return '\n'.join(lines)


# In assemble() — inject memory_context:
def assemble(self, age: int, data: dict) -> dict[str, str]:
    user_template = self.load_user()
    user_prompt = user_template.format(**data)

    # Build memory context section
    memories = data.get('memories', [])
    memory_context = build_memory_context(memories)
    if memory_context:
        user_prompt += f"\n\n{memory_context}"

    return {
        "system": self.load_system(),
        "developer": self.load_developer(age, data),
        "user": user_prompt,
    }
```

### 3.4 BE MemoryService — New Methods

```typescript
// BE/src/modules/memory/memory.service.ts — ADD

async getChildContext(childId: string, tenantId: string): Promise<MemoryContext> {
  const memories = await this.repo.find({
    where: { tenantId, childId },
    order: { confidence: 'DESC' },
    take: 50,
  });

  // Apply confidence decay
  const now = Date.now();
  const TTL_DAYS = 90;
  const processed = memories.map(m => ({
    ...m,
    confidence: this.applyDecay(m, now, TTL_DAYS),
  }));

  // Prune expired
  const expired = processed.filter(m => m.confidence <= 0);
  if (expired.length > 0) {
    await this.repo.remove(expired);
  }

  return {
    interests: processed.filter(m => m.type === 'interest' && m.confidence > 0.3),
    behaviors: processed.filter(m => m.type === 'behavior' && m.confidence > 0.3),
    preferences: processed.filter(m => m.type === 'preference' && m.confidence > 0.3),
    recentThemes: processed.filter(m => m.type === 'recent_theme').slice(-5),
    summary: this.buildSummary(processed),
  };
}

private applyDecay(memory: MemoryItem, now: number, ttlDays: number): number {
  if (!memory.lastReinforcedAt) return memory.confidence;
  const daysSince = (now - new Date(memory.lastReinforcedAt).getTime()) / 86400000;
  const decay = Math.max(0, 1 - (daysSince / ttlDays));
  return memory.confidence * decay;
}

async extractFromStory(story: any, childId: string, tenantId: string): Promise<void> {
  // Extract themes, characters, settings from story sections
  const sections = story.sections || [];
  const fullText = sections.map((s: any) => s.text || '').join(' ');

  // Simple keyword extraction (or use LLM-based extraction for better results)
  const themes = this.extractThemes(fullText);
  for (const theme of themes) {
    await this.reinforce(childId, tenantId, {
      type: 'interest',
      key: 'theme',
      value: theme,
      source: 'story_extract',
    });
  }
}

private async reinforce(
  childId: string,
  tenantId: string,
  input: { type: string; key: string; value: string; source: string }
): Promise<void> {
  const existing = await this.repo.findOne({
    where: { tenantId, childId, type: input.type, key: input.key, value: input.value },
  });
  if (existing) {
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    existing.lastReinforcedAt = new Date().toISOString();
    await this.repo.save(existing);
  } else {
    await this.repo.save({
      childId,
      tenantId,
      type: input.type,
      key: input.key,
      value: input.value,
      confidence: 0.5,
      source: input.source,
      lastReinforcedAt: new Date().toISOString(),
    });
  }
}
```

### 3.5 FE — Memory-Aware Personalization

**HomeScreen:** Show "Gợi ý cho bé" section dựa trên memory:
- "Bé {name} thường thích truyện về {theme} — tạo truyện mới nhé!"
- Quick-action buttons: "Truyện về khủng long" (nếu memory có interest=khủng long)

**FormScreen:** Show memory context badge:
```
🧠 Bé {name} đã thích: khủng long, công chúa
   Lần trước bé thích truyện "Cuộc phiêu lưu của khủng long Rex"
```

---

## 4. 4B — Prompt Quality & Story Structure

### 4.1 Enhanced Developer Templates

**Current developer/3-4.txt:**
- Basic age-appropriate guidance
- Simple story structure

**New developer/3-4.txt:**
- Richer story arc structure (opening → context → challenge → rising action → climax → resolution → moral)
- More specific Vietnamese language guidance (use of "bé", "con" appropriately)
- Interaction point design: natural pauses, open-ended questions
- Character development guidance for 3-4 age range

### 4.2 Enhanced Writer Prompt

**Current:** Writer receives outline + user data → generates sections.

**Enhanced:**
```
Story structure requirements:
1. Opening (2-3 paragraphs): Introduce main character, setting, and mood
2. Context (2-3 paragraphs): Build the world, establish character relationships
3. Challenge (3-4 paragraphs): Present the main problem/conflict
4. Rising action (2-3 paragraphs): Character attempts to solve, faces obstacles
5. Climax (2-3 paragraphs): Key moment of resolution
6. Resolution (2-3 paragraphs): Problem solved, lessons learned
7. Moral summary (1-2 paragraphs): Gentle lesson reinforcement

Each interaction point should:
- Be a natural pause in the story
- Ask the child a question about what they would do
- Reference the child's name
- Be written conversationally (as if parent speaking to child)
```

### 4.3 Reviewer — Stricter Quality Gates

**Current reviewer checks:**
- JSON schema validity
- Safety/blocklist
- Word count ≥ 100

**Enhanced reviewer checks:**
- Vietnamese language purity (no English words except proper names)
- Story structure completeness (all required sections present)
- Minimum section depth (>1 paragraph per section)
- Interaction point quality (natural-sounding, age-appropriate)
- Moral clarity (lesson should be explicit enough for parent to discuss)

### 4.4 User Prompt — Memory-Aware

**Current user/default.txt:**
```
Child information:
- Name: {childName}
- Age: {age}
- Gender: {gender}
- Theme: {theme}
- Lesson goal: {goal}
- Mood: {mood}
- Favorite character: {favoriteCharacter}
- Memory context: {memories}
```

**Enhanced user/default.txt:**
```
Child information:
- Name: {childName}
- Age: {age}
- Gender: {gender}
- Theme: {theme}
- Lesson goal: {goal}
- Mood: {mood}
- Favorite character: {favoriteCharacter}
- Known interests: {interests}
- Recent liked stories: {recentThemes}
- Behavioral notes: {behaviors}

Memory context:
{memoryContext}
```

---

## 5. 4C — Parent Analytics Dashboard

### 5.1 BE Analytics Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/analytics/stories/:childId` | Story count, themes, avg word count |
| GET | `/analytics/feedback/:childId` | Aggregated feedback metrics |
| GET | `/analytics/memory/:childId` | Memory stats (top interests, confidence) |
| GET | `/analytics/overview` | All-child summary for tenant |

**Response shape:**
```typescript
interface StoryStats {
  total_stories: number;
  unique_themes: number;
  top_themes: { theme: string; count: number }[];
  stories_per_week: { week: string; count: number }[];
  avg_word_count: number;
  avg_interaction_count: number;
}

interface FeedbackStats {
  total_feedback: number;
  avg_rating: number;
  listened_complete_rate: number;  // percentage
  wants_more_rate: number;
  rating_distribution: { rating: number; count: number }[];
}
```

### 5.2 FE AnalyticsScreen

**New screen type:** `'analytics'` in `AppScreen`

**Layout:**
```
┌──────────────────────────────────────┐
│  ← Phân tích                          │
│                                       │
│  [Tab: An ▼]    [7 days ▼]           │
│                                       │
│  📊 Tổng quan                         │
│  ┌────────────────────────────────┐   │
│  │ Truyện đã tạo    ⭐ Đánh giá TB │   │
│  │      42            4.6/5       │   │
│  │ Đã nghe hết     ⏱ TB/truyện    │   │
│  │     85%             385 từ     │   │
│  └────────────────────────────────┘   │
│                                       │
│  📈 Xu hướng (7 ngày qua)             │
│  ┌────────────────────────────────┐   │
│  │  ██                             │   │
│  │  ██ ██                          │   │
│  │  ██ ██ ██    ██                 │   │
│  │  ██ ██ ██ ██ ██ ██ ██          │   │
│  │  T2 T3 T4 T5 T6 T7 CN          │   │
│  └────────────────────────────────┘   │
│                                       │
│  🎯 Chủ đề phổ biến                   │
│  ┌────────────────────────────────┐   │
│  │ Động vật        ██████████ 12   │   │
│  │ Công chúa       ████████  10    │   │
│  │ Phiêu lưu       ██████     7    │   │
│  │ Khủng long      ████       5    │   │
│  └────────────────────────────────┘   │
│                                       │
│  🧠 Memory Insights                   │
│  ┌────────────────────────────────┐   │
│  │ Sở thích nổi bật: khủng long   │   │
│  │ Nhân vật yêu thích: Gấu Pooh   │   │
│  │ Bài học thường chọn: Chia sẻ   │   │
│  └────────────────────────────────┘   │
└──────────────────────────────────────┘
```

**Components needed:**
- `AnalyticsScreen.tsx` — main screen
- `AnalyticsOverview.tsx` — KPI cards (total stories, avg rating, etc.)
- `AnalyticsTrendChart.tsx` — simple bar/line chart (CSS-based, no chart library)
- `AnalyticsTopics.tsx` — horizontal bar chart for topics
- `AnalyticsMemory.tsx` — memory insights display

**No external chart library.** Use pure CSS bars for simplicity:
```typescript
const TrendChart: React.FC<{ data: { label: string; value: number }[] }> = ({ data }) => {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-2 h-32">
      {data.map(d => (
        <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-indigo-500 rounded-t-md transition-all"
            style={{ height: `${(d.value / max) * 100}%` }}
          />
          <span className="text-[10px] opacity-70">{d.label}</span>
        </div>
      ))}
    </div>
  );
};
```

### 5.3 App.tsx Changes

```typescript
// Add new screen type
export type AppScreen = 'home' | 'form' | 'loading' | 'story' | 'feedback' | 'error' | 'profile' | 'analytics';

// Add isAnalyticsAvailable check (only show if children.length > 0)
// Add state
const [analyticsChildId, setAnalyticsChildId] = useState<string | null>(null);

// In header — add analytics button next to saved stories
```

---

## 6. BE Endpoints Summary

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/memory/context/:childId` | 🔴 new | Get child memory context with decay |
| POST | `/memory/extract` | 🔴 new | Extract memories from story |
| POST | `/memory/reinforce` | 🔴 new | Reinforce/update existing memory |
| GET | `/analytics/stories/:childId` | 🔴 new | Story statistics |
| GET | `/analytics/feedback/:childId` | 🔴 new | Feedback aggregation |
| GET | `/analytics/memory/:childId` | 🔴 new | Memory stats |
| GET | `/analytics/overview` | 🔴 new | Multi-child summary |

**Existing endpoints remain unchanged.**

---

## 7. Config Changes

### BE .env — new vars
```env
MEMORY_TTL_DAYS=90          # Memory decay time-to-live
MEMORY_CONFIDENCE_BOOST=0.1 # Increment per reinforcement
MEMORY_EXTRACT_ENABLED=true  # Toggle memory extraction from stories
```

### Engine .env — no new vars (prompts updated in templates)

### FE .env — no new vars

---

## 8. Error & Edge Cases

| Scenario | Handling |
|----------|----------|
| No memories yet (new child) | Show empty state, skip memory context in prompt |
| Memory confidence too low | Don't inject into prompt (threshold: 0.3) |
| Analytics no data | Show "Chưa có dữ liệu" placeholders |
| BE offline on analytics | Show localStorage-based stats (saved stories count) |
| Memory extraction race condition | Upsert pattern (findOrCreate) |
| Story with no extractable themes | Skip extraction gracefully |
| Too many memories | Top 50 by confidence, prune rest |

---

## 9. Files Changed Summary

| File | Change |
|------|--------|
| **BE** | |
| `BE/src/modules/memory/memory.service.ts` | Major: add getChildContext, applyDecay, extractFromStory, reinforce |
| `BE/src/modules/memory/memory.entity.ts` | Add source, contextIds, lastReinforcedAt, decayFactor |
| `BE/src/modules/memory/memory.controller.ts` | Add context/extract/reinforce endpoints |
| `BE/src/modules/analytics/analytics.module.ts` | **NEW** |
| `BE/src/modules/analytics/analytics.service.ts` | **NEW** — aggregation queries |
| `BE/src/modules/analytics/analytics.controller.ts` | **NEW** — stats endpoints |
| `BE/src/modules/memory/__tests__/memory.service.spec.ts` | Add test for decay, context, extract |
| `BE/src/modules/analytics/__tests__/analytics.service.spec.ts` | **NEW** |
| **Engine** | |
| `Engine/core/prompts/templates/developer/3-4.txt` | Enhanced: richer arc, better language |
| `Engine/core/prompts/templates/developer/5-6.txt` | Enhanced: richer arc, better language |
| `Engine/core/prompts/templates/user/default.txt` | Add interests/behaviors/memoryContext |
| `Engine/core/prompts/registry.py` | Add build_memory_context(), enhanced assemble() |
| `Engine/core/pipeline.py` | Enhance planner prompt, stricter reviewer |
| `Engine/core/validator.py` | Add Vietnamese purity check, section depth check |
| `Engine/tests/test_validator.py` | Add tests for new validations |
| `Engine/tests/test_prompt_registry.py` | Add tests for memory context injection |
| **FE** | |
| `FE/src/types.ts` | Add 'analytics' screen type, AnalyticsData interfaces |
| `FE/src/App.tsx` | Add analytics state, screen routing, header button |
| `FE/src/components/AnalyticsScreen.tsx` | **NEW** — main analytics dashboard |
| `FE/src/components/AnalyticsOverview.tsx` | **NEW** — KPI cards |
| `FE/src/components/AnalyticsTrendChart.tsx` | **NEW** — CSS bar chart |
| `FE/src/components/AnalyticsTopics.tsx` | **NEW** — topic distribution |
| `FE/src/components/AnalyticsMemory.tsx` | **NEW** — memory insights |
| `FE/src/components/HomeScreen.tsx` | Add memory-based suggestions section |
| `FE/src/components/FormScreen.tsx` | Add memory context badge |
| `FE/src/components/Header.tsx` | Add analytics button (if children exist) |
| `FE/src/utils/analyticsClient.ts` | **NEW** — BE analytics API wrapper |

---

## 10. Testing Strategy

| Layer | Test Type | Coverage |
|-------|-----------|----------|
| BE unit | MemoryService | Decay algorithm, confidence calculation, extract/reinforce |
| BE unit | AnalyticsService | Aggregation queries, empty state |
| Engine unit | PromptRegistry | Memory context injection, enhanced templates |
| Engine unit | Validator | Vietnamese purity, section depth, quality gates |
| Engine unit | Pipeline | Planner prompt format, reviewer strictness |
| FE unit | AnalyticsScreen | Renders with/without data, child selector |
| FE unit | HomeScreen | Memory suggestions section |
| Integration | BE endpoints | GET /memory/context, GET /analytics/stories |

---

## 11. Implementation Order

### Phase 4A: Memory-Driven Personalization
1. Memory entity expansion (source, lastReinforcedAt, decayFactor)
2. MemoryService — getChildContext with decay algorithm
3. MemoryService — extractFromStory + reinforce methods
4. MemoryController — new endpoints (context/extract/reinforce)
5. Engine PromptRegistry — build_memory_context() + injection
6. Engine user/default.txt — memory-aware fields
7. FE FormScreen — memory context badge
8. FE HomeScreen — memory-based suggestions

### Phase 4B: Prompt Quality & Story Structure
9. Enhanced developer/3-4.txt
10. Enhanced developer/5-6.txt
11. Planner prompt — richer outline structure
12. Writer prompt — enhanced section requirements
13. Reviewer — Vietnamese purity + section depth checks
14. Validator — new quality gate tests

### Phase 4C: Parent Analytics Dashboard
15. BE AnalyticsService — aggregation queries
16. BE AnalyticsController — stats endpoints
17. FE analyticsClient.ts
18. FE AnalyticsOverview — KPI cards
19. FE AnalyticsTrendChart — CSS bar chart
20. FE AnalyticsTopics — topic distribution
21. FE AnalyticsMemory — memory insights
22. FE AnalyticsScreen — main wiring
23. FE App.tsx — routing + header button

---

## 12. Summary

| Phase | Tasks | Files Touched | Focus |
|-------|-------|---------------|-------|
| 4A | 8 | ~12 files | Memory personalization engine |
| 4B | 6 | ~6 files | Prompt & story quality |
| 4C | 9 | ~12 files | Parent analytics dashboard |
| **Total** | **23** | **~30 files** | |
