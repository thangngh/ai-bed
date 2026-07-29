import { RateLimiterMiddleware } from '../middleware/rate-limiter.middleware';
import { HttpException } from '@nestjs/common';

describe('RateLimiterMiddleware', () => {
  let middleware: RateLimiterMiddleware;

  beforeEach(() => {
    middleware = new RateLimiterMiddleware({ capacity: 3, refillRate: 10 });
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
