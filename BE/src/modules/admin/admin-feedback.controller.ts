import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from './auth/admin.guard';
import { AdminFeedbackService, AdminFeedbackItem } from './admin-feedback.service';
import { ListFeedbackDto } from './dto/list-feedback.dto';
import { PaginatedResponse } from '../../common/dto/pagination.dto';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminFeedbackController {
  constructor(private readonly feedbackService: AdminFeedbackService) {}

  @Get('feedbacks')
  async list(@Query() query: ListFeedbackDto): Promise<PaginatedResponse<AdminFeedbackItem>> {
    return this.feedbackService.list(query);
  }
}
