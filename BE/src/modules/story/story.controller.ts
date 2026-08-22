import { Controller, Post, Get, Param, Body, Query, Req, Res, NotFoundException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { StoryService } from './story.service';
import { CreateStoryDto } from './dto/create-story.dto';

@Controller('story')
export class StoryController {
  private readonly logger = new Logger(StoryController.name);

  constructor(private readonly storyService: StoryService) {}

  @Post('create')
  async create(
    @Body() dto: CreateStoryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenantId = (req as any).tenantId;
    if (req.header('x-story-heartbeat') !== '1') {
      return this.storyService.create(dto, tenantId);
    }

    // The public reverse-proxy path closes a response that stays completely
    // silent for 60 seconds. Free reasoning models legitimately take longer,
    // so flush harmless JSON whitespace while generation runs. JSON permits
    // leading whitespace, therefore the browser can keep using response.json()
    // and receives exactly the same object once the story is ready.
    res.status(201);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) res.write(' \n');
    }, 10_000);

    try {
      const story = await this.storyService.create(dto, tenantId);
      if (!res.writableEnded && !res.destroyed) res.end(JSON.stringify(story));
    } catch (err: any) {
      this.logger.error(`Streamed story generation failed: ${err?.message || 'unknown error'}`);
      if (!res.writableEnded && !res.destroyed) {
        res.end(JSON.stringify({
          error: {
            code: err?.response?.error?.code || 'STORY_GENERATION_FAILED',
            message: err?.response?.error?.message || 'Không thể tạo truyện',
          },
        }));
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  @Post('save')
  async toggleSave(@Body('story_id') storyId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.storyService.toggleSave(storyId, tenantId);
  }

  @Get('latest')
  async latest(
    @Query('child_id') childId: string,
    @Query('child_name') childName: string,
    @Query('limit') limit: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const stories = await this.storyService.getLatest(
      tenantId,
      childName,
      parseInt(limit) || 10,
      childId,
    );
    return { stories: stories.map(s => ({
      story_id: s.storyId,
      child_id: s.childId ?? null,
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
