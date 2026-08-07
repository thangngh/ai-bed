import { readAdminConfig, MIN_SECRET_LENGTH } from '../admin.config';

const validSecret = 'x'.repeat(MIN_SECRET_LENGTH);

describe('readAdminConfig', () => {
  it('accepts a long enough secret and defaults the TTL to 8 hours', () => {
    expect(readAdminConfig({ ADMIN_JWT_SECRET: validSecret } as any)).toEqual({
      secret: validSecret,
      ttlSeconds: 28800,
    });
  });

  it('reads an explicit TTL', () => {
    const config = readAdminConfig({ ADMIN_JWT_SECRET: validSecret, ADMIN_JWT_TTL_SECONDS: '3600' } as any);
    expect(config.ttlSeconds).toBe(3600);
  });

  it('throws when the secret is missing', () => {
    // A default secret is exactly how forgeable admin tokens happen, so this
    // has to be fatal rather than a warning.
    expect(() => readAdminConfig({} as any)).toThrow(/ADMIN_JWT_SECRET/);
  });

  it('throws when the secret is too short, and never echoes it', () => {
    const short = 'abc';
    try {
      readAdminConfig({ ADMIN_JWT_SECRET: short } as any);
      fail('expected a throw');
    } catch (err: any) {
      expect(err.message).toContain('ADMIN_JWT_SECRET');
      expect(err.message).toContain(String(MIN_SECRET_LENGTH));
      expect(err.message).not.toContain(short);
    }
  });

  it('throws on a non-numeric or non-positive TTL', () => {
    for (const bad of ['abc', '0', '-1', '1.5']) {
      expect(() => readAdminConfig({ ADMIN_JWT_SECRET: validSecret, ADMIN_JWT_TTL_SECONDS: bad } as any))
        .toThrow(/ADMIN_JWT_TTL_SECONDS/);
    }
  });
});
