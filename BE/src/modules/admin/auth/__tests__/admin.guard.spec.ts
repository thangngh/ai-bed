import { ExecutionContext } from '@nestjs/common';
import { AdminGuard, extractBearer } from '../admin.guard';
import { signAdminToken } from '../jwt';

const SECRET = 'g'.repeat(48);
const MSG = 'Phiên không hợp lệ hoặc đã hết hạn';

const configStub = { get: (key: string) => (key === 'admin.secret' ? SECRET : undefined) } as any;

function contextFor(headers: Record<string, string>): { ctx: ExecutionContext; req: any } {
  const req: any = { headers };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as ExecutionContext;
  return { ctx, req };
}

describe('extractBearer', () => {
  it('pulls the token out of a well-formed header', () => {
    expect(extractBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('accepts any casing of the scheme', () => {
    expect(extractBearer('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearer('BEARER abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null for anything else', () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer('')).toBeNull();
    expect(extractBearer('Basic dXNlcjpwYXNz')).toBeNull();
    expect(extractBearer('Bearer')).toBeNull();
    expect(extractBearer('Bearer ')).toBeNull();
    expect(extractBearer('Bearer a b')).toBeNull();
  });
});

describe('AdminGuard', () => {
  const guard = new AdminGuard(configStub as any);

  it('attaches req.admin for a valid token', () => {
    const token = signAdminToken({ sub: 'admin-1', username: 'thang' }, SECRET, 3600);
    const { ctx, req } = contextFor({ authorization: `Bearer ${token}` });

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.admin).toEqual({ adminId: 'admin-1', username: 'thang' });
  });

  it('rejects a missing header with the UNAUTHORIZED code', () => {
    const { ctx } = contextFor({});
    expect(() => guard.canActivate(ctx)).toThrow();
    try {
      guard.canActivate(ctx);
    } catch (err: any) {
      expect(err.getStatus()).toBe(401);
      expect(err.getResponse()).toEqual({
        error: { code: 'UNAUTHORIZED', message: MSG },
      });
    }
  });

  it('rejects a token signed with another secret', () => {
    const token = signAdminToken({ sub: 'admin-1', username: 'thang' }, 'z'.repeat(48), 3600);
    const { ctx } = contextFor({ authorization: `Bearer ${token}` });
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it('rejects an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = signAdminToken({ sub: 'admin-1', username: 'thang' }, SECRET, 3600, past);
    const { ctx } = contextFor({ authorization: `Bearer ${token}` });
    expect(() => guard.canActivate(ctx)).toThrow();
  });

  it('does not leak which failure occurred', () => {
    const cases = ['', 'Bearer nonsense', 'Basic abc'];
    const bodies = cases.map((authorization) => {
      try {
        guard.canActivate(contextFor(authorization ? { authorization } : {}).ctx);
        return null;
      } catch (err: any) {
        return err.getResponse();
      }
    });
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });
});
