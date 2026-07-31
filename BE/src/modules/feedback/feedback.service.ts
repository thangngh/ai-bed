import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Feedback } from './entities/feedback.entity';
import { CreateFeedbackDto } from './dto/feedback.dto';
import { ChildService } from '../child/child.service';
import { MemoryService } from '../memory/memory.service';

@Injectable()
export class FeedbackService {
  private repo: Repository<Feedback>;

  constructor(
    @InjectDataSource('core') private dataSource: DataSource,
    private readonly childService: ChildService,
    private readonly memoryService: MemoryService,
  ) {
    this.repo = this.dataSource.getRepository(Feedback);
  }

  async submit(dto: CreateFeedbackDto, tenantId: string): Promise<{ feedback_id: string }> {
    let childId: string | undefined;

    if (dto.child_name) {
      const profile = await this.childService.findByName(tenantId, dto.child_name);
      if (profile) {
        childId = profile.childId;
      }
    }

    const feedback = new Feedback();
    feedback.feedbackId = uuidv4();
    feedback.tenantId = tenantId;
    feedback.storyId = dto.story_id;
    feedback.childId = childId;
    feedback.listenedComplete = dto.listened_complete ?? undefined;
    feedback.wantsMore = dto.wants_more ?? undefined;
    feedback.suitable = dto.suitable ?? undefined;
    feedback.rating = dto.rating ?? undefined;
    feedback.note = dto.note || undefined;
    await this.repo.save(feedback);

    if (dto.rating && childId) {
      const action = dto.rating >= 4 ? 'boost' : dto.rating <= 2 ? 'reduce' : null;
      if (action) {
        await this.memoryService.reinforce(childId, tenantId, {
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
