export const ADMIN_TOKEN_KEY = 'bsc_admin_token';

/**
 * Reads the `exp` claim without verifying the signature. This is only a way to
 * avoid firing a request that is certain to fail -- the BE is the authority on
 * whether a token is valid.
 */
export function readExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    return typeof payload?.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) return null;

  const exp = readExpiry(token);
  if (exp === null || exp <= Math.floor(Date.now() / 1000)) {
    // Drop it now rather than retrying a dead token on every reload.
    clearToken();
    return null;
  }
  return token;
}

export function setToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}
