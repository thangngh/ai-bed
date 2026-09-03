import { signTenantToken, verifyTenantToken } from '../tenant-jwt';
import { signAdminToken } from '../../admin/auth/jwt';

const SECRET = 'b'.repeat(48);
const OTHER_SECRET = 'c'.repeat(48);

function tamperPayload(token: string, mutate: (payload: any) => void): string {
  const [header, payload, signature] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  mutate(decoded);
  const next = Buffer.from(JSON.stringify(decoded)).toString('base64url');
  return `${header}.${next}.${signature}`;
}

describe('tenant JWT', () => {
  it('round-trips a tenant id', () => {
    const token = signTenantToken('tenant-1', SECRET, 900, 1_000);
    expect(verifyTenantToken(token, SECRET, 1_100)).toEqual({
      sub: 'tenant-1',
      typ: 'parent',
      iat: 1_000,
      exp: 1_900,
    });
  });

  it('rejects a token signed with another secret', () => {
    const token = signTenantToken('tenant-1', OTHER_SECRET, 900, 1_000);
    expect(verifyTenantToken(token, SECRET, 1_100)).toBeNull();
  });

  it('rejects a token whose payload was edited to another tenant', () => {
    const token = tamperPayload(signTenantToken('tenant-1', SECRET, 900, 1_000), (p) => {
      p.sub = 'someone-elses-tenant';
    });
    expect(verifyTenantToken(token, SECRET, 1_100)).toBeNull();
  });

  it('rejects alg:none', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'tenant-1', typ: 'parent', iat: 1_000, exp: 1_900 }),
    ).toString('base64url');
    expect(verifyTenantToken(`${header}.${payload}.`, SECRET, 1_100)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signTenantToken('tenant-1', SECRET, 900, 1_000);
    expect(verifyTenantToken(token, SECRET, 1_900)).toBeNull();
  });

  it('rejects an admin token even on a shared secret', () => {
    // The `typ` claim is what keeps the two token families apart; without it
    // an admin session would authenticate as the tenant named by `sub`.
    const adminToken = signAdminToken({ sub: 'admin-1', username: 'root' }, SECRET, 900, 1_000);
    expect(verifyTenantToken(adminToken, SECRET, 1_100)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifyTenantToken('not-a-token', SECRET)).toBeNull();
    expect(verifyTenantToken('a.b', SECRET)).toBeNull();
    expect(verifyTenantToken('', SECRET)).toBeNull();
  });
});
