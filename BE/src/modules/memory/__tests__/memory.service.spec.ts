import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MemoryService } from '../memory.service';
import { MemoryItem } from '../entities/memory-item.entity';

describe('MemoryService', () => {
  let service: MemoryService;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MemoryService,
        {
          provide: getDataSourceToken('local'),
          useFactory: async () => {
            const ds = new DataSource({
              type: 'sqlite',
              database: ':memory:',
              entities: [MemoryItem],
              synchronize: true,
            });
            await ds.initialize();
            return ds;
          },
        },
      ],
    }).compile();
    service = module.get(MemoryService);
    dataSource = module.get(getDataSourceToken('local'));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should bulk create memories', async () => {
    await service.bulkCreate('tenant-1', 'child-1', [
      { type: 'interest', key: 'fav_theme', value: 'rồng', confidence: 0.8 },
    ], 'story-1');

    const relevant = await service.getRelevant('tenant-1', 'child-1');
    expect(relevant.length).toBeGreaterThan(0);
    expect(relevant[0].key).toBe('fav_theme');
  });

  it('getChildContext should group memories by type', async () => {
    await service.bulkCreate('tenant-1', 'child-2', [
      { type: 'interest', key: 'fav_animal', value: 'mèo', confidence: 0.9 },
      { type: 'preference', key: 'fav_food', value: 'cá', confidence: 0.8 },
      { type: 'recent_theme', key: 'last_story', value: 'phiêu lưu', confidence: 0.7 },
      { type: 'behavior', key: 'mood', value: 'vui vẻ', confidence: 0.6 },
    ], 'story-1');

    const ctx = await service.getChildContext('child-2', 'tenant-1');
    expect(ctx.interests).toHaveLength(1);
    expect(ctx.preferences).toHaveLength(1);
    expect(ctx.recentThemes).toHaveLength(1);
    expect(ctx.behaviors).toHaveLength(1);
    expect(ctx.interests[0].value).toBe('mèo');
  });

  it('extractFromStory should upsert and enforce max 20 limit', async () => {
    const memories = Array.from({ length: 25 }, (_, i) => ({
      type: 'interest',
      key: `theme_${i}`,
      value: `chủ đề ${i}`,
      confidence: 0.5,
    }));

    const result = await service.extractFromStory('child-3', 'tenant-1', memories, 'story-2');
    expect(result.saved).toBe(25);

    const relevant = await service.getRelevant('tenant-1', 'child-3');
    expect(relevant.length).toBeLessThanOrEqual(20);
  });

  it('reinforce should boost existing memory confidence', async () => {
    await service.bulkCreate('tenant-1', 'child-4', [
      { type: 'interest', key: 'fav_color', value: 'xanh', confidence: 0.5 },
    ], 'story-3');

    const result = await service.reinforce('child-4', 'tenant-1', {
      type: 'interest',
      key: 'fav_color',
      value: 'xanh',
      action: 'boost',
    });
    expect(result.success).toBe(true);
  });

  it('reinforce should create new memory on boost if not exists', async () => {
    const result = await service.reinforce('child-5', 'tenant-1', {
      type: 'interest',
      key: 'new_topic',
      value: 'khủng long',
      action: 'boost',
    });
    expect(result.success).toBe(true);

    const relevant = await service.getRelevant('tenant-1', 'child-5');
    expect(relevant.some(r => r.key === 'new_topic')).toBe(true);
  });

  it('reinforce should reduce confidence on reduce action', async () => {
    await service.bulkCreate('tenant-1', 'child-6', [
      { type: 'interest', key: 'fav_toy', value: 'búp bê', confidence: 0.8 },
    ], 'story-4');

    const result = await service.reinforce('child-6', 'tenant-1', {
      type: 'interest',
      key: 'fav_toy',
      value: 'búp bê',
      action: 'reduce',
    });
    expect(result.success).toBe(true);
  });
});
