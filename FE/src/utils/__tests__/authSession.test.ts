import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAuthSessionForTests,
  beginGoogleLogin,
  consumeTokenFromHash,
  getAccessToken,
  getStoredTenantId,
  hasSignedInBefore,
  isSignedIn,
  refreshAccessToken,
  restoreSession,
  signOut,
} from '../authSession';

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl as any);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe('authSession', () => {
  beforeEach(() => {
    __resetAuthSessionForTests();
    localStorage.clear();
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  describe('consumeTokenFromHash', () => {
    it('stores the token and tenant handed back in the fragment', () => {
      expect(consumeTokenFromHash('#access_token=token-1&tenant_id=tenant-1')).toBe(true);
      expect(getAccessToken()).toBe('token-1');
      expect(getStoredTenantId()).toBe('tenant-1');
      expect(hasSignedInBefore()).toBe(true);
    });

    it('reports failure for a fragment with no token', () => {
      expect(consumeTokenFromHash('#error=oauth_denied')).toBe(false);
      expect(isSignedIn()).toBe(false);
    });

    it('leaves the stored tenant alone when the fragment omits one', () => {
      localStorage.setItem('bsc_tenant_id', 'existing');
      consumeTokenFromHash('#access_token=token-1');
      expect(getStoredTenantId()).toBe('existing');
    });
  });

  describe('beginGoogleLogin', () => {
    it('passes the anonymous tenant along so its data can be adopted', () => {
      localStorage.setItem('bsc_tenant_id', 'anon-tenant');
      const assigned: string[] = [];
      Object.defineProperty(window, 'location', {
        value: { get href() { return ''; }, set href(v: string) { assigned.push(v); }, hash: '' },
        writable: true,
      });

      beginGoogleLogin();

      expect(assigned[0]).toContain('claim_tenant=anon-tenant');
    });
  });

  describe('refreshAccessToken', () => {
    it('shares one request between concurrent callers', async () => {
      // The BE rotates the refresh token on every call, so a second parallel
      // request would send an already-spent cookie and be rejected.
      let resolve!: (value: Response) => void;
      const spy = mockFetch(() => new Promise<Response>((r) => { resolve = r; }));

      const first = refreshAccessToken();
      const second = refreshAccessToken();
      resolve(jsonResponse({ access_token: 'token-2', tenant_id: 'tenant-1' }));

      expect(await first).toBe('token-2');
      expect(await second).toBe('token-2');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('issues a fresh request once the previous one settled', async () => {
      const spy = mockFetch(async () => jsonResponse({ access_token: 'token-2' }));
      await refreshAccessToken();
      await refreshAccessToken();
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('clears the session when the refresh cookie is rejected', async () => {
      localStorage.setItem('bsc_signed_in', '1');
      mockFetch(async () => jsonResponse({}, 401));

      expect(await refreshAccessToken()).toBeNull();
      expect(isSignedIn()).toBe(false);
      expect(hasSignedInBefore()).toBe(false);
    });

    it('does not sign the parent out just because the network failed', async () => {
      consumeTokenFromHash('#access_token=token-1');
      mockFetch(async () => { throw new TypeError('offline'); });

      expect(await refreshAccessToken()).toBeNull();
      // The cookie may still be perfectly good; only a real 401 is a logout.
      expect(hasSignedInBefore()).toBe(true);
    });
  });

  describe('restoreSession', () => {
    it('skips the round trip for a visitor who never signed in', async () => {
      const spy = mockFetch(async () => jsonResponse({ access_token: 'x' }));
      expect(await restoreSession()).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    });

    it('trades the cookie back for a token when there was a session', async () => {
      localStorage.setItem('bsc_signed_in', '1');
      const spy = mockFetch(async () => jsonResponse({ access_token: 'token-3', tenant_id: 't' }));

      expect(await restoreSession()).toBe('token-3');
      await restoreSession();
      // At most one attempt per page load.
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('signOut', () => {
    it('drops the token even if the BE call fails', async () => {
      consumeTokenFromHash('#access_token=token-1');
      mockFetch(async () => { throw new TypeError('offline'); });

      await expect(signOut()).rejects.toThrow();
      expect(isSignedIn()).toBe(false);
      expect(hasSignedInBefore()).toBe(false);
    });
  });
});
