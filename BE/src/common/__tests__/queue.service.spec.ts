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
    const start = Date.now();

    const results = await Promise.all([
      service.schedule('tenant-a', async () => { await new Promise(r => setTimeout(r, 30)); return 'a'; }),
      service.schedule('tenant-b', async () => { await new Promise(r => setTimeout(r, 30)); return 'b'; }),
    ]);

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(150);
    expect(results).toEqual(['a', 'b']);
  });
});
