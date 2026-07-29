import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository, LessThan } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { MemoryItem } from './entities/memory-item.entity';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class MemoryService {
  private repo: Repository<MemoryItem>;

  constructor(@InjectDataSource('local') private dataSource: DataSource) {
    this.repo = this.dataSource.getRepository(MemoryItem);
  }

  async getRelevant(tenantId: string, childId: string): Promise<any[]> {
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

    const memories = await this.repo.find({
      where: {
        tenantId,
        childId,
        isActive: 1,
        createdAt: MoreThan(thirtyDaysAgo),
      },
      order: { confidence: 'DESC' },
      take: 10,
    });

    let tokens = 0;
    const MAX_TOKENS = 200;
    const result: any[] = [];

    for (const mem of memories) {
      const cost = Math.ceil(mem.memoryValue.length / 4);
      if (tokens + cost > MAX_TOKENS) break;
      result.push({ type: mem.memoryType, key: mem.memoryKey, value: mem.memoryValue, confidence: mem.confidence });
      tokens += cost;
    }

    return result;
  }

  async bulkCreate(tenantId: string, childId: string, memories: any[], storyId: string): Promise<void> {
    for (const mem of memories) {
      const existing = await this.repo.findOne({
        where: { tenantId, childId, memoryKey: mem.key || mem.memory_key },
      });

      if (existing && existing.confidence >= (mem.confidence || 0)) continue;

      if (existing) {
        existing.confidence = mem.confidence || 0.5;
        existing.memoryValue = mem.value || mem.memory_value;
        existing.storyId = storyId;
        await this.repo.save(existing);
      } else {
        const item = new MemoryItem();
        item.memoryId = uuidv4();
        item.tenantId = tenantId;
        item.childId = childId;
        item.storyId = storyId;
        item.memoryType = mem.type || mem.memory_type;
        item.memoryKey = mem.key || mem.memory_key;
        item.memoryValue = mem.value || mem.memory_value;
        item.confidence = mem.confidence || 0.5;
        await this.repo.save(item);
      }
    }
  }

  async findByTenant(tenantId: string, childName?: string, types?: string[]): Promise<MemoryItem[]> {
    const where: any = { tenantId, isActive: 1 };
    if (types?.length) where.memoryType = types;
    return this.repo.find({ where, order: { confidence: 'DESC' }, take: 20 });
  }
}
