import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminLogin, fetchAdminFeedbacks } from '../adminClient';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import { ApiError } from '../../utils/api';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('adminClient', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('never bootstraps a tenant', async () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ items: [], total: 0, limit: 20, offset: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchAdminFeedbacks(new URLSearchParams({ limit: '20' }));

    // apiClient would have called POST /api/tenant/init first, minting an
    // anonymous tenant on every console load.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain('/tenant/init');
    expect(url).toBe('/api/admin/feedbacks?limit=20');
    expect((init.headers as Record<string, string>)['X-Tenant-Id']).toBeUndefined();
  });

  it('sends the bearer token on feedback requests', async () => {
    const token = liveToken();
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ items: [], total: 0, limit: 20, offset: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchAdminFeedbacks(new URLSearchParams());

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('does not send an Authorization header on login', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ token: 'tok', expires_at: 'x', admin: { admin_id: 'a1', username: 'thang' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await adminLogin('thang', 'pw');

    expect(result.token).toBe('tok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/login');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ username: 'thang', password: 'pw' });
  });

  it('throws UNAUTHORIZED and clears the token on a 401', async () => {
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'hết hạn' } }, 401),
    ));

    await expect(fetchAdminFeedbacks(new URLSearchParams())).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('fails fast with UNAUTHORIZED when no token is stored', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAdminFeedbacks(new URLSearchParams())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the BE error code on a 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'LOGIN_THROTTLED', message: 'thử lại sau', retry_after: 840 } }, 429),
    ));

    const err = await adminLogin('thang', 'pw').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('LOGIN_THROTTLED');
    expect(err.status).toBe(429);
  });

  it('reports a transport failure as NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    const err = await adminLogin('thang', 'pw').catch((e) => e);
    expect(err.code).toBe('NETWORK_ERROR');
  });
});
