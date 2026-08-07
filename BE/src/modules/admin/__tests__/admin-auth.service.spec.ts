import { DataSource } from 'typeorm';
import { AdminUser } from '../entities/admin-user.entity';
import { AdminAuthService } from '../admin-auth.service';
import { hashPassword } from '../auth/password';
import { verifyAdminToken } from '../auth/jwt';
import { makeDataSource } from '../../../common/__tests__/test-db';

jest.setTimeout(60_000);

const SECRET = 's'.repeat(48);
const configStub = {
  get: (key: string) => ({ 'admin.secret': SECRET, 'admin.ttlSeconds': 3600 } as any)[key],
} as any;

describe('AdminAuthService.login', () => {
  let ds: DataSource;
  let service: AdminAuthService;

  beforeEach(async () => {
    ds = makeDataSource([AdminUser]);
    await ds.initialize();
    await ds.getRepository(AdminUser).save(Object.assign(new AdminUser(), {
      adminId: 'admin-1',
      username: 'thang',
      passwordHash: await hashPassword('correct-password-1'),
    }));
    service = new AdminAuthService(ds, configStub);
  });

  afterEach(async () => { await ds.destroy(); });

  it('returns a verifiable token for the right credentials', async () => {
    const result = await service.login('thang', 'correct-password-1');

    expect(result.admin).toEqual({ admin_id: 'admin-1', username: 'thang' });
    expect(Date.parse(result.expires_at)).toBeGreaterThan(Date.now());

    const payload = verifyAdminToken(result.token, SECRET);
    expect(payload).toMatchObject({ sub: 'admin-1', username: 'thang' });
  });

  it('records last_login_at on success', async () => {
    await service.login('thang', 'correct-password-1');
    const row = await ds.getRepository(AdminUser).findOne({ where: { adminId: 'admin-1' } });
    expect(row?.lastLoginAt).toBeTruthy();
  });

  it('answers identically for a wrong password and an unknown username', async () => {
    const wrong = await service.login('thang', 'wrong-password-xx').catch((e) => e);
    const unknown = await service.login('nobody', 'wrong-password-xx').catch((e) => e);

    expect(wrong.getStatus()).toBe(401);
    expect(unknown.getStatus()).toBe(401);
    // Byte-identical bodies: anything else is a username oracle.
    expect(wrong.getResponse()).toEqual(unknown.getResponse());
    expect(wrong.getResponse()).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: 'Sai tài khoản hoặc mật khẩu' },
    });
  });

  it('throttles after 10 failures and reports retry_after', async () => {
    for (let i = 0; i < 10; i++) {
      await service.login('thang', 'wrong-password-xx').catch(() => undefined);
    }
    const err = await service.login('thang', 'correct-password-1').catch((e) => e);

    expect(err.getStatus()).toBe(429);
    const body = err.getResponse();
    expect(body.error.code).toBe('LOGIN_THROTTLED');
    expect(body.error.retry_after).toBeGreaterThan(0);
  });

  it('clears the failure count after a successful login', async () => {
    for (let i = 0; i < 9; i++) {
      await service.login('thang', 'wrong-password-xx').catch(() => undefined);
    }
    await service.login('thang', 'correct-password-1');

    for (let i = 0; i < 9; i++) {
      const err = await service.login('thang', 'wrong-password-xx').catch((e) => e);
      expect(err.getStatus()).toBe(401);
    }
  });
});
