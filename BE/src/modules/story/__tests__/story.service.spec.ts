import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { StoryService } from '../story.service';
import { Story } from '../entities/story.entity';
import { StorySection } from '../entities/story-section.entity';
import { ChildService } from '../../child/child.service';
import { MemoryService } from '../../memory/memory.service';
import { EngineGatewayService } from '../../engine-gateway/engine-gateway.service';
import { QueueService } from '../../../common/services/queue.service';

describe('StoryService', () => {
  let service: StoryService;
  let dataSource: DataSource;
  let storyRepo: Repository<Story>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        StoryService,
        {
          provide: getDataSourceToken('local'),
          useFactory: async () => {
            const ds = new DataSource({
              type: 'sqlite',
              database: ':memory:',
              entities: [Story, StorySection],
              synchronize: true,
            });
            await ds.initialize();
            return ds;
          },
        },
        {
          provide: ChildService,
          useValue: { getOrCreate: jest.fn(), findByTenant: jest.fn() },
        },
        {
          provide: MemoryService,
          useValue: { getRelevant: jest.fn(), bulkCreate: jest.fn() },
        },
        {
          provide: EngineGatewayService,
          useValue: { generate: jest.fn() },
        },
        {
          provide: QueueService,
          useValue: { schedule: jest.fn((_t, fn) => fn()) },
        },
      ],
    }).compile();

    service = module.get(StoryService);
    dataSource = module.get(getDataSourceToken('local'));
    storyRepo = dataSource.getRepository(Story);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should find story by id with sections', async () => {
    const story = new Story();
    story.storyId = 's1';
    story.tenantId = 't1';
    story.title = 'Test Story';
    story.content = '{}';
    story.theme = 'Động vật';
    await storyRepo.save(story);

    const section = new StorySection();
    section.sectionId = 'sec1';
    section.storyId = 's1';
    section.tenantId = 't1';
    section.sectionType = 'opening';
    section.content = 'Once upon a time...';
    section.orderIndex = 0;
    await dataSource.getRepository(StorySection).save(section);

    const result = await service.findById('s1', 't1');
    expect(result).toBeDefined();
    expect(result!.storyId).toBe('s1');
    expect(result!.sections).toHaveLength(1);
    expect(result!.sections![0].sectionType).toBe('opening');
  });

  it('should return null for non-existent story', async () => {
    const result = await service.findById('nonexistent', 't1');
    expect(result).toBeNull();
  });

  it('filters latest stories by child_id when names are duplicated', async () => {
    const saveStory = async (storyId: string, childId: string) => {
      const story = new Story();
      story.storyId = storyId;
      story.tenantId = 'same-tenant';
      story.childId = childId;
      story.title = `Story ${storyId}`;
      story.content = '{}';
      story.theme = 'Động vật';
      await storyRepo.save(story);
    };
    await saveStory('same-name-a', 'child-a');
    await saveStory('same-name-b', 'child-b');

    const result = await service.getLatest('same-tenant', undefined, 10, 'child-b');

    expect(result.map((story) => story.storyId)).toEqual(['same-name-b']);
  });
});
