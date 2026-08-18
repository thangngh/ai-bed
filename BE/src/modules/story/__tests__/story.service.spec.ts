import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { StoryService } from '../story.service';
import { Story } from '../entities/story.entity';
import { StorySection } from '../entities/story-section.entity';
import { ChildService } from '../../child/child.service';
import { MemoryService } from '../../memory/memory.service';
import { EngineGatewayService } from '../../engine-gateway/engine-gateway.service';
import { QueueService } from '../../../common/services/queue.service';
import { DashboardService } from '../../admin/dashboard/services/dashboard.service';

describe('StoryService', () => {
  let service: StoryService;
  let dataSource: DataSource;
  let storyRepo: Repository<Story>;
  let module: import('@nestjs/testing').TestingModule;

  beforeAll(async () => {
    module = await Test.createTestingModule({
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
          useValue: { getRelevant: jest.fn(), bulkCreate: jest.fn(), extractFromStory: jest.fn() },
        },
        {
          provide: EngineGatewayService,
          useValue: { generate: jest.fn() },
        },
        {
          provide: QueueService,
          useValue: { schedule: jest.fn((_t, fn) => fn()) },
        },
        {
          provide: DashboardService,
          useValue: {
            estimatePromptTokens: jest.fn().mockReturnValue(100),
            recordLlmUsage: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key, def) => def) },
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

  it('still returns the created story when dashboard usage recording rejects', async () => {
    // recordLlmUsage() is called fire-and-forget via `.catch()` in
    // StoryService.create(). If that `.catch()` were ever removed, this
    // rejection would become an unhandled promise rejection and/or the
    // failure would surface before `create()` resolves -- this test is
    // meant to go red in that case.
    const childService = module.get(ChildService);
    const memoryService = module.get(MemoryService);
    const engineGateway = module.get(EngineGatewayService);
    const dashboardService = module.get(DashboardService);

    (memoryService.getRelevant as jest.Mock).mockResolvedValue([]);
    (childService.getOrCreate as jest.Mock).mockResolvedValue({
      childId: 'child-1',
      childName: 'Bé An',
      age: 4,
      gender: '',
      preferredCharacters: '',
    });
    (engineGateway.generate as jest.Mock).mockResolvedValue({
      requestId: 'req-1',
      title: 'Chuyến phiêu lưu',
      content: [],
      safetyStatus: 'APPROVED',
      llmCalls: 1,
      retryCount: 0,
      latencyMs: 1000,
      wordCount: 50,
      isFallback: false,
    });
    (dashboardService.recordLlmUsage as jest.Mock).mockRejectedValueOnce(new Error('dashboard db down'));

    const result = await service.create(
      { child_name: 'Bé An', age: 4, theme: 'Động vật' } as any,
      't1',
    );

    expect(result).toBeDefined();
    expect(result.title).toBe('Chuyến phiêu lưu');
  });
});
