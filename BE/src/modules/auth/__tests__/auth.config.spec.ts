import { readParentAuthConfig, DEFAULT_ACCESS_TTL_SECONDS, DEFAULT_REFRESH_TTL_DAYS } from '../auth.config';

const FULL_ENV = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3001/auth/google/callback',
  FRONTEND_CALLBACK_URL: 'http://localhost:3000/auth/callback',
  PARENT_JWT_SECRET: 'd'.repeat(48),
} as NodeJS.ProcessEnv;

describe('readParentAuthConfig', () => {
  it('reports itself disabled when GOOGLE_CLIENT_ID is absent', () => {
    // Deployments that never opt in must keep booting exactly as before.
    expect(readParentAuthConfig({} as NodeJS.ProcessEnv)).toEqual({ enabled: false });
  });

  it('fills in defaults for the optional knobs', () => {
    const config = readParentAuthConfig({ ...FULL_ENV });
    expect(config).toMatchObject({
      enabled: true,
      accessTtlSeconds: DEFAULT_ACCESS_TTL_SECONDS,
      refreshTtlDays: DEFAULT_REFRESH_TTL_DAYS,
      refreshCookiePath: '/',
    });
  });

  it('fails loudly on a half-filled config rather than at the first login', () => {
    expect(() => readParentAuthConfig({ ...FULL_ENV, GOOGLE_CLIENT_SECRET: '' })).toThrow(
      /GOOGLE_CLIENT_SECRET/,
    );
    expect(() => readParentAuthConfig({ ...FULL_ENV, GOOGLE_CALLBACK_URL: '' })).toThrow(
      /GOOGLE_CALLBACK_URL/,
    );
    expect(() => readParentAuthConfig({ ...FULL_ENV, FRONTEND_CALLBACK_URL: 'not-a-url' })).toThrow(
      /absolute URL/,
    );
  });

  it('rejects a short signing secret', () => {
    expect(() => readParentAuthConfig({ ...FULL_ENV, PARENT_JWT_SECRET: 'short' })).toThrow(
      /PARENT_JWT_SECRET/,
    );
  });

  it('never echoes the rejected secret', () => {
    // The message lands in logs and crash reports.
    const secret = 'e'.repeat(10);
    try {
      readParentAuthConfig({ ...FULL_ENV, PARENT_JWT_SECRET: secret });
      fail('expected a throw');
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('rejects a non-positive TTL', () => {
    expect(() => readParentAuthConfig({ ...FULL_ENV, PARENT_ACCESS_TTL_SECONDS: '0' })).toThrow();
    expect(() => readParentAuthConfig({ ...FULL_ENV, PARENT_REFRESH_TTL_DAYS: '-1' })).toThrow();
    expect(() => readParentAuthConfig({ ...FULL_ENV, PARENT_ACCESS_TTL_SECONDS: 'abc' })).toThrow();
  });
});
