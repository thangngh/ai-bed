# Phase 4C Spec — Parent Analytics Dashboard

> **Date:** 2026-07-30
> **Status:** Draft
> **Scope:** BE aggregation endpoints + FE AnalyticsScreen cho phụ huynh xem thống kê story, feedback, memory insights per child

---

## 1. Overview

Phase 4C là phần cuối của Phase 4 (original scope): thêm analytics dashboard cho phụ huynh.

**4A (Memory Personalization)** — built as Phase 5
**4B (Prompt Quality)** — built
**4C (Parent Analytics Dashboard)** — this spec

**Key decisions:**
- Không real-time — data từ TypeORM aggregation queries
- Không chart library — CSS bars thuần
- localStorage fallback khi BE offline
- Child selector dropdown trong AnalyticsScreen (không dùng modal)
- FE silent-fail trên analytics API errors

---

## 2. BE Analytics Endpoints

### 2.1 Module Structure

New module: `AnalyticsModule` với 3 files:

| File | Purpose |
|------|---------|
| `BE/src/modules/analytics/analytics.module.ts` | Module declaration |
| `BE/src/modules/analytics/analytics.service.ts` | 4 aggregation methods |
| `BE/src/modules/analytics/analytics.controller.ts` | 4 GET endpoints |

### 2.2 Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/analytics/stories/:childId` | Story count, themes, avg word count, per-week trends |
| GET | `/analytics/feedback/:childId` | Aggregated feedback metrics |
| GET | `/analytics/memory/:childId` | Memory stats (top interests, confidence) |
| GET | `/analytics/overview` | All-child summary for tenant |

### 2.3 Response Types

```typescript
// Used by analyticsClient.ts on FE
interface StoryStats {
  total_stories: number;
  unique_themes: number;
  top_themes: { theme: string; count: number }[];
  stories_per_day: { day: string; count: number }[];
  avg_word_count: number;
  avg_interaction_count: number;
}

interface FeedbackStats {
  total_feedback: number;
  avg_rating: number;
  listened_complete_rate: number;  // percentage 0-100
  wants_more_rate: number;         // percentage 0-100
  rating_distribution: { rating: number; count: number }[];
}

interface MemoryStats {
  top_interests: { value: string; confidence: number }[];
  top_characters: string[];
  common_goals: { goal: string; count: number }[];
}

interface OverviewStats {
  children: {
    childId: string;
    childName: string;
    total_stories: number;
    avg_rating: number | null;
    last_active: string | null;
  }[];
  total_stories: number;
  total_children: number;
}
```

### 2.4 Aggregation Logic

**StoryStats:** Query `Story` entity bằng `childId`, group by `theme` và date (ISO week). Count + avg operations.

**FeedbackStats:** Query `Feedback` entity bằng `story.childId` (join). Rating distribution group by rating value. Listened_complete_rate = (listened_count / total) * 100.

**MemoryStats:** Query `MemoryItem` entity bằng `childId`. Top interests = distinct `value` với confidence cao nhất. Top characters = inferences from memories. Common goals = from story data.

**Overview:** Query all children thuộc tenant, lấy story count per child + latest feedback rating.

### 2.5 BE Dependencies

- `Story` entity (local.db) — `tenantId`, `childId`, `theme`, `wordCount`, `createdAt`
- `Feedback` entity (core.db) — `storyId`, `rating`, `listenedComplete`, `wantsMore`
- `MemoryItem` entity (local.db) — `childId`, `type`, `value`, `confidence`

---

## 3. FE AnalyticsScreen

### 3.1 Component Tree

```
AnalyticsScreen.tsx
├── Child dropdown (inline select)
├── AnalyticsOverview.tsx      — KPI cards
├── AnalyticsTrendChart.tsx    — CSS bar chart
├── AnalyticsTopics.tsx        — topic distribution
└── AnalyticsMemory.tsx        — memory insights
```

### 3.2 AnalyticsScreen

```tsx
export const AnalyticsScreen: React.FC<{
  children: ChildProfile[];
  activeChild: ChildProfile | null;
  onBack: () => void;
  isNightMode: boolean;
}>;
```

