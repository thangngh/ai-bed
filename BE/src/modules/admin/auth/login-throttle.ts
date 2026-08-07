export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

const DEFAULT_MAX_FAILURES = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

interface Entry {
  count: number;
  firstAt: number;
}

/**
 * Keyed by username rather than IP: the BE sits behind Cloudflare Tunnel and
 * nginx, so req.ip is the proxy's and a per-IP limit would be a global one --
 * one attacker would lock out the real admin.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, Entry>();

  constructor(
    private readonly maxFailures: number = DEFAULT_MAX_FAILURES,
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
    private readonly clock: () => number = Date.now,
  ) {}

  private key(username: string): string {
    return String(username ?? '').trim().toLowerCase();
  }

  check(username: string): ThrottleDecision {
    const key = this.key(username);
    const entry = this.failures.get(key);
    if (!entry) return { allowed: true, retryAfterSeconds: 0 };

    const elapsed = this.clock() - entry.firstAt;
    if (elapsed >= this.windowMs) {
      this.failures.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (entry.count < this.maxFailures) return { allowed: true, retryAfterSeconds: 0 };

    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((this.windowMs - elapsed) / 1000),
    };
  }

  recordFailure(username: string): void {
    const key = this.key(username);
    const entry = this.failures.get(key);
    const now = this.clock();
    if (!entry || now - entry.firstAt >= this.windowMs) {
      this.failures.set(key, { count: 1, firstAt: now });
      return;
    }
    entry.count += 1;
  }

  recordSuccess(username: string): void {
    this.failures.delete(this.key(username));
  }
}
