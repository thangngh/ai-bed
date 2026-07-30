import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AnalyticsService } from '../analytics.service';
import { Story } from '../../story/entities/story.entity';
import { StorySection } from '../../story/entities/story-section.entity';
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
              entities: [Story, StorySection, MemoryItem],
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
        {
          provide: getRepositoryToken(Story, 'local'),
          useFactory: (ds: DataSource) => ds.getRepository(Story),
          inject: [getDataSourceToken('local')],
        },
        {
          provide: getRepositoryToken(Feedback, 'core'),
          useFactory: (ds: DataSource) => ds.getRepository(Feedback),
          inject: [getDataSourceToken('core')],
        },
        {
          provide: getRepositoryToken(MemoryItem, 'local'),
          useFactory: (ds: DataSource) => ds.getRepository(MemoryItem),
          inject: [getDataSourceToken('local')],
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
      const now = new Date();
      await localDs.manager.save(Story, {
        storyId: 'story-1',
        tenantId: 't1',
        childId: 'c1',
        theme: 'khủng long',
        wordCount: 200,
        isFallback: 0,
        createdAt: now.toISOString(),
        title: 'Story 1',
        content: 'Content 1',
        safetyStatus: 'PENDING',
      });
      await localDs.manager.save(Story, {
        storyId: 'story-2',
        tenantId: 't1',
        childId: 'c1',
        theme: 'công chúa',
        wordCount: 350,
        isFallback: 0,
        createdAt: now.toISOString(),
        title: 'Story 2',
        content: 'Content 2',
        safetyStatus: 'PENDING',
      });
      await localDs.manager.save(Story, {
        storyId: 'story-3',
        tenantId: 't1',
        childId: 'c1',
        theme: 'khủng long',
        wordCount: 150,
        isFallback: 0,
        createdAt: now.toISOString(),
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
  });

  describe('getFeedbackStats', () => {
    it('empty state', async () => {
      const stats = await service.getFeedbackStats('c1', 't1');
      expect(stats.total_feedback).toBe(0);
      expect(stats.avg_rating).toBe(0);
      expect(stats.rating_distribution).toEqual([]);
    });

    it('with seeded data', async () => {
      await coreDs.manager.save(Feedback, {
        feedbackId: 'fb-1',
        tenantId: 't1',
        childId: 'c1',
        storyId: 'story-1',
        rating: 5,
        listenedComplete: 1,
        wantsMore: 1,
        suitable: 1,
        createdAt: '2024-01-01T00:00:00Z',
      });
      await coreDs.manager.save(Feedback, {
        feedbackId: 'fb-2',
        tenantId: 't1',
        childId: 'c1',
        storyId: 'story-2',
        rating: 4,
        listenedComplete: 1,
        wantsMore: 0,
        suitable: 1,
        createdAt: '2024-01-02T00:00:00Z',
      });
      await coreDs.manager.save(Feedback, {
        feedbackId: 'fb-3',
        tenantId: 't1',
        childId: 'c1',
        storyId: 'story-3',
        rating: 3,
        listenedComplete: 0,
        wantsMore: 0,
        suitable: 0,
        createdAt: '2024-01-03T00:00:00Z',
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
      await localDs.manager.save(MemoryItem, {
        memoryId: 'mem-1',
        tenantId: 't1',
        childId: 'c1',
        memoryType: 'interest',
        memoryKey: 'fav_theme',
        memoryValue: 'khủng long',
        confidence: 0.9,
        isActive: 1,
        createdAt: '2024-01-01T00:00:00Z',
      });
      await localDs.manager.save(MemoryItem, {
        memoryId: 'mem-2',
        tenantId: 't1',
        childId: 'c1',
        memoryType: 'interest',
        memoryKey: 'fav_theme',
        memoryValue: 'khủng long',
        confidence: 0.8,
        isActive: 1,
        createdAt: '2024-01-02T00:00:00Z',
      });
      await localDs.manager.save(MemoryItem, {
        memoryId: 'mem-3',
        tenantId: 't1',
        childId: 'c1',
        memoryType: 'preference',
        memoryKey: 'liked_character',
        memoryValue: 'Gấu Pooh',
        confidence: 0.7,
        isActive: 1,
        createdAt: '2024-01-03T00:00:00Z',
      });

      const stats = await service.getMemoryStats('c1', 't1');
      expect(stats.top_interests).toHaveLength(2);
      expect(stats.top_interests[0].value).toBe('khủng long');
      expect(stats.top_characters).toContain('Gấu Pooh');
    });
  });
});