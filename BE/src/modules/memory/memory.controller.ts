import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { MemoryService } from './memory.service';
import { ExtractMemoryDto, ReinforceMemoryDto } from './dto/memory.dto';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get('context/:childId')
  async getContext(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.memoryService.getChildContext(childId, tenantId);
  }

  @Post('extract')
  async extract(@Body() dto: ExtractMemoryDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.memoryService.extractFromStory(dto.child_id, tenantId, dto.memories, dto.story_id);
  }

  @Post('reinforce')
  async reinforce(@Body() dto: ReinforceMemoryDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.memoryService.reinforce(dto.child_id, tenantId, {
      type: dto.type,
      key: dto.key,
      value: dto.value,
      action: dto.action,
    });
  }
}
