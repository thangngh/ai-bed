// Same-origin by default: `vite dev`/`vite preview` and nginx both proxy
// `/api/*` to the BE and strip the prefix. VITE_BE_URL overrides the whole base
// for setups where the SPA calls a separately hosted BE directly (no prefix).
const API_BASE = import.meta.env.VITE_BE_URL || '/api';

/** Normal CRUD calls. Anything slower than this is a stuck BE, not a slow one. */
const DEFAULT_TIMEOUT_MS = 15_000;
/**
 * Story generation is Engine -> LLM bound. BE's own ceiling is ENGINE_TIMEOUT_MS
 * plus queue wait, and the proxies allow 240s; the SPA must not abandon a
 * request the BE is still going to answer.
 *
 * 240s and not 180s because the outermost limit sets the Engine's whole budget:
 * on the free OpenRouter tier the writer stage alone has been measured between
 * 25s and 85s, and a ceiling that forces PIPELINE_BUDGET_SECONDS down to 100
 * turns half of all requests into the fallback apology. The parent waits
 * longer in the worst case and gets a real story instead.
 */
export const STORY_TIMEOUT_MS = 240_000;

import {
  getAccessToken,
  getStoredTenantId,
  refreshAccessToken,
  restoreSession,
} from './authSession';

export class ApiError extends Error {
  constructor(
    /** Machine-readable code: the BE's `error.code`, or a client-side one. */
    public readonly code: string,
    /** Human-readable text from the BE, when it sent one. */
    public readonly detail?: string,
    /** HTTP status, absent for client-side failures (timeout / offline). */
    public readonly status?: number,
  ) {
    // The message stays the bare code so existing `toThrow('CODE')` checks and
    // code comparisons keep working.
    super(code);
    this.name = 'ApiError';
  }
}

let tenantIdPromise: Promise<string> | null = null;

export interface ApiOptions extends RequestInit {
  /** Abort after this many ms. Ignored when the caller supplies its own signal. */
  timeoutMs?: number;
}

async function ensureTenantId(): Promise<string | null> {
  // A signed-in parent's tenant comes from the token the BE verifies, so there
  // is nothing to bootstrap and nothing worth asserting in a header.
  if (getAccessToken()) return getStoredTenantId();

  // A reload drops the in-memory token; trade the refresh cookie back for one
  // before falling through to the anonymous path, or signing in would silently
  // downgrade to a fresh empty tenant on every refresh of the page.
  if (await restoreSession()) return getStoredTenantId();

  const stored = localStorage.getItem('bsc_tenant_id');
  if (stored) return stored;

  if (!tenantIdPromise) {
    tenantIdPromise = (async () => {
      const res = await fetch(`${API_BASE}/tenant/init`, { method: 'POST' });
      if (!res.ok) {
        throw new ApiError('TENANT_INIT_FAILED', 'Không khởi tạo được phiên', res.status);
      }
      const data = await res.json();
      if (!data?.tenant_id) {
        throw new ApiError('TENANT_INIT_FAILED', 'Phản hồi tenant không hợp lệ', res.status);
      }
      localStorage.setItem('bsc_tenant_id', data.tenant_id);
      return data.tenant_id;
    })().catch((err) => {
      // Without this reset a single failed bootstrap would poison every later
      // call with the same rejected promise, even after the BE comes back.
      tenantIdPromise = null;
      throw err;
    });
  }

  return tenantIdPromise;
}

export async function apiClient<T = any>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const tenantId = await ensureTenantId();
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;

  const send = async (): Promise<Response> => {
    const controller = init.signal ? null : new AbortController();
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

    const accessToken = getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      // Only sent when there is no token. The BE ignores it for authenticated
      // requests, but sending both would suggest the header still decides
      // something -- it does not.
      ...(!accessToken && tenantId ? { 'X-Tenant-Id': tenantId } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };

    try {
      return await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: init.signal ?? controller?.signal,
        credentials: 'include',
        headers,
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  let res: Response;
  try {
    res = await send();

    // An access token lives ~15 minutes, so an expired one is the ordinary
    // case, not an error. Refresh once and replay; a second 401 is a real
    // logout and falls through to the error path below.
    if (res.status === 401 && getAccessToken()) {
      const refreshed = await refreshAccessToken();
      if (refreshed) res = await send();
    }
  } catch (err: any) {
    // fetch only rejects for transport-level failures: aborts and offline.
    if (err?.name === 'AbortError') {
      throw new ApiError('TIMEOUT', `Quá thời gian chờ (${Math.round(timeoutMs / 1000)}s)`);
    }
    throw new ApiError('NETWORK_ERROR', 'Không kết nối được máy chủ');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      body?.error?.code || 'API_ERROR',
      body?.error?.message,
      res.status,
    );
  }

  // 204 from e.g. DELETE /child-profile/:id has no body to parse.
  if (res.status === 204 || res.status === 205) return undefined as T;

  return res.json();
}
