import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { FeedbackService } from '../feedback.service';
import { Feedback } from '../entities/feedback.entity';
import { ChildService } from '../../child/child.service';
import { MemoryService } from '../../memory/memory.service';
import { Tenant } from '../../tenant/entities/tenant.entity';
import { ChildProfile } from '../../child/entities/child-profile.entity';
import { openTestDataSource, closeTestDataSource } from '../../../common/__tests__/test-db';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let dataSource: DataSource;
  let childService: jest.Mocked<ChildService>;
  let memoryService: jest.Mocked<MemoryService>;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    // feedbacks.tenant_id and feedbacks.child_id both carry real FKs on
    // Postgres. ChildService is mocked here, so nothing else creates the
    // rows these tests' fake ids point at -- seed them directly so the
    // FK the old fragmentary SQLite fixture never enforced is satisfied.
    await dataSource.manager.save(Tenant, { tenantId: 'tenant-1' });
    await dataSource.manager.save(
      ChildProfile,
      [
        'child-uuid-1',
        'child-uuid-2',
        'child-uuid-3',
        'child-uuid-4',
        '12345678-1234-4123-8123-123456789abc',
      ].map((childId) => ({ childId, tenantId: 'tenant-1', childName: childId, age: 5 })),
    );
    const module = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: getDataSourceToken('core'), useValue: dataSource },
        {
          provide: ChildService,
          useValue: {
            findByName: jest.fn(),
            findById: jest.fn(),
          },
        },
        {
          provide: MemoryService,
          useValue: {
            reinforce: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(FeedbackService);
    childService = module.get(ChildService) as jest.Mocked<ChildService>;
    memoryService = module.get(MemoryService) as jest.Mocked<MemoryService>;
  });

  afterAll(async () => {
    await closeTestDataSource(dataSource);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create feedback and boost memory on rating >= 4', async () => {
    childService.findByName.mockResolvedValue({
      childId: 'child-uuid-1',
      tenantId: 't1',
      childName: 'Bé An',
      age: 5,
      language: 'vi',
      isActive: 1,
    } as any);

    const result = await service.submit({
      story_id: 'story-1',
      child_name: 'Bé An',
      rating: 5,
    }, 'tenant-1');

    // Feedback saved
    expect(result.feedback_id).toBeDefined();
    const repo: Repository<Feedback> = dataSource.getRepository(Feedback);
    const saved = await repo.findOne({ where: { feedbackId: result.feedback_id } });
    expect(saved).toBeDefined();
    expect(saved!.childId).toBe('child-uuid-1');
    expect(saved!.rating).toBe(5);

    // Memory reinforced
    expect(memoryService.reinforce).toHaveBeenCalledWith(
      'child-uuid-1',
      'tenant-1',
      expect.objectContaining({ action: 'boost' }),
    );
  });

  it('uses child_id instead of an ambiguous display name', async () => {
    childService.findById.mockResolvedValue({
      childId: '12345678-1234-4123-8123-123456789abc',
      tenantId: 'tenant-1',
      childName: 'An',
      age: 4,
      language: 'vi',
      isActive: 1,
    } as any);

    const result = await service.submit({
      story_id: 'story-by-id',
      child_id: '12345678-1234-4123-8123-123456789abc',
      child_name: 'An',
      rating: 5,
    }, 'tenant-1');

    const saved = await dataSource.getRepository(Feedback).findOneBy({
      feedbackId: result.feedback_id,
    });
    expect(saved?.childId).toBe('12345678-1234-4123-8123-123456789abc');
    expect(childService.findByName).not.toHaveBeenCalled();
  });

  it('should reduce memory on rating <= 2', async () => {
    childService.findByName.mockResolvedValue({
      childId: 'child-uuid-2',
      tenantId: 't1',
      childName: 'Bé Bình',
      age: 4,
      language: 'vi',
      isActive: 1,
    } as any);

    await service.submit({
      story_id: 'story-2',
      child_name: 'Bé Bình',
      rating: 2,
    }, 'tenant-1');

    expect(memoryService.reinforce).toHaveBeenCalledWith(
      'child-uuid-2',
      'tenant-1',
      expect.objectContaining({ action: 'reduce' }),
    );
  });

  it('should not reinforce when rating is neutral (3)', async () => {
    childService.findByName.mockResolvedValue({
      childId: 'child-uuid-3',
      tenantId: 't1',
      childName: 'Bé Chi',
      age: 6,
      language: 'vi',
      isActive: 1,
    } as any);

    await service.submit({
      story_id: 'story-3',
      child_name: 'Bé Chi',
      rating: 3,
    }, 'tenant-1');

    expect(memoryService.reinforce).not.toHaveBeenCalled();
  });

  it('should not reinforce when child_name is missing', async () => {
    await service.submit({
      story_id: 'story-4',
      rating: 5,
    }, 'tenant-1');

    expect(childService.findByName).not.toHaveBeenCalled();
    expect(memoryService.reinforce).not.toHaveBeenCalled();
  });

  it('should store null childId when child_name not found', async () => {
    childService.findByName.mockResolvedValue(null);

    const result = await service.submit({
      story_id: 'story-5',
      child_name: 'Không tồn tại',
      rating: 4,
    }, 'tenant-1');

    const repo: Repository<Feedback> = dataSource.getRepository(Feedback);
    const saved = await repo.findOne({ where: { feedbackId: result.feedback_id } });
    expect(saved!.childId).toBeNull();
    // No reinforce because childId is null
    expect(memoryService.reinforce).not.toHaveBeenCalled();
  });

  it('should save feedback without rating', async () => {
    childService.findByName.mockResolvedValue({
      childId: 'child-uuid-4',
      tenantId: 't1',
      childName: 'Bé Đạt',
      age: 3,
      language: 'vi',
      isActive: 1,
    } as any);

    const result = await service.submit({
      story_id: 'story-6',
      child_name: 'Bé Đạt',
    }, 'tenant-1');

    expect(result.feedback_id).toBeDefined();
    expect(memoryService.reinforce).not.toHaveBeenCalled();
  });
});