**State management:**
- `selectedChildId` — từ dropdown (default = activeChild?.childId)
- `storyStats`, `feedbackStats`, `memoryStats` — fetched on mount & on child change
- `loading` — boolean
- `error` — if API fails

**Child dropdown:** Inline `<select>` styled giống các component khác, liệt kê tất cả children. Mặc định = `activeChild`. Khi đổi child → refetch stats từ per-child endpoints. Overview endpoint dùng riêng cho multi-child snapshot (deferred từ UI).

**Layout:**
```
┌──────────────────────────────────────┐
│  ← Phân tích                          │
│                                       │
│  [Chọn bé: An ▼]                      │
│                                       │
│  📊 Tổng quan                         │
│  ┌──────────────┬──────────────┐      │
│  │ Truyện đã tạo│ ⭐ Đánh giá TB│      │
│  │      42      │    4.6/5     │      │
│  ├──────────────┼──────────────┤      │
│  │ Đã nghe hết  │ ⏱ TB/truyện │      │
│  │     85%      │    385 từ    │      │
│  └──────────────┴──────────────┘      │
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

### 3.3 AnalyticsOverview

4 KPI cards in 2x2 grid:
- **Truyện đã tạo** — `storyStats.total_stories`
- **Đánh giá TB** — `feedbackStats.avg_rating` / 5
- **Đã nghe hết** — `feedbackStats.listened_complete_rate`%
- **TB/truyện** — `storyStats.avg_word_count` từ

Each card: icon + label + value. Màu sắc theo theme.

### 3.4 AnalyticsTrendChart

CSS bars for 7 ngày gần nhất (lấy từ `stories_per_day`, BE query GROUP BY date):

```tsx
const TrendChart: React.FC<{
  data: { day: string; count: number }[];
  isNightMode: boolean;
}> = ({ data, isNightMode }) => {
  const max = Math.max(...data.map(d => d.count), 1);
  // Map day labels: Mon, Tue, Wed, Thu, Fri, Sat, Sun → T2, T3, T4, T5, T6, T7, CN
  const dayLabel = (day: string) => {
    const map: Record<string, string> = {
      'Mon': 'T2', 'Tue': 'T3', 'Wed': 'T4', 'Thu': 'T5',
      'Fri': 'T6', 'Sat': 'T7', 'Sun': 'CN',
    };
    return map[day] || day;
  };
  return (
    <div className="flex items-end gap-2 h-32">
      {data.map(d => (
        <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-indigo-500 rounded-t-md transition-all"
            style={{ height: `${(d.count / max) * 100}%` }}
          />
          <span className="text-[10px] opacity-70">{dayLabel(d.day)}</span>
        </div>
      ))}
    </div>
  );
};
```

### 3.5 AnalyticsTopics

Horizontal bar chart:
```tsx
const max = Math.max(...data.map(d => d.count), 1);
data.map(d => (
  <div className="flex items-center gap-2">
    <span className="w-24 text-sm truncate">{d.theme}</span>
    <div className="flex-1 h-6 rounded bg-slate-700/30">
      <div className="h-full rounded bg-indigo-500" style={{ width: `${(d.count / max) * 100}%` }} />
    </div>
    <span className="w-8 text-right text-sm">{d.count}</span>
  </div>
));
```

### 3.6 AnalyticsMemory

Display text-based (no charts):
```
Top interests: khủng long, công chúa
Favorite characters: Gấu Pooh, Elsa
Common lesson goals: Chia sẻ, Dũng cảm
```

3 `<p>` tags with icon + label, hoặc empty state "Chưa có dữ liệu".

### 3.7 App.tsx Changes

```typescript
// types.ts — add
export type AppScreen = 'home' | 'form' | 'loading' | 'story' | 'feedback' | 'error' | 'profile' | 'analytics';

// App.tsx — add state
const [analyticsChildId, setAnalyticsChildId] = useState<string | null>(null);

// App.tsx — routing
{currentScreen === 'analytics' && (
  <AnalyticsScreen
    children={children}
    activeChild={activeChild}
    onBack={() => setCurrentScreen('home')}
    isNightMode={isNightMode}
  />
)}

