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
});
