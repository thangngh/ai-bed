import { TenantMiddleware } from '../middleware/tenant.middleware';
import { TenantService } from '../../modules/tenant/tenant.service';
import { signTenantToken } from '../../modules/auth/tenant-jwt';
import { signAdminToken } from '../../modules/admin/auth/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

const SECRET = 'a'.repeat(48);
const UUID = '550e8400-e29b-41d4-a716-446655440000';

function configFor(parentAuth: any) {
  return { get: jest.fn().mockReturnValue(parentAuth) } as any;
}

describe('TenantMiddleware', () => {
  let middleware: TenantMiddleware;
  let tenantService: jest.Mocked<TenantService>;

  function build(parentAuth: any = { enabled: false }) {
    tenantService = {
      create: jest.fn(),
      findOrCreate: jest.fn(),
      findById: jest.fn(),
    } as any;
    middleware = new TenantMiddleware(tenantService, configFor(parentAuth));
  }

  beforeEach(() => build());

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
    const req = { headers: { 'x-tenant-id': UUID } } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    tenantService.findOrCreate.mockResolvedValue({ tenantId: UUID, authType: 'local' } as any);
    await middleware.use(req, res, next);

    expect(tenantService.findOrCreate).toHaveBeenCalledWith(UUID);
    expect(req.tenantId).toBe(UUID);
    expect(next).toHaveBeenCalled();
  });

  it('should throw for invalid UUID format', async () => {
    const req = { headers: { 'x-tenant-id': 'not-a-uuid' } } as any;
    const res = {} as any;
    const next = jest.fn();

    await expect(middleware.use(req, res, next)).rejects.toThrow(BadRequestException);
  });

  describe('with parent sign-in enabled', () => {
    const parentAuth = { enabled: true, secret: SECRET };

    beforeEach(() => build(parentAuth));

    it('takes the tenant from a valid access token and ignores the header', async () => {
      const req = {
        headers: {
          authorization: `Bearer ${signTenantToken('tenant-from-token', SECRET, 900)}`,
          'x-tenant-id': UUID,
        },
      } as any;
      const next = jest.fn();

      await middleware.use(req, {} as any, next);

      expect(req.tenantId).toBe('tenant-from-token');
      expect(req.isAuthenticated).toBe(true);
      // The header names a different tenant; it must not have been consulted.
      expect(tenantService.findOrCreate).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it('rejects an expired token rather than silently falling back to the header', async () => {
      const expired = signTenantToken('tenant-from-token', SECRET, 900, 1_000);
      const req = {
        headers: { authorization: `Bearer ${expired}`, 'x-tenant-id': UUID },
      } as any;

      await expect(middleware.use(req, {} as any, jest.fn())).rejects.toThrow(UnauthorizedException);
      expect(tenantService.findOrCreate).not.toHaveBeenCalled();
    });

    it('rejects an admin token presented as a parent session', async () => {
      const adminToken = signAdminToken({ sub: 'admin-1', username: 'root' }, SECRET, 900);
      const req = { headers: { authorization: `Bearer ${adminToken}` } } as any;

      await expect(middleware.use(req, {} as any, jest.fn())).rejects.toThrow(UnauthorizedException);
    });

    it('stops X-Tenant-Id from reaching a tenant that has signed in', async () => {
      const req = { headers: { 'x-tenant-id': UUID } } as any;
      tenantService.findOrCreate.mockResolvedValue({ tenantId: UUID, authType: 'google' } as any);

      await expect(middleware.use(req, {} as any, jest.fn())).rejects.toThrow(UnauthorizedException);
    });

    it('still serves anonymous tenants by header', async () => {
      const req = { headers: { 'x-tenant-id': UUID } } as any;
      const next = jest.fn();
      tenantService.findOrCreate.mockResolvedValue({ tenantId: UUID, authType: 'local' } as any);

      await middleware.use(req, {} as any, next);

      expect(req.tenantId).toBe(UUID);
      expect(req.isAuthenticated).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });
  });

  it('ignores a bearer token entirely when sign-in is not configured', async () => {
    build({ enabled: false });
    const req = {
      headers: {
        authorization: `Bearer ${signTenantToken('tenant-from-token', SECRET, 900)}`,
        'x-tenant-id': UUID,
      },
    } as any;
    const next = jest.fn();
    tenantService.findOrCreate.mockResolvedValue({ tenantId: UUID, authType: 'local' } as any);

    await middleware.use(req, {} as any, next);

    expect(req.tenantId).toBe(UUID);
    expect(next).toHaveBeenCalled();
  });
});
