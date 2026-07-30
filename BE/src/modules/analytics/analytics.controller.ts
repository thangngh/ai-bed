import { Controller, Get, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('stories/:childId')
  async getStoryStats(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.analyticsService.getStoryStats(childId, tenantId);
  }

  @Get('feedback/:childId')
  async getFeedbackStats(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.analyticsService.getFeedbackStats(childId, tenantId);
  }

  @Get('memory/:childId')
  async getMemoryStats(@Param('childId') childId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.analyticsService.getMemoryStats(childId, tenantId);
  }

  @Get('overview')
  async getOverview(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.analyticsService.getOverview(tenantId);
  }
}