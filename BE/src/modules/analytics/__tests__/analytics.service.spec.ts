import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AnalyticsService } from '../analytics.service';
import { Story } from '../../story/entities/story.entity';
import { Feedback } from '../../feedback/entities/feedback.entity';
import { MemoryItem } from '../../memory/entities/memory-item.entity';
import { Tenant } from '../../tenant/entities/tenant.entity';
import { ChildProfile } from '../../child/entities/child-profile.entity';
import { ChildService } from '../../child/child.service';
import { vietnamDateBoundaryUtc, vietnamDateKey } from '../../../common/time/vietnam-time';
import { openTestDataSource, closeTestDataSource } from '../../../common/__tests__/test-db';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    const module = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getDataSourceToken('core'), useValue: dataSource },
        {
          provide: getRepositoryToken(Story, 'core'),
          useFactory: (ds: DataSource) => ds.getRepository(Story),
          inject: [getDataSourceToken('core')],
        },
        {
          provide: getRepositoryToken(Feedback, 'core'),
          useFactory: (ds: DataSource) => ds.getRepository(Feedback),
          inject: [getDataSourceToken('core')],
        },
        {
          provide: getRepositoryToken(MemoryItem, 'core'),
          useFactory: (ds: DataSource) => ds.getRepository(MemoryItem),
          inject: [getDataSourceToken('core')],
        },
        {
          provide: ChildService,
          useValue: {
            findById: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();
    service = module.get(AnalyticsService);
  });

  afterAll(async () => {
    await closeTestDataSource(dataSource);
  });

  describe('getStoryStats', () => {
    it('empty state', async () => {
      const stats = await service.getStoryStats('c1', 't1');
      expect(stats.total_stories).toBe(0);
      expect(stats.unique_themes).toBe(0);
      expect(stats.top_themes).toEqual([]);
      expect(stats.stories_per_day).toHaveLength(7);
      expect(stats.stories_per_day.every(d => d.count === 0)).toBe(true);
      expect(stats.avg_word_count).toBe(0);
    });

    it('with seeded data', async () => {
      // Real inserts get 'YYYY-MM-DD HH:MM:SS' (no 'T'/'Z'/millis) from the
      // migrations' now() default -- match that shape here, not toISOString().
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await dataSource.manager.save(Story, {
        storyId: 'story-1',
        tenantId: 't1',
        childId: 'c1',
        theme: 'khủng long',
        wordCount: 200,
        isFallback: 0,
        createdAt: nowStr,
        title: 'Story 1',
        content: 'Content 1',
        safetyStatus: 'PENDING',
      });
      await dataSource.manager.save(Story, {
        storyId: 'story-2',
        tenantId: 't1',
        childId: 'c1',
        theme: 'công chúa',
        wordCount: 350,
        isFallback: 0,
        createdAt: nowStr,
        title: 'Story 2',
        content: 'Content 2',
        safetyStatus: 'PENDING',
      });
      await dataSource.manager.save(Story, {
        storyId: 'story-3',
        tenantId: 't1',
        childId: 'c1',
        theme: 'khủng long',
        wordCount: 150,
        isFallback: 0,
        createdAt: nowStr,
        title: 'Story 3',
        content: 'Content 3',
        safetyStatus: 'PENDING',
      });

      const stats = await service.getStoryStats('c1', 't1');
      expect(stats.total_stories).toBe(3);
      expect(stats.unique_themes).toBe(2);
      expect(stats.top_themes[0].theme).toBe('khủng long');
      expect(stats.top_themes[0].count).toBe(2);
      expect(stats.avg_word_count).toBeGreaterThan(200);
      expect(stats.stories_per_day).toHaveLength(7);
    });

    it('counts a story after Vietnam midnight in the Vietnam calendar day', async () => {
      const vietnamToday = vietnamDateKey(new Date());
      const vietnamMidnightUtc = new Date(
        `${vietnamDateBoundaryUtc(vietnamToday).replace(' ', 'T')}Z`,
      );
      const oneAmVietnam = new Date(vietnamMidnightUtc.getTime() + 60 * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);

      await dataSource.manager.save(Story, {
        storyId: 'story-vietnam-day',
        tenantId: 't-vietnam-day',
        childId: 'c-vietnam-day',
        theme: 'giờ Việt Nam',
        wordCount: 100,
        isFallback: 0,
        createdAt: oneAmVietnam,
        title: 'Vietnam day boundary',
        content: 'Content',
        safetyStatus: 'APPROVED',
      });

      const stats = await service.getStoryStats('c-vietnam-day', 't-vietnam-day');
      expect(stats.stories_per_day.at(-1)?.count).toBe(1);
    });
  });

  describe('getFeedbackStats', () => {
    it('empty state', async () => {
      const stats = await service.getFeedbackStats('c1', 't1');
      expect(stats.total_feedback).toBe(0);
      expect(stats.avg_rating).toBe(0);
      expect(stats.rating_distribution).toEqual([]);
    });

    it('with seeded data', async () => {
      // feedbacks.tenant_id / feedbacks.child_id carry real FKs on Postgres --
      // the old SQLite fixture only ever loaded Feedback, so this was never
      // enforced there. Seed the parent rows these fake ids point at.
      await dataSource.manager.save(Tenant, { tenantId: 't1' });
      await dataSource.manager.save(ChildProfile, { childId: 'c1', tenantId: 't1', childName: 'c1', age: 5 });
      await dataSource.manager.save(Feedback, {
        feedbackId: 'fb-1',
        tenantId: 't1',
        childId: 'c1',
        storyId: 'story-1',
        rating: 5,
        listenedComplete: 1,
        wantsMore: 1,
        suitable: 1,
        createdAt: '2024-01-01 00:00:00',
      });
      await dataSource.manager.save(Feedback, {
        feedbackId: 'fb-2',
        tenantId: 't1',
        childId: 'c1',
        storyId: 'story-2',
        rating: 4,
        listenedComplete: 1,
        wantsMore: 0,
        suitable: 1,
        createdAt: '2024-01-02 00:00:00',
      });
      await dataSource.manager.save(Feedback, {
        feedbackId: 'fb-3',
        tenantId: 't1',
        childId: 'c1',
        storyId: 'story-3',
        rating: 3,
        listenedComplete: 0,
        wantsMore: 0,
        suitable: 0,
        createdAt: '2024-01-03 00:00:00',
      });

      const stats = await service.getFeedbackStats('c1', 't1');
      expect(stats.total_feedback).toBe(3);
      expect(stats.avg_rating).toBe(4);
      expect(stats.listened_complete_rate).toBeCloseTo(67, 0);
      expect(stats.wants_more_rate).toBeCloseTo(33, 0);
      expect(stats.rating_distribution).toHaveLength(3);
      expect(stats.rating_distribution[0].rating).toBe(3);
      expect(stats.rating_distribution[1].rating).toBe(4);
      expect(stats.rating_distribution[2].rating).toBe(5);
    });
  });

  describe('getMemoryStats', () => {
    it('empty state', async () => {
      const stats = await service.getMemoryStats('c1', 't1');
      expect(stats.top_interests).toEqual([]);
      expect(stats.top_characters).toEqual([]);
    });

    it('with seeded data', async () => {
      await dataSource.manager.save(MemoryItem, {
        memoryId: 'mem-1',
        tenantId: 't1',
        childId: 'c1',
        memoryType: 'interest',
        memoryKey: 'fav_theme',
        memoryValue: 'khủng long',
        confidence: 0.9,
        isActive: 1,
        createdAt: '2024-01-01 00:00:00',
      });
      await dataSource.manager.save(MemoryItem, {
        memoryId: 'mem-2',
        tenantId: 't1',
        childId: 'c1',
        memoryType: 'interest',
        memoryKey: 'fav_theme',
        memoryValue: 'khủng long',
        confidence: 0.8,
        isActive: 1,
        createdAt: '2024-01-02 00:00:00',
      });
      await dataSource.manager.save(MemoryItem, {
        memoryId: 'mem-3',
        tenantId: 't1',
        childId: 'c1',
        memoryType: 'preference',
        memoryKey: 'liked_character',
        memoryValue: 'Gấu Pooh',
        confidence: 0.7,
        isActive: 1,
        createdAt: '2024-01-03 00:00:00',
      });

      const stats = await service.getMemoryStats('c1', 't1');
      expect(stats.top_interests).toHaveLength(2);
      expect(stats.top_interests[0].value).toBe('khủng long');
      expect(stats.top_characters).toContain('Gấu Pooh');
    });
  });
});
