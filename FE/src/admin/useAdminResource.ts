import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../utils/api';
import { clearToken } from './adminSession';

const ERROR_MESSAGES: Record<string, string> = {
  TIMEOUT: 'Máy chủ phản hồi quá lâu. Thử lại.',
  NETWORK_ERROR: 'Không kết nối được máy chủ.',
  // Generic on purpose: shared across screens whose 422 payload can be a
  // query string, a filter, or a form body. A screen that needs sharper
  // wording (e.g. AdminFeedbackScreen) still overrides this via `messages`.
  VALIDATION_ERROR: 'Dữ liệu gửi lên không hợp lệ.',
};

/**
 * `ApiError.message` is deliberately the bare code so `toThrow('CODE')` checks
 * keep working -- the human-readable text the BE sent lives in `detail`. Using
 * `message` here would show an operator the string 'API_ERROR'.
 *
 * The unmapped branch prefers the BE's own text: the dashboard returns useful,
 * specific sentences ('Log path is outside the configured log directory') and
 * replacing them with a generic line throws away the only information there
 * is. The cost is that those sentences are in English, so a screen can mix two
 * languages. That is the better trade.
 */
export function messageFor(
  err: unknown,
  fallback = 'Có lỗi xảy ra.',
  overrides: Record<string, string> = {},
): string {
  if (!(err instanceof ApiError)) return fallback;
  const mapped = overrides[err.code] ?? ERROR_MESSAGES[err.code];
  if (mapped) return mapped;
  return err.detail || fallback;
}

export interface AdminResource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export interface AdminResourceOptions {
  /** Poll interval. Omit (or pass undefined) to disable polling entirely. */
  pollMs?: number;
  fallbackMessage?: string;
  /** Per-screen copy for specific codes, merged over the shared table. */
  messages?: Record<string, string>;
}

export function useAdminResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: AdminResourceOptions = {},
): AdminResource<T> {
  const { pollMs, fallbackMessage, messages } = opts;
  const navigate = useNavigate();

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // A request that started before the key changed must not overwrite the newer
  // result. Only the highest sequence number may touch state.
  const seq = useRef(0);

  // `fetcher` is a fresh closure on every render, so it can never be a
  // dependency -- `key` stands in for it, exactly as the screens' URL string
  // stands in for their URLSearchParams instance.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const run = useCallback(
    async (showLoading: boolean) => {
      const mine = ++seq.current;
      if (showLoading) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await fetcherRef.current();
        if (mine !== seq.current) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
          // Redirect even mid-poll. Once the token is dead every later request
          // is a 401 too, and sitting on stale rows is worse than leaving.
          clearToken();
          navigate('/admin/login', { replace: true });
          return;
        }
        if (mine !== seq.current) return;
        // Note what is NOT here: `setData(null)`. A failed poll keeps the rows
        // it already has and only raises a banner.
        setError(messageFor(err, fallbackMessage, messagesRef.current));
      } finally {
        if (mine === seq.current && showLoading) setLoading(false);
      }
    },
    [navigate, fallbackMessage],
  );

  useEffect(() => {
    void run(true);
  }, [key, nonce, run]);

  useEffect(() => {
    if (!pollMs) return undefined;

    // A background poll passes showLoading=false: otherwise the table blinks
    // back to its skeleton every interval.
    const poll = () => {
      if (!document.hidden) void run(false);
    };
    const timer = setInterval(poll, pollMs);

    // Resuming the timer alone would leave the operator looking at data up to
    // one full interval old, so fetch immediately on return.
    const onVisibility = () => {
      if (!document.hidden) void run(false);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [pollMs, key, nonce, run]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}

export interface AdminAction {
  busy: boolean;
  actionError: string | null;
  run: (fn: () => Promise<unknown>, after?: () => void) => Promise<void>;
}

/**
 * Writes do not go through useAdminResource: they have no `data`, and their
 * failure belongs next to the control that was clicked rather than replacing
 * the screen. What they do share is the 401 handling and the message table.
 */
export function useAdminAction(fallbackMessage = 'Không thực hiện được. Thử lại.'): AdminAction {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<unknown>, after?: () => void) => {
      setBusy(true);
      setActionError(null);
      try {
        await fn();
        after?.();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'UNAUTHORIZED') {
          clearToken();
          navigate('/admin/login', { replace: true });
          return;
        }
        setActionError(messageFor(err, fallbackMessage));
      } finally {
        setBusy(false);
      }
    },
    [navigate, fallbackMessage],
  );

  return { busy, actionError, run };
}
