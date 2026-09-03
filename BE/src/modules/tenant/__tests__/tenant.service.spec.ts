import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TenantService } from '../tenant.service';
import { openTestDataSource, closeTestDataSource } from '../../../common/__tests__/test-db';

describe('TenantService', () => {
  let service: TenantService;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    const module = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: getDataSourceToken('core'), useValue: dataSource },
      ],
    }).compile();
    service = module.get(TenantService);
  });

  afterAll(async () => {
    await closeTestDataSource(dataSource);
  });

  it('should create a tenant with UUID', async () => {
    const tenant = await service.create();
    expect(tenant.tenantId).toBeDefined();
    expect(tenant.tenantId.length).toBe(36);
    expect(tenant.name).toBe('anonymous');
    expect(tenant.authType).toBe('local');
  });

  it('should find tenant by ID', async () => {
    const created = await service.create();
    const found = await service.findById(created.tenantId);
    expect(found).toBeDefined();
    expect(found!.tenantId).toBe(created.tenantId);
  });

  it('should return null for non-existent tenant', async () => {
    const found = await service.findById('non-existent');
    expect(found).toBeNull();
  });

  it('should find or create tenant', async () => {
    const tenantId = '550e8400-e29b-41d4-a716-446655440000';
    const created = await service.findOrCreate(tenantId);
    expect(created.tenantId).toBe(tenantId);

    const found = await service.findOrCreate(tenantId);
    expect(found.tenantId).toBe(tenantId);
  });
});