// Header.tsx — add analytics button next to saved stories button
```

### 3.8 analyticsClient.ts

```typescript
// FE/src/utils/analyticsClient.ts
import { apiClient } from './api';

export const analyticsClient = {
  getStoryStats: (childId: string) =>
    apiClient<StoryStats>(`/analytics/stories/${childId}`),

  getFeedbackStats: (childId: string) =>
    apiClient<FeedbackStats>(`/analytics/feedback/${childId}`),

  getMemoryStats: (childId: string) =>
    apiClient<MemoryStats>(`/analytics/memory/${childId}`),

  getOverview: () =>
    apiClient<OverviewStats>('/analytics/overview'),
};
```

---

## 4. Error & Edge Cases

| Scenario | Handling |
|----------|----------|
| No data (new child) | Show "Chưa có dữ liệu" placeholders per section |
| BE offline | FE fallback: tính stats cơ bản từ `localStorage` savedStories + feedbacks |
| Child has stories but no feedback | Feedback section = "Chưa có đánh giá" |
| >20 themes | Top 10 by count |
| Single child tenant | Dropdown shows 1 option, auto-selected |
| Child deleted/missing | Dropdown shows empty, all sections = "Chưa có dữ liệu" |
| API partial failure (stories works, feedback fails) | Show available data + warning per section |
| No memory data | Memory section = "Chưa có dữ liệu" |

---

## 5. Files Changed Summary

| File | Change |
|------|--------|
| **BE** | |
| `BE/src/modules/analytics/analytics.module.ts` | **NEW** |
| `BE/src/modules/analytics/analytics.service.ts` | **NEW** — 4 aggregation methods |
| `BE/src/modules/analytics/analytics.controller.ts` | **NEW** — 4 GET endpoints |
| `BE/src/modules/analytics/__tests__/analytics.service.spec.ts` | **NEW** |
| `BE/src/app.module.ts` | Import AnalyticsModule |
| **FE** | |
| `FE/src/types.ts` | Add `'analytics'` to AppScreen, add analytics interfaces |
| `FE/src/App.tsx` | Add analytics state, screen routing, header button |
| `FE/src/components/AnalyticsScreen.tsx` | **NEW** — main screen |
| `FE/src/components/AnalyticsOverview.tsx` | **NEW** — KPI cards |
| `FE/src/components/AnalyticsTrendChart.tsx` | **NEW** — CSS bar chart |
| `FE/src/components/AnalyticsTopics.tsx` | **NEW** — topic horizontal bars |
| `FE/src/components/AnalyticsMemory.tsx` | **NEW** — memory insights |
| `FE/src/components/Header.tsx` | Add analytics button |
| `FE/src/utils/analyticsClient.ts` | **NEW** — 4 API wrappers |

---

## 6. Testing Strategy

| Layer | File | Coverage |
|-------|------|----------|
| BE unit | `analytics.service.spec.ts` | StoryStats aggregation (seeded data), FeedbackStats (avg, distribution), MemoryStats (top interests), empty state |
| FE unit | AnalyticsScreen | Renders child dropdown, shows 4 sections, loading skeleton |
| FE unit | AnalyticsOverview | 4 KPI cards with/without data |
| FE unit | AnalyticsTrendChart | Bar rendering, empty state |
| FE unit | AnalyticsTopics | Horizontal bars, truncation for >10 themes |

---

## 7. Implementation Order

1. BE: AnalyticsModule + service + controller (4 endpoints)
2. BE: Unit tests for aggregation
3. FE: types.ts — add analytics interfaces + AppScreen update
4. FE: analyticsClient.ts — 4 API wrappers
5. FE: AnalyticsOverview (KPI cards)
6. FE: AnalyticsTrendChart (CSS bars)
7. FE: AnalyticsTopics (horizontal bars)
8. FE: AnalyticsMemory (text insights)
9. FE: AnalyticsScreen (main wiring + child dropdown)
10. FE: App.tsx routing + Header button
