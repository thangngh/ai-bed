import { Injectable, NestMiddleware, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number;
}

@Injectable()
export class RateLimiterMiddleware implements NestMiddleware {
  private buckets = new Map<string, TokenBucket>();
  private readonly capacity: number;
  private readonly refillRate: number;

  constructor(private readonly configService: ConfigService) {
    this.capacity = this.configService.get<number>('rateLimit.capacity', 10);
    this.refillRate = this.configService.get<number>('rateLimit.refillRate', 60);
  }

  use(req: Request, res: Response, next: NextFunction) {
    const tenantId = (req as any).tenantId;
    if (!tenantId) return next();

    let bucket = this.buckets.get(tenantId);
    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefill: Date.now(),
        capacity: this.capacity,
        refillRate: this.refillRate,
      };
      this.buckets.set(tenantId, bucket);
    }

    const now = Date.now();
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
