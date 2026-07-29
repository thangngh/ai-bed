const API_BASE = import.meta.env.VITE_BE_URL || '/api';

let tenantIdPromise: Promise<string> | null = null;

async function ensureTenantId(): Promise<string> {
  const stored = localStorage.getItem('bsc_tenant_id');
  if (stored) return stored;

  if (!tenantIdPromise) {
    tenantIdPromise = (async () => {
      const res = await fetch(`${API_BASE}/tenant/init`, { method: 'POST' });
      const data = await res.json();
      localStorage.setItem('bsc_tenant_id', data.tenant_id);
      return data.tenant_id;
    })();
  }

  return tenantIdPromise;
}

export async function apiClient<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const tenantId = await ensureTenantId();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { code: 'UNKNOWN' } }));
    throw new Error(err.error?.code || 'API_ERROR');
  }

  return res.json();
}
