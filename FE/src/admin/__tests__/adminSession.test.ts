import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { ADMIN_TOKEN_KEY, clearToken, getToken, readExpiry, setToken } from '../adminSession';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Signature content is irrelevant here -- the BE is what verifies it. */
function tokenWithExp(expSeconds: number): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'a1', username: 'thang', iat: 0, exp: expSeconds })}.sig`;
}

describe('adminSession', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T12:00:00Z'));
  });

  afterEach(() => { vi.useRealTimers(); });

  const nowSeconds = () => Math.floor(Date.now() / 1000);

  it('round-trips a token that has not expired', () => {
    const token = tokenWithExp(nowSeconds() + 3600);
    setToken(token);
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBe(token);
    expect(getToken()).toBe(token);
  });

  it('returns null when nothing is stored', () => {
    expect(getToken()).toBeNull();
  });

  it('returns null and clears storage for an expired token', () => {
    setToken(tokenWithExp(nowSeconds() - 1));
    expect(getToken()).toBeNull();
    // Leaving a dead token behind would make every reload retry it.
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('returns null for a malformed token instead of throwing', () => {
    for (const bad of ['', 'garbage', 'a.b', 'a.b.c.d', 'a.!!!.c']) {
      localStorage.setItem(ADMIN_TOKEN_KEY, bad);
      expect(() => getToken()).not.toThrow();
      expect(getToken()).toBeNull();
    }
  });

  it('returns null for a token whose payload has no exp', () => {
    const noExp = `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang' })}.sig`;
    localStorage.setItem(ADMIN_TOKEN_KEY, noExp);
    expect(getToken()).toBeNull();
  });

  it('clearToken removes the key', () => {
    setToken(tokenWithExp(nowSeconds() + 3600));
    clearToken();
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('readExpiry returns the exp claim in seconds', () => {
    const exp = nowSeconds() + 120;
    expect(readExpiry(tokenWithExp(exp))).toBe(exp);
    expect(readExpiry('garbage')).toBeNull();
  });
});
