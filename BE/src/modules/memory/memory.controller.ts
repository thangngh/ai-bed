import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get()
  async getMemories(
    @Query('child_name') childName: string,
    @Query('type') type: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const types = type ? type.split(',') : undefined;
    const memories = await this.memoryService.findByTenant(tenantId, childName, types);
    return { memories: memories.map(m => ({
      type: m.memoryType,
      key: m.memoryKey,
      value: m.memoryValue,
      confidence: m.confidence,
    }))};
  }
}
