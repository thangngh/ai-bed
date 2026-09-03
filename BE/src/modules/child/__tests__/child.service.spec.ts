import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChildService } from '../child.service';
import { Tenant } from '../../tenant/entities/tenant.entity';
import { openTestDataSource, closeTestDataSource } from '../../../common/__tests__/test-db';

describe('ChildService', () => {
  let service: ChildService;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    // child_profiles.tenant_id carries a real FK to tenants on Postgres (the
    // old SQLite fixture only ever loaded the ChildProfile entity, so this
    // constraint was never in play). Every tenant id this file's tests
    // invent has to exist first.
    await dataSource.manager.save(
      Tenant,
      ['tenant-1', 'tenant-2', 'tenant-3', 'tenant-4', 'tenant-5', 'tenant-order', 'tenant-ambiguous']
        .map((tenantId) => ({ tenantId })),
    );
    const module = await Test.createTestingModule({
      providers: [
        ChildService,
        { provide: getDataSourceToken('core'), useValue: dataSource },
      ],
    }).compile();
    service = module.get(ChildService);
  });

  afterAll(async () => {
    await closeTestDataSource(dataSource);
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

  it('creates a new row instead of resurrecting a soft-deleted child', async () => {
    // A deleted child that comes back must not inherit the old row: stories,
    // memories and analytics are all keyed by childId, and the parent who
    // pressed "delete" does not expect them to reappear.
    const first = await service.getOrCreate('tenant-2', { child_name: 'Reborn', age: 4 } as any);
    await service.delete(first.childId, 'tenant-2');

    const second = await service.getOrCreate('tenant-2', { child_name: 'Reborn', age: 4 } as any);

    expect(second.childId).not.toBe(first.childId);
    expect(second.isActive).toBe(1);
    expect((await service.findById(first.childId))!.isActive).toBe(0);
  });

  it('refuses to update a soft-deleted child', async () => {
    const p = await service.getOrCreate('tenant-2', { child_name: 'GoneUpdate', age: 4 } as any);
    await service.delete(p.childId, 'tenant-2');

    await expect(service.update(p.childId, 'tenant-2', { age: 5 } as any)).rejects.toThrow(NotFoundException);
  });

  it('refuses to delete a soft-deleted child twice', async () => {
    const p = await service.getOrCreate('tenant-2', { child_name: 'GoneDelete', age: 4 } as any);
    await service.delete(p.childId, 'tenant-2');

    await expect(service.delete(p.childId, 'tenant-2')).rejects.toThrow(NotFoundException);
  });

  it('returns children in creation order', async () => {
    const t = 'tenant-order';
    const a = await service.getOrCreate(t, { child_name: 'Alpha', age: 4 } as any);
    const b = await service.getOrCreate(t, { child_name: 'Beta', age: 5 } as any);
    const c = await service.getOrCreate(t, { child_name: 'Gamma', age: 6 } as any);

    const list = await service.findByTenant(t);

    expect(list.map(p => p.childId)).toEqual([a.childId, b.childId, c.childId]);
  });

  it('create() stores every field from the DTO', async () => {
    const p = await service.create('tenant-3', {
      child_name: 'Full',
      age: 5,
      gender: 'girl',
      interests: 'khủng long',
      preferred_characters: 'Thỏ Bông',
      bedtime_goal: 'Chia sẻ',
    } as any);

    expect(p.childId).toBeDefined();
    expect(p.gender).toBe('girl');
    expect(p.interests).toBe('khủng long');
    expect(p.preferredCharacters).toBe('Thỏ Bông');
    expect(p.bedtimeGoal).toBe('Chia sẻ');
    expect(p.isActive).toBe(1);
  });

  it('create() allows active children to share a display name', async () => {
    const first = await service.create('tenant-3', { child_name: 'Dup', age: 4 } as any);
    const second = await service.create('tenant-3', { child_name: 'Dup', age: 5 } as any);

    expect(second.childId).not.toBe(first.childId);
    expect((await service.findByTenant('tenant-3')).filter((p) => p.childName === 'Dup')).toHaveLength(2);
  });

  it('name-only getOrCreate refuses to guess between duplicates', async () => {
    await service.create('tenant-ambiguous', { child_name: 'An', age: 4 } as any);
    await service.create('tenant-ambiguous', { child_name: 'An', age: 5 } as any);

    await expect(service.getOrCreate(
      'tenant-ambiguous',
      { child_name: 'An', age: 4 } as any,
    )).rejects.toThrow(BadRequestException);
    expect(await service.findByName('tenant-ambiguous', 'An')).toBeNull();
  });

  it('create() allows a name freed by a soft delete', async () => {
    const first = await service.create('tenant-3', { child_name: 'Freed', age: 4 } as any);
    await service.delete(first.childId, 'tenant-3');

    const second = await service.create('tenant-3', { child_name: 'Freed', age: 4 } as any);

    expect(second.childId).not.toBe(first.childId);
  });

  it('create() does not collide across tenants', async () => {
    await service.create('tenant-3', { child_name: 'Shared', age: 4 } as any);

    const other = await service.create('tenant-4', { child_name: 'Shared', age: 4 } as any);

    expect(other.childId).toBeDefined();
  });

  it('update() renames a child', async () => {
    const p = await service.create('tenant-5', { child_name: 'Sai', age: 4 } as any);

    const renamed = await service.update(p.childId, 'tenant-5', { child_name: 'Đúng' } as any);

    expect(renamed.childName).toBe('Đúng');
    expect(await service.findByName('tenant-5', 'Sai')).toBeNull();
  });

  it('update() allows a rename onto another active child display name', async () => {
    await service.create('tenant-5', { child_name: 'Taken', age: 4 } as any);
    const other = await service.create('tenant-5', { child_name: 'Mover', age: 4 } as any);

    const renamed = await service.update(other.childId, 'tenant-5', { child_name: 'Taken' } as any);

    expect(renamed.childName).toBe('Taken');
    expect((await service.findByTenant('tenant-5')).filter((p) => p.childName === 'Taken')).toHaveLength(2);
  });

  it('update() accepts a no-op rename to the child own name', async () => {
    const p = await service.create('tenant-5', { child_name: 'Same', age: 4 } as any);

    const saved = await service.update(p.childId, 'tenant-5', { child_name: 'Same', age: 5 } as any);

    expect(saved.childName).toBe('Same');
    expect(saved.age).toBe(5);
  });

  it('update() leaves fields absent from the DTO alone', async () => {
    const p = await service.create('tenant-5', {
      child_name: 'Keep',
      age: 4,
      interests: 'tàu hỏa',
      preferred_characters: 'Gấu Pooh',
      bedtime_goal: 'Dũng cảm',
      gender: 'boy',
    } as any);

    const saved = await service.update(p.childId, 'tenant-5', { age: 6 } as any);

    expect(saved.age).toBe(6);
    expect(saved.interests).toBe('tàu hỏa');
    expect(saved.preferredCharacters).toBe('Gấu Pooh');
    expect(saved.bedtimeGoal).toBe('Dũng cảm');
    expect(saved.gender).toBe('boy');
  });
});
