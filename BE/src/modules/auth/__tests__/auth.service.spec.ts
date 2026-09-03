import { UnauthorizedException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { AuthService } from '../auth.service';
import { verifyTenantToken } from '../tenant-jwt';

const SECRET = 'f'.repeat(48);

const CONFIG = {
  enabled: true,
  googleClientId: 'client-id',
  googleClientSecret: 'client-secret',
  googleCallbackUrl: 'http://localhost:3001/auth/google/callback',
  frontendCallbackUrl: 'http://localhost:3000/auth/callback',
  secret: SECRET,
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  refreshCookiePath: '/',
};

/**
 * Enough of a TypeORM repository for this service: `where` is matched as a
 * plain subset of the row, which is all the production queries here need.
 */
function fakeRepo(rows: any[]) {
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([key, value]) =>
      // The service passes IsNull() for revoked_at; anything else is a literal.
      value instanceof FindOperator
        ? row[key] === null || row[key] === undefined
        : row[key] === value,
    );

  return {
    rows,
    create: (obj: any) => ({ ...obj }),
    save: async (obj: any) => {
      rows.push(obj);
      return obj;
    },
    findOne: async ({ where }: any) => rows.find((row) => matches(row, where)) ?? null,
    findOneOrFail: async ({ where }: any) => {
      const found = rows.find((row) => matches(row, where));
      if (!found) throw new Error('not found');
      return found;
    },
    update: async (where: any, patch: any) => {
      rows.filter((row) => matches(row, where)).forEach((row) => Object.assign(row, patch));
    },
  };
}

