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
    const calls = [];
    const fetchMock = vi.fn((url) => {
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
});