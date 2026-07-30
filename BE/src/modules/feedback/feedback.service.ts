import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Feedback } from './entities/feedback.entity';
import { CreateFeedbackDto } from './dto/feedback.dto';
import { MemoryService } from '../memory/memory.service';

@Injectable()
export class FeedbackService {
  private repo: Repository<Feedback>;

  constructor(
    @InjectDataSource('core') private dataSource: DataSource,
    private readonly memoryService: MemoryService,
  ) {
    this.repo = this.dataSource.getRepository(Feedback);
  }

  async submit(dto: CreateFeedbackDto, tenantId: string): Promise<{ feedback_id: string }> {
    const feedback = new Feedback();
    feedback.feedbackId = uuidv4();
    feedback.tenantId = tenantId;
    feedback.storyId = dto.story_id;
    feedback.childId = dto.child_name || null;
    feedback.listenedComplete = dto.listened_complete ?? null;
    feedback.wantsMore = dto.wants_more ?? null;
    feedback.suitable = dto.suitable ?? null;
    feedback.rating = dto.rating ?? null;
    feedback.note = dto.note || null;
    await this.repo.save(feedback);

    if (dto.rating) {
      const action = dto.rating >= 4 ? 'boost' : dto.rating <= 2 ? 'reduce' : null;
      if (action && dto.child_name) {
        await this.memoryService.reinforce(dto.child_name || 'unknown', tenantId, {
          type: 'feedback',
          key: 'story_rating',
          value: `Rating: ${dto.rating}`,
          action,
        });
      }
    }

    return { feedback_id: feedback.feedbackId };
  }
}