function buildService(options: { tenants?: any[]; profile?: any } = {}) {
  const tenants = fakeRepo(options.tenants ?? []);
  const sessions = fakeRepo([]);
  const dataSource = {
    getRepository: (entity: any) => (entity.name === 'TenantSession' ? sessions : tenants),
  } as any;
  const config = { get: () => CONFIG } as any;
  const google = {
    getAuthorizationUrl: (state: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchangeCodeForProfile: jest.fn().mockResolvedValue(
      options.profile ?? { subject: 'google-sub-1', email: 'parent@example.com', displayName: 'Parent' },
    ),
  } as any;

  const service = new AuthService(dataSource, config, google);
  // Silence the expected reuse warning.
  (service as any).logger = { warn: jest.fn(), error: jest.fn() };
  return { service, tenants, sessions, google };
}

describe('AuthService state', () => {
  it('accepts a state it issued and returns the tenant to claim', () => {
    const { service } = buildService();
    const state = service.createState('550e8400-e29b-41d4-a716-446655440000');
    expect(service.verifyState(state)).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects a state the BE did not sign', () => {
    // This is the CSRF check: without it, an attacker could feed the callback
    // their own authorization code and bind the victim's browser to their
    // Google account.
    const { service } = buildService();
    const forged = `${Buffer.from(JSON.stringify({ n: 'x', ct: null, exp: 9e9 })).toString('base64url')}.deadbeef`;
    expect(() => service.verifyState(forged)).toThrow(UnauthorizedException);
  });

  it('rejects a tampered state body', () => {
    const { service } = buildService();
    const [, mac] = service.createState(null).split('.');
    const body = Buffer.from(JSON.stringify({ n: 'x', ct: 'evil', exp: 9e9 })).toString('base64url');
    expect(() => service.verifyState(`${body}.${mac}`)).toThrow(UnauthorizedException);
  });

  it('rejects a missing state', () => {
    const { service } = buildService();
    expect(() => service.verifyState(undefined)).toThrow(UnauthorizedException);
  });

  it('rejects a state that sat unfinished past its TTL', () => {
    const { service } = buildService();
    const state = service.createState(null);
    const later = Date.now() + 3_600_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    try {
      expect(() => service.verifyState(state)).toThrow(UnauthorizedException);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('drops a claim id that is not a UUID', () => {
    const { service } = buildService();
    expect(service.verifyState(service.createState('../../etc/passwd'))).toBeNull();
  });
});

describe('AuthService Google callback', () => {
  it('creates a new tenant on first sign-in', async () => {
    const { service, tenants } = buildService();
    const tokens = await service.handleGoogleCallback('code', service.createState(null), '1.2.3.4');

    expect(tenants.rows).toHaveLength(1);
    expect(tenants.rows[0]).toMatchObject({ authType: 'google', authKey: 'google-sub-1' });
    expect(verifyTenantToken(tokens.accessToken, SECRET)?.sub).toBe(tokens.tenantId);
  });

  it('reuses the tenant already bound to the Google account', async () => {
    const existing = { tenantId: 'tenant-1', authType: 'google', authKey: 'google-sub-1', name: 'Old' };
    const { service, tenants } = buildService({ tenants: [existing] });

    const tokens = await service.handleGoogleCallback('code', service.createState(null), null);

    expect(tokens.tenantId).toBe('tenant-1');
    expect(tenants.rows).toHaveLength(1);
  });

  it('adopts the anonymous tenant the parent was already using', async () => {
    const anonymous = { tenantId: '550e8400-e29b-41d4-a716-446655440000', authType: 'local', authKey: null, name: 'anonymous' };
    const { service, tenants } = buildService({ tenants: [anonymous] });

    const tokens = await service.handleGoogleCallback('code', service.createState(anonymous.tenantId), null);

    // Same tenant, so the children and stories created before signing in are
    // still there afterwards.
    expect(tokens.tenantId).toBe(anonymous.tenantId);
    expect(tenants.rows).toHaveLength(1);
    expect(anonymous).toMatchObject({ authType: 'google', authKey: 'google-sub-1' });
  });

  it('refuses to re-bind a tenant that already belongs to another account', async () => {
    const claimed = { tenantId: '550e8400-e29b-41d4-a716-446655440000', authType: 'google', authKey: 'someone-else' };
    const { service, tenants } = buildService({ tenants: [claimed] });

    const tokens = await service.handleGoogleCallback('code', service.createState(claimed.tenantId), null);

    // A leaked tenant id must not hand someone else's family to an attacker's
    // Google account -- a fresh tenant is created instead.
    expect(tokens.tenantId).not.toBe(claimed.tenantId);
    expect(claimed.authKey).toBe('someone-else');
    expect(tenants.rows).toHaveLength(2);
  });

  it('does not accept an unverified email as the account email', async () => {
    const { service, tenants } = buildService({
      profile: { subject: 'google-sub-2', email: null, displayName: 'Parent' },
    });
    await service.handleGoogleCallback('code', service.createState(null), null);
    expect(tenants.rows[0].email).toBeNull();
  });
});

describe('AuthService sessions', () => {
  async function signIn() {
    const built = buildService();
    const tokens = await built.service.handleGoogleCallback('code', built.service.createState(null), null);
    return { ...built, tokens };
  }

  it('rotates the refresh token on every use', async () => {
    const { service, tokens } = await signIn();
    const next = await service.refreshSession(tokens.refreshToken, null);

    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect(next.tenantId).toBe(tokens.tenantId);
  });

  it('rejects a token that was already rotated away', async () => {
    const { service, tokens } = await signIn();
    await service.refreshSession(tokens.refreshToken, null);

    await expect(service.refreshSession(tokens.refreshToken, null)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('revokes every session for the tenant when a revoked token is replayed', async () => {
    const { service, sessions, tokens } = await signIn();
    await service.logout(tokens.refreshToken);

    await expect(service.refreshSession(tokens.refreshToken, null)).rejects.toThrow(
      UnauthorizedException,
    );
    // Replay means the token leaked; there is no way to tell the thief from
    // the owner, so nothing for this tenant stays valid.
    expect(sessions.rows.every((row: any) => row.revokedAt)).toBe(true);
  });

  it('rejects an unknown refresh token', async () => {
    const { service } = await signIn();
    await expect(service.refreshSession('never-issued', null)).rejects.toThrow(UnauthorizedException);
  });

  it('never stores the raw refresh token', async () => {
    const { sessions, tokens } = await signIn();
    expect(sessions.rows[0].tokenHash).not.toBe(tokens.refreshToken);
    expect(sessions.rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
