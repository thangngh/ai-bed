import { RateLimiterMiddleware } from '../middleware/rate-limiter.middleware';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

describe('RateLimiterMiddleware', () => {
  let middleware: RateLimiterMiddleware;

  beforeEach(() => {
    const configService = { get: jest.fn((key: string, def?: any) => {
      const map: Record<string, any> = { 'rateLimit.capacity': 3, 'rateLimit.refillRate': 10 };
      return map[key] ?? def;
    }) } as any as ConfigService;
    middleware = new RateLimiterMiddleware(configService);
  });

  it('should allow requests within capacity', () => {
    const req = { tenantId: 'tenant-1' } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should reject when bucket empty', () => {
    const req = { tenantId: 'tenant-2' } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    middleware.use(req, res, next);
    middleware.use(req, res, next);
    middleware.use(req, res, next);

    expect(() => middleware.use(req, res, next)).toThrow(HttpException);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });

  it('should have separate buckets per tenant', () => {
    const reqA = { tenantId: 'tenant-a' } as any;
    const reqB = { tenantId: 'tenant-b' } as any;
    const res = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    middleware.use(reqA, res, next);
    middleware.use(reqA, res, next);
    middleware.use(reqA, res, next);

    expect(() => middleware.use(reqB, res, next)).not.toThrow();
  });
});
