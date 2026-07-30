# Phase 4C — Parent Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 BE aggregation endpoints and an FE AnalyticsScreen with KPI cards, trend chart, topic distribution, and memory insights.

**Architecture:** BE side: new `AnalyticsModule` with `AnalyticsService` (queries Story/Feedback/MemoryItem via TypeORM) and `AnalyticsController` (4 GET endpoints). FE side: 5 new components (AnalyticsScreen, AnalyticsOverview, AnalyticsTrendChart, AnalyticsTopics, AnalyticsMemory) + `analyticsClient.ts` API wrapper + routing in `App.tsx`.

**Tech Stack:** BE: NestJS 11, TypeORM (SQLite). FE: React 19, Tailwind CSS, pure CSS bars (no chart library).

## Global Constraints

- All BE endpoints require `X-Tenant-Id` header (middleware already applies)
- No new entity — query existing Story (local.db), Feedback (core.db), MemoryItem (local.db)
- No external chart library — CSS bars thuần
- FE silent-fail on API errors (show "Chưa có dữ liệu")
- Child selector = inline `<select>` dropdown within AnalyticsScreen
- BE module pattern: `module.ts` + `service.ts` + `controller.ts` + `__tests__/`

---

### Task 1: BE AnalyticsModule — Service + Controller

**Files:**
- Create: `BE/src/modules/analytics/analytics.module.ts`
- Create: `BE/src/modules/analytics/analytics.service.ts`
- Create: `BE/src/modules/analytics/analytics.controller.ts`
- Modify: `BE/src/app.module.ts` — import AnalyticsModule

**Interfaces:**
- Produces: 4 GET endpoints at `/analytics/stories/:childId`, `/analytics/feedback/:childId`, `/analytics/memory/:childId`, `/analytics/overview`
- Consumes: `Story` entity (local.db), `Feedback` entity (core.db), `MemoryItem` entity (local.db)

- [ ] **Step 1: Create module + service + controller boilerplate**

**analytics.module.ts:**
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { Story } from '../story/entities/story.entity';
import { Feedback } from '../feedback/entities/feedback.entity';
import { MemoryItem } from '../memory/entities/memory-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Story], 'local'),
    TypeOrmModule.forFeature([Feedback], 'core'),
    TypeOrmModule.forFeature([MemoryItem], 'local'),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
```

**analytics.service.ts:**
```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Story } from '../story/entities/story.entity';
import { Feedback } from '../feedback/entities/feedback.entity';
import { MemoryItem } from '../memory/entities/memory-item.entity';

export interface StoryStats {
  total_stories: number;
  unique_themes: number;
  top_themes: { theme: string; count: number }[];
  stories_per_day: { day: string; count: number }[];
  avg_word_count: number;
  avg_interaction_count: number;
}

export interface FeedbackStats {
  total_feedback: number;
  avg_rating: number;
  listened_complete_rate: number;
  wants_more_rate: number;
  rating_distribution: { rating: number; count: number }[];
}

export interface MemoryStats {
  top_interests: { value: string; confidence: number }[];
  top_characters: string[];
  common_goals: { goal: string; count: number }[];
}

