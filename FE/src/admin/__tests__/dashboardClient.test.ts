import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import * as api from '../dashboardClient';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('dashboardClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    fetchMock = vi.fn().mockResolvedValue(okResponse({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const urlOf = () => String(fetchMock.mock.calls[0][0]);
  const initOf = () => fetchMock.mock.calls[0][1] as RequestInit;

  it('sends an authorized GET for the rules list', async () => {
    fetchMock.mockResolvedValue(okResponse([]));
    await api.fetchIpRules();
    expect(urlOf()).toContain('/admin/dashboard/ip/rules');
    expect(initOf().method).toBe('GET');
    expect((initOf().headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it('posts the create-rule body as JSON', async () => {
    await api.createIpRule({ type: 'ip', pattern: '10.0.0.9', action: 'deny', tier: 'default', note: null });
    expect(initOf().method).toBe('POST');
    expect(JSON.parse(String(initOf().body))).toEqual({
      type: 'ip', pattern: '10.0.0.9', action: 'deny', tier: 'default', note: null,
    });
  });

  it('patches a rule by id', async () => {
    await api.updateIpRule(7, { enabled: false });
    expect(urlOf()).toContain('/admin/dashboard/ip/rules/7');
    expect(initOf().method).toBe('PATCH');
    expect(JSON.parse(String(initOf().body))).toEqual({ enabled: false });
  });

  it('deletes a rule by id', async () => {
    await api.deleteIpRule(7);
    expect(urlOf()).toContain('/admin/dashboard/ip/rules/7');
    expect(initOf().method).toBe('DELETE');
  });

  it('posts to the apply endpoint with no body', async () => {
    await api.applyIpRules();
    expect(urlOf()).toContain('/admin/dashboard/ip/rules/apply');
    expect(initOf().method).toBe('POST');
    expect(initOf().body).toBeUndefined();
  });

  it('passes the states query through', async () => {
    await api.fetchIpStates(new URLSearchParams({ status: 'perm_blocked', limit: '50' }));
    expect(urlOf()).toContain('/admin/dashboard/ip/states?status=perm_blocked&limit=50');
  });

  it('omits the question mark when there is no query', async () => {
    await api.fetchIpStates(new URLSearchParams());
    expect(urlOf()).toMatch(/ip\/states$/);
  });

  it('encodes the IP in the unblock path', async () => {
    // An IPv6 address is full of colons; unencoded they would be read as part
    // of the URL structure.
    await api.unblockIp('2001:db8::1');
    expect(urlOf()).toContain('/admin/dashboard/ip/states/2001%3Adb8%3A%3A1');
    expect(initOf().method).toBe('DELETE');
  });

  it('patches an alert to resolved', async () => {
    await api.resolveAlert(42);
    expect(urlOf()).toContain('/admin/dashboard/alerts/42/resolve');
    expect(initOf().method).toBe('PATCH');
  });

  it('posts the log path to ingest', async () => {
    await api.ingestTraffic('/var/log/nginx/access.log');
    expect(urlOf()).toContain('/admin/dashboard/traffic/ingest');
    expect(JSON.parse(String(initOf().body))).toEqual({ logPath: '/var/log/nginx/access.log' });
  });
});
