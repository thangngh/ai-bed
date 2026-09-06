import { QueueService } from '../services/queue.service';

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(() => {
    service = new QueueService({
      maxConcurrent: 2,
      minTime: 10,
      reservoir: 5,
      reservoirRefreshInterval: 60 * 1000,
    });
  });

  it('should execute function and return result', async () => {
    const result = await service.schedule('tenant-1', async () => 'hello');
    expect(result).toBe('hello');
  });

  it('should limit concurrent executions per tenant', async () => {
    let concurrent = 0;
    let maxConcurrentHit = 0;

    const task = async () => {
      concurrent++;
      maxConcurrentHit = Math.max(maxConcurrentHit, concurrent);
      await new Promise(r => setTimeout(r, 50));
      concurrent--;
      return 'done';
    };

    const results = await Promise.all([
      service.schedule('tenant-1', task),
      service.schedule('tenant-1', task),
      service.schedule('tenant-1', task),
    ]);

    expect(maxConcurrentHit).toBeLessThanOrEqual(2);
    expect(results).toEqual(['done', 'done', 'done']);
  });

  it('should have separate queues per tenant', async () => {
    const results = await Promise.all([
      service.schedule('tenant-a', async () => { await new Promise(r => setTimeout(r, 30)); return 'a'; }),
      service.schedule('tenant-b', async () => { await new Promise(r => setTimeout(r, 30)); return 'b'; }),
    ]);

    expect(results).toEqual(['a', 'b']);
    // A wall-clock budget can't prove per-tenant isolation here: this
    // service is constructed with maxConcurrent: 2, so even a regression
    // that gave every tenant the same shared limiter would still let both
    // 30ms tasks run concurrently and finish in ~30ms. The only assertion
    // that actually detects "one limiter for all tenants" is checking that
    // each tenant gets a distinct limiter instance.
    expect(service.getLimiter('tenant-a')).not.toBe(service.getLimiter('tenant-b'));
  });
});
