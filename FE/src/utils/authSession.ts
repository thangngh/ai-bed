/**
 * Parent session state for the SPA.
 *
 * The access token is held in a module variable and never in localStorage: a
 * script injected into this page could read localStorage, but cannot read a
 * closure, and the refresh token it would need to mint a new one is httpOnly.
 * The cost is that a reload starts with no token -- `restoreSession()` buys it
 * back from the refresh cookie.
 */
const API_BASE = import.meta.env.VITE_BE_URL || '/api';

/** Survives reloads; identifies the tenant for anonymous (pre-login) use. */
const TENANT_STORAGE_KEY = 'bsc_tenant_id';

/**
 * Not a credential -- just a hint that a refresh cookie is worth trying. It
 * keeps never-signed-in visitors from paying a doomed /auth/refresh round trip
 * on every cold start.
 */
const SIGNED_IN_HINT_KEY = 'bsc_signed_in';

let accessToken: string | null = null;
let inFlightRefresh: Promise<string | null> | null = null;
const listeners = new Set<() => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function isSignedIn(): boolean {
  return accessToken !== null;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((listener) => listener());
}

export function getStoredTenantId(): string | null {
  try {
    return localStorage.getItem(TENANT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setSignedInHint(value: boolean): void {
  try {
    if (value) localStorage.setItem(SIGNED_IN_HINT_KEY, '1');
    else localStorage.removeItem(SIGNED_IN_HINT_KEY);
  } catch {
    // Storage denied: restoreSession() just skips the optimistic attempt.
  }
}

export function hasSignedInBefore(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function storeTenantId(tenantId: string): void {
  try {
    localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  } catch {
    // Private mode with storage denied: the session still works for this tab.
  }
}

/**
 * Reads the token the BE handed back in the URL fragment.
 *
 * Called during render rather than from an effect on purpose: navigating away
 * from the callback clears the fragment, and under StrictMode a second effect
 * run would then find nothing and conclude the login had failed.
 */
export function consumeTokenFromHash(hash: string = window.location.hash): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('access_token');
  if (!token) return false;

  const tenantId = params.get('tenant_id');
  if (tenantId) storeTenantId(tenantId);
  setSignedInHint(true);
  setAccessToken(token);
  return true;
}

export function beginGoogleLogin(): void {
  const params = new URLSearchParams();
  // Hands the anonymous tenant to the BE so the children and stories created
  // before signing in are adopted by the account rather than orphaned.
  const anonymousTenant = getStoredTenantId();
  if (anonymousTenant) params.set('claim_tenant', anonymousTenant);
  window.location.href = `${API_BASE}/auth/google?${params.toString()}`;
}

/**
 * Trades the httpOnly refresh cookie for a new access token.
 *
 * Single-flight: the BE rotates the refresh token on every call, so two
 * concurrent refreshes would both send the same cookie and the second would be
 * rejected against an already-rotated token -- logging the parent out for no
 * reason. Every caller shares one request.
 */
export function refreshAccessToken(): Promise<string | null> {
  inFlightRefresh ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        setSignedInHint(false);
        setAccessToken(null);
        return null;
      }
      const data = await res.json();
      if (!data?.access_token) {
        setAccessToken(null);
        return null;
      }
      if (data.tenant_id) storeTenantId(data.tenant_id);
      setSignedInHint(true);
      setAccessToken(data.access_token);
      return data.access_token as string;
    } catch {
      // Offline or BE down. Not a logout: the cookie may still be good.
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

let restored: Promise<string | null> | null = null;

/** Attempts at most one silent refresh per page load. */
export function restoreSession(): Promise<string | null> {
  if (!hasSignedInBefore()) return Promise.resolve(null);
  restored ??= refreshAccessToken();
  return restored;
}

export async function signOut(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } finally {
    setSignedInHint(false);
    setAccessToken(null);
  }
}

/** Test seam only: drops module state between cases. */
export function __resetAuthSessionForTests(): void {
  accessToken = null;
  inFlightRefresh = null;
  restored = null;
  listeners.clear();
}