export interface OverviewStats {
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

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Story, 'local')
    private storyRepo: Repository<Story>,
    @InjectRepository(Feedback, 'core')
    private feedbackRepo: Repository<Feedback>,
    @InjectRepository(MemoryItem, 'local')
    private memoryRepo: Repository<MemoryItem>,
  ) {}

  async getStoryStats(childId: string, tenantId: string): Promise<StoryStats> {
    const stories = await this.storyRepo.find({
      where: { tenantId, childId },
    });

    const themeCount = new Map<string, number>();
    for (const s of stories) {
      const theme = s.theme || 'Khác';
      themeCount.set(theme, (themeCount.get(theme) || 0) + 1);
    }

    const topThemes = [...themeCount.entries()]
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const now = new Date();
    const days: { day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayStr = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      const count = stories.filter(s => {
        const c = new Date(s.createdAt || '');
        return c >= dayStart && c < dayEnd;
      }).length;
      days.push({ day: dayStr, count });
    }

    const counts = stories.map(s => s.wordCount || 0).filter(Boolean);
    const avgWords = counts.length > 0
      ? Math.round(counts.reduce((a, b) => a + b, 0) / counts.length)
      : 0;

    return {
      total_stories: stories.length,
      unique_themes: themeCount.size,
      top_themes: topThemes,
      stories_per_day: days,
      avg_word_count: avgWords,
      avg_interaction_count: 0,
    };
  }

  async getFeedbackStats(childId: string, tenantId: string): Promise<FeedbackStats> {
    const feedbacks = await this.feedbackRepo.find({
      where: { tenantId, childId } as any,
    });

    const total = feedbacks.length;
    if (total === 0) {
      return {
        total_feedback: 0,
        avg_rating: 0,
        listened_complete_rate: 0,
        wants_more_rate: 0,
        rating_distribution: [],
      };
    }

    const ratings = feedbacks.map(f => (f as any).rating || 0);
    const avgRating = ratings.length > 0
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : 0;

    const listened = feedbacks.filter(f => (f as any).listenedComplete === 1);
    const listenedRate = Math.round((listened.length / total) * 100);

    const wantsMore = feedbacks.filter(f => (f as any).wantsMore === 1);
    const wantsMoreRate = Math.round((wantsMore.length / total) * 100);

    const distMap = new Map<number, number>();
    for (const r of ratings) {
      distMap.set(r, (distMap.get(r) || 0) + 1);
    }
    const distribution = [...distMap.entries()]
      .map(([rating, count]) => ({ rating, count }))
      .sort((a, b) => a.rating - b.rating);

    return {
      total_feedback: total,
      avg_rating: avgRating,
      listened_complete_rate: listenedRate,
      wants_more_rate: wantsMoreRate,
      rating_distribution: distribution,
    };
  }

  async getMemoryStats(childId: string, tenantId: string): Promise<MemoryStats> {
    const memories = await this.memoryRepo.find({
      where: { tenantId, childId },
      order: { confidence: 'DESC' as const },
    });

    const interests = (memories as any[])
      .filter(m => m.memoryType === 'interest' && m.confidence > 0.3)
      .slice(0, 5)
      .map(m => ({ value: m.memoryValue, confidence: m.confidence }));

    const characters = (memories as any[])
      .filter(m => m.memoryType === 'preference' && m.memoryKey === 'liked_character')
      .slice(0, 5)
      .map(m => m.memoryValue);

    return {
      top_interests: interests,
      top_characters: characters,
      common_goals: [],
    };
  }

  async getOverview(tenantId: string): Promise<OverviewStats> {
    const stories = await this.storyRepo.find({ where: { tenantId } });
    const childStoryMap = new Map<string, any[]>();
    for (const s of stories) {
      const childId = (s as any).childId;
      if (!childStoryMap.has(childId)) childStoryMap.set(childId, []);
      childStoryMap.get(childId)!.push(s);
    }

    const childIds = [...childStoryMap.keys()];
    const children = childIds.map(childId => {
      const s = childStoryMap.get(childId)!;
      const sorted = [...s].sort(
        (a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
      );
      return {
        childId,
        childName: childId,
        total_stories: s.length,
        avg_rating: null,
        last_active: sorted.length > 0 ? sorted[0].createdAt || null : null,
      };
    });

    return {
      children,
      total_stories: stories.length,
      total_children: children.length,
    };
  }
}
```

- [ ] **Step 2: Create controller**

**analytics.controller.ts:**
```typescript
import { Controller, Get, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('stories/:childId')
  async getStoryStats(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.analyticsService.getStoryStats(childId, tenantId);
  }

  @Get('feedback/:childId')
  async getFeedbackStats(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.analyticsService.getFeedbackStats(childId, tenantId);
  }

  @Get('memory/:childId')
  async getMemoryStats(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.analyticsService.getMemoryStats(childId, tenantId);
  }

  @Get('overview')
  async getOverview(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.analyticsService.getOverview(tenantId);
  }
}
```

- [ ] **Step 3: Import in AppModule**

In `BE/src/app.module.ts`, add import:
```typescript
import { AnalyticsModule } from './modules/analytics/analytics.module';

