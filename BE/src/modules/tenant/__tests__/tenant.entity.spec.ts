import { Tenant } from '../entities/tenant.entity';

describe('TenantEntity', () => {
  it('should have all required columns', () => {
    const tenant = new Tenant();
    tenant.tenantId = 'uuid-123';
    tenant.name = 'anonymous';
    tenant.authType = 'local';

    expect(tenant.tenantId).toBe('uuid-123');
    expect(tenant.name).toBe('anonymous');
    expect(tenant.authType).toBe('local');
    expect(tenant.metadata).toBeUndefined();
    expect(tenant.createdAt).toBeUndefined();
    expect(tenant.updatedAt).toBeUndefined();
  });
});
