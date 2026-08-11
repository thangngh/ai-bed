import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository, MoreThan } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { MemoryItem } from './entities/memory-item.entity';
import { isStorableMemoryText, sanitizeMemoryText } from './memory-content';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class MemoryService {
  private repo: Repository<MemoryItem>;

  constructor(
    @InjectDataSource('local') private dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
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

  async getChildContext(childId: string, tenantId: string): Promise<{
    interests: any[];
    preferences: any[];
    recentThemes: any[];
    behaviors: any[];
  }> {
    const memories = await this.repo.find({
      where: { tenantId, childId, isActive: 1 },
      take: 50,
    });

    const ttlDays = this.configService.get<number>('memory.ttlDays', 90);
    const now = Date.now();

    // Apply decay, filter expired
    const toDeactivate: MemoryItem[] = [];
    const processed = memories.filter(m => {
      if (m.lastReinforcedAt) {
        const daysSince = (now - new Date(m.lastReinforcedAt).getTime()) / 86400000;
        const decay = Math.max(0, 1 - (daysSince / ttlDays));
        m.confidence = m.confidence * decay;
        if (m.confidence <= 0) {
          toDeactivate.push(m);
          return false;
        }
      }
      return true;
    });

    // Prune expired (single pass after decay calculation)
    for (const m of toDeactivate) {
      m.isActive = 0;
      await this.repo.save(m);
    }

    processed.sort((a, b) => b.confidence - a.confidence);
    const top = processed.slice(0, 10);

    return {
      interests: top.filter(m => m.memoryType === 'interest').map(this._toClient),
      preferences: top.filter(m => m.memoryType === 'preference').map(this._toClient),
      recentThemes: top.filter(m => m.memoryType === 'recent_theme').map(this._toClient),
      behaviors: top.filter(m => m.memoryType === 'behavior').map(this._toClient),
    };
  }

  async extractFromStory(childId: string, tenantId: string, memories: any[], storyId: string): Promise<{ saved: number }> {
    if (!this.configService.get<boolean>('memory.extractEnabled', true)) {
      return { saved: 0 };
    }

    const boost = this.configService.get<number>('memory.confidenceBoost', 0.1);
    let saved = 0;
    for (const mem of memories) {
      const cleanValue = sanitizeMemoryText(mem.value);
      if (!isStorableMemoryText(cleanValue)) continue;

      const existing = await this.repo.findOne({
        where: {
          tenantId,
          childId,
          memoryType: mem.type || mem.memory_type,
          memoryKey: mem.key || mem.memory_key,
          memoryValue: cleanValue,
        },
      });

      if (existing) {
        existing.confidence = Math.min(1, (existing.confidence || 0) + boost);
        existing.lastReinforcedAt = new Date().toISOString();
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
        item.memoryValue = cleanValue;
        item.confidence = mem.confidence || 0.5;
        item.source = 'story_extract';
        item.lastReinforcedAt = new Date().toISOString();
        await this.repo.save(item);
      }
      saved++;
    }

    await this._enforceActiveLimit(childId, tenantId);
    return { saved };
  }

  async reinforce(childId: string, tenantId: string, dto: {
    type: string;
    key: string;
    value: string;
    action: 'boost' | 'reduce';
  }): Promise<{ success: boolean }> {
    const boost = this.configService.get<number>('memory.confidenceBoost', 0.1);
    const delta = dto.action === 'boost' ? boost * 2 : -boost * 2;

    const cleanValue = sanitizeMemoryText(dto.value);
    if (!isStorableMemoryText(cleanValue)) return { success: false };

    const existing = await this.repo.findOne({
      where: { tenantId, childId, memoryType: dto.type, memoryKey: dto.key, memoryValue: cleanValue },
    });

    if (existing) {
      existing.confidence = Math.min(1, Math.max(0.1, (existing.confidence || 0) + delta));
      existing.lastReinforcedAt = new Date().toISOString();
      existing.source = 'feedback';
      await this.repo.save(existing);
      return { success: true };
    }

    if (dto.action === 'boost') {
      const item = new MemoryItem();
      item.memoryId = uuidv4();
      item.tenantId = tenantId;
      item.childId = childId;
      item.memoryType = dto.type;
      item.memoryKey = dto.key;
      item.memoryValue = cleanValue;
      item.confidence = 0.5;
      item.source = 'feedback';
      item.lastReinforcedAt = new Date().toISOString();
      await this.repo.save(item);
      return { success: true };
    }

    return { success: false };
  }

  private _toClient(m: MemoryItem) {
    return { type: m.memoryType, key: m.memoryKey, value: m.memoryValue, confidence: m.confidence };
  }

  private async _enforceActiveLimit(childId: string, tenantId: string): Promise<void> {
    const active = await this.repo.find({
      where: { tenantId, childId, isActive: 1 },
      order: { lastReinforcedAt: 'ASC' },
    });
    if (active.length > 20) {
      const toDeactivate = active.slice(0, active.length - 20);
      for (const m of toDeactivate) {
        m.isActive = 0;
        await this.repo.save(m);
      }
    }
  }

  async bulkCreate(tenantId: string, childId: string, memories: any[], storyId: string): Promise<void> {
    for (const mem of memories) {
      const cleanValue = sanitizeMemoryText(mem.value || mem.memory_value);
      if (!isStorableMemoryText(cleanValue)) continue;

      const existing = await this.repo.findOne({
        where: { tenantId, childId, memoryKey: mem.key || mem.memory_key },
      });

      if (existing && existing.confidence >= (mem.confidence || 0)) continue;

      if (existing) {
        existing.confidence = mem.confidence || 0.5;
        existing.memoryValue = cleanValue;
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
        item.memoryValue = cleanValue;
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