// In @Module imports array, add:
AnalyticsModule,
```

- [ ] **Step 4: Run BE build to verify**

Run: `cd BE; npm run build`
Expected: Compiles without errors

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add analytics module with 4 aggregation endpoints"
```

---

### Task 2: BE Analytics — Unit Tests

**Files:**
- Create: `BE/src/modules/analytics/__tests__/analytics.service.spec.ts`

**Interfaces:**
- Consumes: `AnalyticsService` (from Task 1) — 4 getter methods
- Produces: Test coverage for: StoryStats aggregation, FeedbackStats aggregation, MemoryStats, empty states

- [ ] **Step 1: Write the test file**

```typescript
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AnalyticsService } from '../analytics.service';
import { Story } from '../../story/entities/story.entity';
import { Feedback } from '../../feedback/entities/feedback.entity';
import { MemoryItem } from '../../memory/entities/memory-item.entity';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let localDs: DataSource;
  let coreDs: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        {
          provide: getDataSourceToken('local'),
          useFactory: async () => {
            const ds = new DataSource({
              type: 'sqlite',
              database: ':memory:',
              entities: [Story, MemoryItem],
              synchronize: true,
            });
            await ds.initialize();
            return ds;
          },
        },
        {
          provide: getDataSourceToken('core'),
          useFactory: async () => {
            const ds = new DataSource({
              type: 'sqlite',
              database: ':memory:',
              entities: [Feedback],
              synchronize: true,
            });
            await ds.initialize();
            return ds;
          },
        },
      ],
    }).compile();
    service = module.get(AnalyticsService);
    localDs = module.get(getDataSourceToken('local'));
    coreDs = module.get(getDataSourceToken('core'));
  });

  afterAll(async () => {
    await localDs.destroy();
    await coreDs.destroy();
  });

  it('getStoryStats empty state', async () => {
    const stats = await service.getStoryStats('child-none', 'tenant-1');
    expect(stats.total_stories).toBe(0);
    expect(stats.unique_themes).toBe(0);
    expect(stats.top_themes).toEqual([]);
    expect(stats.stories_per_day).toHaveLength(7);
    expect(stats.avg_word_count).toBe(0);
  });

  it('getStoryStats with seeded data', async () => {
    const storyRepo = localDs.getRepository(Story);
    const now = new Date();
    await storyRepo.save([
      { storyId: 's1', tenantId: 't1', childId: 'c1', theme: 'khủng long', wordCount: 200, createdAt: now.toISOString(), title: 'Story 1', content: '[]', safetyStatus: 'APPROVED', isFallback: 0 },
      { storyId: 's2', tenantId: 't1', childId: 'c1', theme: 'công chúa', wordCount: 350, createdAt: now.toISOString(), title: 'Story 2', content: '[]', safetyStatus: 'APPROVED', isFallback: 0 },
      { storyId: 's3', tenantId: 't1', childId: 'c1', theme: 'khủng long', wordCount: 150, createdAt: now.toISOString(), title: 'Story 3', content: '[]', safetyStatus: 'APPROVED', isFallback: 0 },
    ]);

    const stats = await service.getStoryStats('c1', 't1');
    expect(stats.total_stories).toBe(3);
    expect(stats.unique_themes).toBe(2);
    expect(stats.top_themes).toHaveLength(2);
    expect(stats.top_themes[0].theme).toBe('khủng long');
    expect(stats.top_themes[0].count).toBe(2);
    expect(stats.avg_word_count).toBeGreaterThan(200);
    expect(stats.stories_per_day).toHaveLength(7);
  });

  it('getFeedbackStats empty state', async () => {
    const stats = await service.getFeedbackStats('c-none', 't1');
    expect(stats.total_feedback).toBe(0);
    expect(stats.avg_rating).toBe(0);
    expect(stats.rating_distribution).toEqual([]);
  });

  it('getFeedbackStats with seeded data', async () => {
    const feedbackRepo = coreDs.getRepository(Feedback);
    await feedbackRepo.save([
      { feedbackId: 'f1', tenantId: 't1', childId: 'c1', storyId: 's1', rating: 5, listenedComplete: 1, wantsMore: 1 },
      { feedbackId: 'f2', tenantId: 't1', childId: 'c1', storyId: 's2', rating: 4, listenedComplete: 1, wantsMore: 0 },
      { feedbackId: 'f3', tenantId: 't1', childId: 'c1', storyId: 's3', rating: 3, listenedComplete: 0, wantsMore: 0 },
    ]);

    const stats = await service.getFeedbackStats('c1', 't1');
    expect(stats.total_feedback).toBe(3);
    expect(stats.avg_rating).toBe(4);
    expect(stats.listened_complete_rate).toBe(67);
    expect(stats.wants_more_rate).toBe(33);
    expect(stats.rating_distribution).toHaveLength(3);
  });

  it('getMemoryStats empty state', async () => {
    const stats = await service.getMemoryStats('c-none', 't1');
    expect(stats.top_interests).toEqual([]);
    expect(stats.top_characters).toEqual([]);
  });

  it('getMemoryStats with seeded data', async () => {
    const memRepo = localDs.getRepository(MemoryItem);
    await memRepo.save([
      { tenantId: 't1', childId: 'c1', memoryType: 'interest', memoryKey: 'fav_theme', memoryValue: 'khủng long', confidence: 0.9, isActive: 1 },
      { tenantId: 't1', childId: 'c1', memoryType: 'interest', memoryKey: 'fav_theme', memoryValue: 'công chúa', confidence: 0.7, isActive: 1 },
      { tenantId: 't1', childId: 'c1', memoryType: 'preference', memoryKey: 'liked_character', memoryValue: 'Gấu Pooh', confidence: 0.8, isActive: 1 },
    ]);

    const stats = await service.getMemoryStats('c1', 't1');
    expect(stats.top_interests).toHaveLength(2);
    expect(stats.top_interests[0].value).toBe('khủng long');
    expect(stats.top_characters).toContain('Gấu Pooh');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd BE; npm test -- analytics.service.spec`
