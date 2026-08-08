import { ApiError } from '../utils/api';
import { clearToken, getToken } from './adminSession';
import type { AdminFeedbackPage, LoginResponse } from './types';

const API_BASE = import.meta.env.VITE_BE_URL || '/api';
const TIMEOUT_MS = 15_000;

/**
 * Deliberately not `apiClient` from utils/api: that one calls ensureTenantId(),
 * which POSTs /tenant/init and mints an anonymous tenant. The BE excludes
 * /admin from the tenant middleware for the same reason -- the console must not
 * create tenant rows just by being opened.
 */
async function adminFetch<T>(path: string, init: RequestInit, withAuth: boolean): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };

  if (withAuth) {
    const token = getToken();
    if (!token) {
      throw new ApiError('UNAUTHORIZED', 'Phiên đã hết hạn. Vui lòng đăng nhập lại.');
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'Quá thời gian chờ');
    }
    throw new ApiError('NETWORK_ERROR', 'Không kết nối được máy chủ');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    // One place handles expiry: screens only have to catch and redirect.
    clearToken();
    throw new ApiError('UNAUTHORIZED', 'Phiên không hợp lệ hoặc đã hết hạn', 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error?.code || 'API_ERROR', body?.error?.message, res.status);
  }

  return res.json() as Promise<T>;
}

export function adminLogin(username: string, password: string): Promise<LoginResponse> {
  return adminFetch<LoginResponse>(
    '/admin/login',
    { method: 'POST', body: JSON.stringify({ username, password }) },
    false,
  );
}

export function fetchAdminFeedbacks(params: URLSearchParams): Promise<AdminFeedbackPage> {
  const query = params.toString();
  return adminFetch<AdminFeedbackPage>(
    `/admin/feedbacks${query ? `?${query}` : ''}`,
    { method: 'GET' },
    true,
  );
}
