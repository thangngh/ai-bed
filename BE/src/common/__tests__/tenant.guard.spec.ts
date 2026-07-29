import { TenantGuard } from '../guards/tenant.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

describe('TenantGuard', () => {
  let guard: TenantGuard;

  beforeEach(() => {
    guard = new TenantGuard();
  });

  it('should allow request with tenantId', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ tenantId: 'valid-uuid' }),
      }),
    } as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should reject request without tenantId', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
