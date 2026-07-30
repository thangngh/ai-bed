import { Controller, Get, Post, Body, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memoryService: MemoryService) {}

  @Get('context/:childId')
  async getContext(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.memoryService.getChildContext(childId, tenantId);
  }

  @Post('extract')
  async extract(@Body() body: { child_id: string; story_id: string; memories: any[] }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.memoryService.extractFromStory(body.child_id, tenantId, body.memories, body.story_id);
  }

  @Post('reinforce')
  async reinforce(@Body() body: { child_id: string; type: string; key: string; value: string; action: 'boost' | 'reduce' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.memoryService.reinforce(body.child_id, tenantId, {
      type: body.type,
      key: body.key,
      value: body.value,
      action: body.action,
    });
  }
}
