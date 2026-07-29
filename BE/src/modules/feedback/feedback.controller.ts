import { Controller, Post, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/feedback.dto';

@Controller('story')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post('feedback')
  async submit(@Body() dto: CreateFeedbackDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return this.feedbackService.submit(dto, tenantId);
  }
}
