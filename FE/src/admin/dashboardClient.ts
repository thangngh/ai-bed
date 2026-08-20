import { adminFetch } from './adminClient';
import type {
  Alert, ApplyResult, CreateRuleBody, DeletedResult, IngestResult,
  IpRule, IpState, Paged, UnblockedResult, UpdateRuleBody,
} from './dashboardTypes';

/**
 * Split from adminClient.ts on purpose: that file would otherwise grow to a
 * dozen functions spanning login, feedback and the dashboard. They share the
 * one thing worth sharing -- adminFetch.
 */
const BASE = '/admin/dashboard';

/** Keeps a bare path bare: `?` with nothing after it is not a valid query. */
function query(params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchIpRules(): Promise<IpRule[]> {
  return adminFetch<IpRule[]>(`${BASE}/ip/rules`, { method: 'GET' }, true);
}

export function createIpRule(body: CreateRuleBody): Promise<IpRule> {
  return adminFetch<IpRule>(`${BASE}/ip/rules`, { method: 'POST', body: JSON.stringify(body) }, true);
}

export function updateIpRule(id: number, patch: UpdateRuleBody): Promise<IpRule> {
  return adminFetch<IpRule>(`${BASE}/ip/rules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }, true);
}

export function deleteIpRule(id: number): Promise<DeletedResult> {
  return adminFetch<DeletedResult>(`${BASE}/ip/rules/${id}`, { method: 'DELETE' }, true);
}

export function applyIpRules(): Promise<ApplyResult> {
  return adminFetch<ApplyResult>(`${BASE}/ip/rules/apply`, { method: 'POST' }, true);
}

export function fetchIpStates(params: URLSearchParams): Promise<Paged<IpState>> {
  return adminFetch<Paged<IpState>>(`${BASE}/ip/states${query(params)}`, { method: 'GET' }, true);
}

export function unblockIp(ip: string): Promise<UnblockedResult> {
  // An IPv6 address is mostly colons; it cannot go into a path segment raw.
  return adminFetch<UnblockedResult>(`${BASE}/ip/states/${encodeURIComponent(ip)}`, { method: 'DELETE' }, true);
}

export function fetchAlerts(params: URLSearchParams): Promise<Paged<Alert>> {
  return adminFetch<Paged<Alert>>(`${BASE}/alerts${query(params)}`, { method: 'GET' }, true);
}

export function resolveAlert(id: number): Promise<Alert> {
  return adminFetch<Alert>(`${BASE}/alerts/${id}/resolve`, { method: 'PATCH' }, true);
}

export function ingestTraffic(logPath: string): Promise<IngestResult> {
  return adminFetch<IngestResult>(
    `${BASE}/traffic/ingest`,
    { method: 'POST', body: JSON.stringify({ logPath }) },
    true,
  );
}
