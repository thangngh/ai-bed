import { Injectable, NestMiddleware, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  lastSeen: number;
  capacity: number;
  refillRate: number;
}

/**
 * A bucket is only worth keeping while it still remembers a debt. Once it has
 * refilled to capacity it is indistinguishable from a brand new one, so
 * dropping it changes no decision -- it only frees the entry.
 */
const IDLE_EVICT_MS = 10 * 60 * 1000;

/** Sweep at most this often; the scan is O(buckets) and runs inline. */
const SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * Hard ceiling on tracked tenants. Reached only under an attack -- a client
 * that mints a fresh tenant UUID per request already gets a fresh quota, so
 * the map was pure cost. Past this we sweep regardless of the interval.
 */
const MAX_BUCKETS = 10_000;

@Injectable()
export class RateLimiterMiddleware implements NestMiddleware {
  /**
   * Keyed by the self-asserted X-Tenant-Id. That makes the limit a courtesy
   * rather than a defence -- rotating the UUID resets it -- and it used to
   * make this map unbounded: every UUID an attacker invented left an entry
   * behind for the life of the process. The per-IP limit in FE/nginx.conf is
   * the layer that an attacker cannot opt out of; this one shapes honest
   * traffic, and now forgets what it no longer needs.
   */
  private buckets = new Map<string, TokenBucket>();
  private lastSweep = Date.now();
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(private readonly configService: ConfigService) {
    this.capacity = this.configService.get<number>('rateLimit.capacity', 10);
    this.refillRate = this.configService.get<number>('rateLimit.refillRate', 60);
  }

  private sweep(now: number) {
    if (now - this.lastSweep < SWEEP_INTERVAL_MS && this.buckets.size < MAX_BUCKETS) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens >= bucket.capacity && now - bucket.lastSeen > IDLE_EVICT_MS) {
        this.buckets.delete(key);
      }
    }
  }

  use(req: Request, res: Response, next: NextFunction) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) return next();

    this.sweep(Date.now());

    let bucket = this.buckets.get(tenantId);
    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefill: Date.now(),
        lastSeen: Date.now(),
        capacity: this.capacity,
        refillRate: this.refillRate,
      };
      this.buckets.set(tenantId, bucket);
    }

    const now = Date.now();
    bucket.lastSeen = now;
    const elapsed = (now - bucket.lastRefill) / 1000;
    const refillTokens = Math.floor(elapsed / bucket.refillRate);
    if (refillTokens > 0) {
      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + refillTokens);
      bucket.lastRefill = now;
    }

    if (bucket.tokens <= 0) {
      const waitSeconds = Math.ceil(bucket.refillRate - (elapsed % bucket.refillRate));
      res.setHeader('Retry-After', waitSeconds);
      throw new HttpException({
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Quá nhiều yêu cầu', retry_after: waitSeconds },
      }, 429);
    }

    bucket.tokens -= 1;
    next();
  }
}
