import { Injectable } from '@nestjs/common';
import Bottleneck from 'bottleneck';

interface QueueConfig {
  maxConcurrent: number;
  minTime: number;
  reservoir: number;
  reservoirRefreshInterval: number;
}

@Injectable()
export class QueueService {
  private limiters = new Map<string, Bottleneck>();

  constructor(private readonly config: QueueConfig) {}

  getLimiter(tenantId: string): Bottleneck {
    if (!this.limiters.has(tenantId)) {
      this.limiters.set(tenantId, new Bottleneck({
        maxConcurrent: this.config.maxConcurrent,
        minTime: this.config.minTime,
        reservoir: this.config.reservoir,
        reservoirRefreshAmount: this.config.reservoir,
        reservoirRefreshInterval: this.config.reservoirRefreshInterval,
      }));
    }
    return this.limiters.get(tenantId)!;
  }

  async schedule<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const limiter = this.getLimiter(tenantId);
    return limiter.schedule(fn);
  }
}
