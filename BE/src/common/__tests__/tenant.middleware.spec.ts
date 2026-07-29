import { TenantMiddleware } from '../middleware/tenant.middleware';
import { TenantService } from '../../modules/tenant/tenant.service';
import { BadRequestException } from '@nestjs/common';

describe('TenantMiddleware', () => {
  let middleware: TenantMiddleware;
  let tenantService: jest.Mocked<TenantService>;

  beforeEach(() => {
    tenantService = {
      create: jest.fn(),
      findOrCreate: jest.fn(),
      findById: jest.fn(),
    } as any;
    middleware = new TenantMiddleware(tenantService);
  });

  it('should create tenant if header missing', async () => {
    const req = { headers: {} } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    tenantService.create.mockResolvedValue({ tenantId: 'new-uuid' } as any);
    await middleware.use(req, res, next);

    expect(tenantService.create).toHaveBeenCalled();
    expect(req.tenantId).toBe('new-uuid');
    expect(res.setHeader).toHaveBeenCalledWith('X-Tenant-Id', 'new-uuid');
    expect(next).toHaveBeenCalled();
  });

  it('should use existing valid tenant ID', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const req = { headers: { 'x-tenant-id': uuid } } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    tenantService.findOrCreate.mockResolvedValue({ tenantId: uuid } as any);
    await middleware.use(req, res, next);

    expect(tenantService.findOrCreate).toHaveBeenCalledWith(uuid);
    expect(req.tenantId).toBe(uuid);
    expect(next).toHaveBeenCalled();
  });

  it('should throw for invalid UUID format', async () => {
    const req = { headers: { 'x-tenant-id': 'not-a-uuid' } } as any;
    const res = {} as any;
    const next = jest.fn();

    await expect(middleware.use(req, res, next)).rejects.toThrow(BadRequestException);
  });
});