Expected: 5 tests pass

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add analytics service unit tests"
```

---

### Task 3: FE — Types + analyticsClient

**Files:**
- Modify: `FE/src/types.ts` — add analytics interfaces + `'analytics'` to AppScreen
- Create: `FE/src/utils/analyticsClient.ts` — 4 API wrappers

**Interfaces:**
- Produces: Types used by all FE components in subsequent tasks
- Produces: `analyticsClient` used by AnalyticsScreen

- [ ] **Step 1: Update types.ts**

Add to `FE/src/types.ts`:
```typescript
export type AppScreen = 'home' | 'form' | 'loading' | 'story' | 'feedback' | 'error' | 'profile' | 'analytics';

export interface StoryStats {
  total_stories: number;
  unique_themes: number;
  top_themes: { theme: string; count: number }[];
  stories_per_day: { day: string; count: number }[];
  avg_word_count: number;
  avg_interaction_count: number;
}

export interface FeedbackStats {
  total_feedback: number;
  avg_rating: number;
  listened_complete_rate: number;
  wants_more_rate: number;
  rating_distribution: { rating: number; count: number }[];
}

export interface MemoryStats {
  top_interests: { value: string; confidence: number }[];
  top_characters: string[];
  common_goals: { goal: string; count: number }[];
}

