import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChildService } from '../child.service';
import { ChildProfile } from '../entities/child-profile.entity';

describe('ChildService', () => {
  let service: ChildService;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ChildService,
        {
          provide: getDataSourceToken('core'),
          useFactory: async () => {
            const ds = new DataSource({
              type: 'sqlite',
              database: ':memory:',
              entities: [ChildProfile],
              synchronize: true,
            });
            await ds.initialize();
            return ds;
          },
        },
      ],
    }).compile();
    service = module.get(ChildService);
    dataSource = module.get(getDataSourceToken('core'));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('should create profile', async () => {
    const p = await service.getOrCreate('tenant-1', { child_name: 'An', age: 4 } as any);
    expect(p.childId).toBeDefined();
    expect(p.childName).toBe('An');
  });

  it('should create profile with gender', async () => {
    const p = await service.getOrCreate('tenant-1', { child_name: 'Binh', age: 4, gender: 'boy' } as any);
    expect(p.gender).toBe('boy');
  });

  it('should return existing profile on duplicate', async () => {
    const p1 = await service.getOrCreate('tenant-1', { child_name: 'Chi', age: 4 } as any);
    const p2 = await service.getOrCreate('tenant-1', { child_name: 'Chi', age: 5 } as any);
    expect(p1.childId).toEqual(p2.childId);
  });

  it('refreshes the age of an existing profile', async () => {
    // The stored age is what StoryService sends to the Engine, and the Engine
    // picks the developer prompt and the age-appropriate safety rules from it.
    // This lookup matches on name alone, so keeping the old value meant a
    // child who had a birthday -- or whose age was mistyped once -- kept
    // getting stories written to the wrong band, with the form's corrected
    // answer silently discarded. This test used to assert that stale age.
    await service.getOrCreate('tenant-1', { child_name: 'Duong', age: 3 } as any);
    const updated = await service.getOrCreate('tenant-1', { child_name: 'Duong', age: 6 } as any);

    expect(updated.age).toBe(6);
    expect((await service.findByName('tenant-1', 'Duong'))!.age).toBe(6);
  });

  it('should soft-delete profile', async () => {
    const p = await service.getOrCreate('tenant-1', { child_name: 'ToDelete', age: 5 } as any);
    await service.delete(p.childId, 'tenant-1');
    const deleted = await service.findById(p.childId);
    expect(deleted).toBeDefined();
    expect(deleted!.isActive).toBe(0);
  });

  it('should exclude inactive profiles from findByTenant', async () => {
    const p = await service.getOrCreate('tenant-1', { child_name: 'InactiveTest', age: 5 } as any);
    await service.delete(p.childId, 'tenant-1');
    const activeProfiles = await service.findByTenant('tenant-1');
    expect(activeProfiles.find(c => c.childId === p.childId)).toBeUndefined();
  });
});
