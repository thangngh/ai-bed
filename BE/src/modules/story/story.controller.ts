import { Controller, Post, Get, Param, Body, Query, Req, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { StoryService } from './story.service';
import { CreateStoryDto } from './dto/create-story.dto';

@Controller('story')
export class StoryController {
  constructor(private readonly storyService: StoryService) {}

  @Post('create')
  async create(@Body() dto: CreateStoryDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.storyService.create(dto, tenantId);
  }

  @Post('save')
  async toggleSave(@Body('story_id') storyId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.storyService.toggleSave(storyId, tenantId);
  }

  @Get('latest')
  async latest(
    @Query('child_name') childName: string,
    @Query('limit') limit: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const stories = await this.storyService.getLatest(tenantId, childName, parseInt(limit) || 10);
    return { stories: stories.map(s => ({
      story_id: s.storyId,
      title: s.title,
      theme: s.theme,
      created_at: s.createdAt,
      safety_status: s.safetyStatus,
      word_count: s.wordCount,
    }))};
  }

  @Get(':id')
  async getById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const detail = await this.storyService.getDetail(id, tenantId);
    if (!detail) throw new NotFoundException('Story not found');
    return detail;
  }
}