export interface OverviewStats {
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

- [ ] **Step 2: Create analyticsClient.ts**

```typescript
import { apiClient } from './api';
import { StoryStats, FeedbackStats, MemoryStats, OverviewStats } from '../types';

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

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add analytics types and client"
```

---

### Task 4: FE — Analytics Sub-Components

**Files:**
- Create: `FE/src/components/AnalyticsOverview.tsx`
- Create: `FE/src/components/AnalyticsTrendChart.tsx`
- Create: `FE/src/components/AnalyticsTopics.tsx`
- Create: `FE/src/components/AnalyticsMemory.tsx`

**Interfaces:**
- Consumes: `StoryStats`, `FeedbackStats`, `MemoryStats` (from Task 3)
- Produces: 4 self-contained components used by AnalyticsScreen (Task 5)

- [ ] **Step 1: AnalyticsOverview.tsx**

4 KPI cards in 2x2 grid.

```typescript
import React from 'react';
import { BookOpen, Star, Headphones, FileText } from 'lucide-react';
import { StoryStats, FeedbackStats } from '../types';

interface AnalyticsOverviewProps {
  storyStats: StoryStats | null;
  feedbackStats: FeedbackStats | null;
  isNightMode: boolean;
}

export const AnalyticsOverview: React.FC<AnalyticsOverviewProps> = ({
  storyStats, feedbackStats, isNightMode,
}) => {
  const cards = [
    { icon: <BookOpen className="w-5 h-5" />, label: 'Truyện đã tạo', value: storyStats?.total_stories ?? 0, unit: '' },
    { icon: <Star className="w-5 h-5" />, label: 'Đánh giá TB', value: feedbackStats?.avg_rating ?? 0, unit: '/5' },
    { icon: <Headphones className="w-5 h-5" />, label: 'Đã nghe hết', value: feedbackStats?.listened_complete_rate ?? 0, unit: '%' },
    { icon: <FileText className="w-5 h-5" />, label: 'TB/truyện', value: storyStats?.avg_word_count ?? 0, unit: ' từ' },
  ];

  return (
    <section>
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
        <span>📊</span> Tổng quan
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {cards.map(card => (
          <div key={card.label} className={`p-4 rounded-2xl border ${
            isNightMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white/80 border-amber-200'
          }`}>
            <div className="flex items-center gap-2 text-xs opacity-70 mb-2">
              {card.icon}
              <span>{card.label}</span>
            </div>
            <div className="text-2xl font-extrabold">
              {card.value}{card.unit}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
```

- [ ] **Step 2: AnalyticsTrendChart.tsx**

CSS bars for 7 ngày gần nhất.

```typescript
import React from 'react';
import { StoryStats } from '../types';

interface AnalyticsTrendChartProps {
  storyStats: StoryStats | null;
  isNightMode: boolean;
}

const DAY_LABEL_MAP: Record<string, string> = {
  'Mon': 'T2', 'Tue': 'T3', 'Wed': 'T4', 'Thu': 'T5',
  'Fri': 'T6', 'Sat': 'T7', 'Sun': 'CN',
};

export const AnalyticsTrendChart: React.FC<AnalyticsTrendChartProps> = ({
  storyStats, isNightMode,
}) => {
  const data = storyStats?.stories_per_day ?? [];
  const max = Math.max(...data.map(d => d.count), 1);
  const hasData = data.some(d => d.count > 0);

  return (
    <section>
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
        <span>📈</span> Xu hướng (7 ngày qua)
      </h3>
      <div className={`p-4 rounded-2xl border ${
        isNightMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white/80 border-amber-200'
      }`}>
        {!hasData ? (
          <p className="text-sm opacity-60 text-center py-4">Chưa có dữ liệu</p>
        ) : (
          <div className="flex items-end gap-2 h-32">
            {data.map(d => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-indigo-500 rounded-t-md transition-all min-h-[4px]"
                  style={{ height: `${(d.count / max) * 100}%` }}
                />
                <span className="text-[10px] opacity-70">{DAY_LABEL_MAP[d.day] || d.day}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
```

- [ ] **Step 3: AnalyticsTopics.tsx**

Horizontal bar chart for theme distribution.

```typescript
import React from 'react';
import { StoryStats } from '../types';

interface AnalyticsTopicsProps {
  storyStats: StoryStats | null;
  isNightMode: boolean;
}

export const AnalyticsTopics: React.FC<AnalyticsTopicsProps> = ({
  storyStats, isNightMode,
}) => {
  const themes = storyStats?.top_themes ?? [];
  const max = Math.max(...themes.map(t => t.count), 1);

  return (
    <section>
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
        <span>🎯</span> Chủ đề phổ biến
      </h3>
      <div className={`p-4 rounded-2xl border space-y-3 ${
        isNightMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white/80 border-amber-200'
      }`}>
        {themes.length === 0 ? (
          <p className="text-sm opacity-60 text-center py-4">Chưa có dữ liệu</p>
        ) : themes.map(t => (
          <div key={t.theme} className="flex items-center gap-2">
            <span className="w-24 text-sm truncate shrink-0">{t.theme}</span>
            <div className={`flex-1 h-6 rounded ${
              isNightMode ? 'bg-slate-700/50' : 'bg-amber-100'
            }`}>
              <div
                className="h-full rounded bg-indigo-500 transition-all"
                style={{ width: `${(t.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right text-sm font-bold">{t.count}</span>
          </div>
        ))}
      </div>
    </section>
  );
};
```

- [ ] **Step 4: AnalyticsMemory.tsx**

Text-based memory insights.

```typescript
import React from 'react';
import { MemoryStats } from '../types';

