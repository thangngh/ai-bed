import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';

const VALID_TENANT = '12345678-1234-4123-8123-123456789abc';

describe('apiClient', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bootstraps tenant once and caches it', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      calls.push(url);
      if (url === '/api/tenant/init') {
        return Promise.resolve({ ok: true, json: async () => ({ tenant_id: VALID_TENANT }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ children: [] }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    await apiClient('/child-profile');
    await apiClient('/child-profile');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(calls[0]).toBe('/api/tenant/init');
    expect(calls[1]).toBe('/api/child-profile');
    expect(calls[2]).toBe('/api/child-profile');
    expect(fetchMock.mock.calls[1][1].headers['X-Tenant-Id']).toBe(VALID_TENANT);
    expect(fetchMock.mock.calls[2][1].headers['X-Tenant-Id']).toBe(VALID_TENANT);
  });

  it('reuses stored tenant without calling /tenant/init', async () => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await apiClient('/memory/context/x');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/memory/context/x');
    expect(fetchMock.mock.calls[0][1].headers['X-Tenant-Id']).toBe(VALID_TENANT);
  });

  it('throws error code on non-2xx', async () => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: 'AGE_OUT_OF_RANGE', message: 'Tuổi không hợp lệ' } }),
    }));

    await expect(apiClient('/story/create', { method: 'POST' }))
      .rejects.toThrow('AGE_OUT_OF_RANGE');
  });

  it('throws API_ERROR when response body has no error code', async () => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }));

    await expect(apiClient('/story/create', { method: 'POST' }))
      .rejects.toThrow('API_ERROR');
  });

  it('carries the BE status and message on the error', async () => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: { code: 'ENGINE_TIMEOUT', message: 'Engine timeout after 60s' } }),
    }));

    await expect(apiClient('/story/create', { method: 'POST' })).rejects.toMatchObject({
      code: 'ENGINE_TIMEOUT',
      detail: 'Engine timeout after 60s',
      status: 502,
    });
  });

  it('returns without parsing a body on 204', async () => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    const json = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json }));

    // DELETE /child-profile/:id answers 204; parsing it used to throw.
    await expect(apiClient('/child-profile/abc', { method: 'DELETE' })).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it('reports an aborted request as TIMEOUT', async () => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    await expect(apiClient('/story/create', { method: 'POST' })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('reports a transport failure as NETWORK_ERROR', async () => {
    localStorage.setItem('bsc_tenant_id', VALID_TENANT);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(apiClient('/child-profile')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('retries tenant bootstrap after a failure instead of caching the rejection', async () => {
    // A fresh module instance: the in-flight tenant promise is module state and
    // earlier tests in this file have already resolved it.
    vi.resetModules();
    const { apiClient: freshClient } = await import('../api');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tenant_id: VALID_TENANT }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ children: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(freshClient('/child-profile')).rejects.toMatchObject({ code: 'TENANT_INIT_FAILED' });
    await expect(freshClient('/child-profile')).resolves.toEqual({ children: [] });
    expect(localStorage.getItem('bsc_tenant_id')).toBe(VALID_TENANT);
  });
});