interface AnalyticsMemoryProps {
  memoryStats: MemoryStats | null;
  isNightMode: boolean;
}

export const AnalyticsMemory: React.FC<AnalyticsMemoryProps> = ({
  memoryStats, isNightMode,
}) => {
  const hasInterests = memoryStats?.top_interests && memoryStats.top_interests.length > 0;
  const hasCharacters = memoryStats?.top_characters && memoryStats.top_characters.length > 0;
  const hasData = hasInterests || hasCharacters;

  if (!hasData) {
    return (
      <section>
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
          <span>🧠</span> Memory Insights
        </h3>
        <div className={`p-4 rounded-2xl border ${
          isNightMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white/80 border-amber-200'
        }`}>
          <p className="text-sm opacity-60 text-center py-4">Chưa có dữ liệu</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
        <span>🧠</span> Memory Insights
      </h3>
      <div className={`p-4 rounded-2xl border space-y-3 ${
        isNightMode ? 'bg-slate-800/60 border-slate-700' : 'bg-white/80 border-amber-200'
      }`}>
        {hasInterests && (
          <div className="flex items-start gap-2">
            <span className="text-lg">⭐</span>
            <div>
              <p className="text-xs opacity-70">Sở thích nổi bật</p>
              <p className="font-semibold">
                {memoryStats!.top_interests.map(i => i.value).join(', ')}
              </p>
            </div>
          </div>
        )}
        {hasCharacters && (
          <div className="flex items-start gap-2">
            <span className="text-lg">🎭</span>
            <div>
              <p className="text-xs opacity-70">Nhân vật yêu thích</p>
              <p className="font-semibold">
                {memoryStats!.top_characters.join(', ')}
              </p>
            </div>
          </div>
        )}
        {memoryStats?.common_goals && memoryStats.common_goals.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-lg">📖</span>
            <div>
              <p className="text-xs opacity-70">Bài học thường chọn</p>
              <p className="font-semibold">
                {memoryStats.common_goals.map(g => g.goal).join(', ')}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add 4 analytics sub-components (overview, trend, topics, memory)"
```

---

### Task 5: FE — AnalyticsScreen + App.tsx + Header Wiring

**Files:**
- Create: `FE/src/components/AnalyticsScreen.tsx` — main screen, child dropdown + 4 sub-components
- Modify: `FE/src/App.tsx` — add `'analytics'` routing, `analyticsChildId` state
- Modify: `FE/src/components/Header.tsx` — add analytics button

**Interfaces:**
- Consumes: `analyticsClient` (Task 3), 4 sub-components (Task 4), `ChildProfile[]`, `activeChild`
- Depends on: `AppScreen` having `'analytics'` (Task 3)

- [ ] **Step 1: Create AnalyticsScreen.tsx**

```typescript
import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ChildProfile, StoryStats, FeedbackStats, MemoryStats } from '../types';
import { analyticsClient } from '../utils/analyticsClient';
import { AnalyticsOverview } from './AnalyticsOverview';
import { AnalyticsTrendChart } from './AnalyticsTrendChart';
import { AnalyticsTopics } from './AnalyticsTopics';
import { AnalyticsMemory } from './AnalyticsMemory';

interface AnalyticsScreenProps {
  children: ChildProfile[];
  activeChild: ChildProfile | null;
  onBack: () => void;
  isNightMode: boolean;
}

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({
  children, activeChild, onBack, isNightMode,
}) => {
  const [selectedChildId, setSelectedChildId] = useState<string>(
    activeChild?.childId || (children.length > 0 ? children[0].childId : '')
  );
  const [storyStats, setStoryStats] = useState<StoryStats | null>(null);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedChildId) return;
    setLoading(true);
    Promise.all([
      analyticsClient.getStoryStats(selectedChildId).catch(() => null),
      analyticsClient.getFeedbackStats(selectedChildId).catch(() => null),
      analyticsClient.getMemoryStats(selectedChildId).catch(() => null),
    ]).then(([s, f, m]) => {
      setStoryStats(s);
      setFeedbackStats(f);
      setMemoryStats(m);
    }).finally(() => setLoading(false));
  }, [selectedChildId]);

  const nightBg = isNightMode ? 'bg-slate-950' : 'bg-amber-50/70';
  const nightText = isNightMode ? 'text-slate-100' : 'text-amber-950';
  const border = isNightMode ? 'border-slate-800' : 'border-amber-200/60';

  return (
    <div className={`space-y-6 ${nightText}`}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="font-extrabold text-lg">Phân tích</h2>
      </div>

      {/* Child Dropdown */}
      {children.length > 0 && (
        <select
          value={selectedChildId}
          onChange={(e) => setSelectedChildId(e.target.value)}
          className={`w-full p-3 rounded-2xl border text-sm font-semibold cursor-pointer ${
            isNightMode
              ? 'bg-slate-800 border-slate-700 text-slate-100'
              : 'bg-white border-amber-200 text-amber-950'
          }`}
        >
          {children.map(c => (
            <option key={c.childId} value={c.childId}>
              {c.childName} ({c.age} tuổi)
            </option>
          ))}
        </select>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-20 bg-slate-700/20 rounded-2xl" />
            <div className="h-32 bg-slate-700/20 rounded-2xl" />
            <div className="h-24 bg-slate-700/20 rounded-2xl" />
          </div>
        </div>
      )}

      {/* Content */}
      {!loading && !selectedChildId && (
        <div className="text-center py-16 opacity-60">
          <p className="text-lg mb-2">👶</p>
          <p>Chưa có hồ sơ bé nào</p>
          <p className="text-sm">Thêm hồ sơ để xem thống kê</p>
        </div>
      )}

      {!loading && selectedChildId && (
        <div className="space-y-6">
          <AnalyticsOverview
            storyStats={storyStats}
            feedbackStats={feedbackStats}
            isNightMode={isNightMode}
          />
          <AnalyticsTrendChart
            storyStats={storyStats}
            isNightMode={isNightMode}
          />
          <AnalyticsTopics
            storyStats={storyStats}
            isNightMode={isNightMode}
          />
          <AnalyticsMemory
            memoryStats={memoryStats}
            isNightMode={isNightMode}
          />
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Update App.tsx**

Add `'analytics'` to the routing:

```typescript
// In imports:
import { AnalyticsScreen } from './components/AnalyticsScreen';

// In App component, add state:
// (no new state needed — we use activeChild and children)

// In return, add routing after the profile route:
{currentScreen === 'analytics' && (
  <AnalyticsScreen
    children={children}
    activeChild={activeChild}
    onBack={() => setCurrentScreen('home')}
    isNightMode={isNightMode}
  />
)}
```

- [ ] **Step 3: Update Header.tsx**

Add analytics button next to the saved stories button:

```typescript
// In imports:
import { BarChart3 } from 'lucide-react';

// In the JSX, after the saved stories button and before the night mode toggle:
{/* Analytics Button */}
<button
  id="btn-header-analytics"
  onClick={() => setScreen('analytics')}
  className={`p-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all ${
    isNightMode
      ? 'bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200'
      : 'bg-amber-100/80 hover:bg-amber-200/60 border border-amber-200 text-amber-900'
  }`}
  title="Phân tích"
>
  <BarChart3 className="w-4 h-4 text-indigo-500" />
  <span className="hidden sm:inline">Phân tích</span>
</button>
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add analytics screen with child dropdown and header button"
```
