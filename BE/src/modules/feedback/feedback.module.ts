import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { ChildModule } from '../child/child.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [MemoryModule, ChildModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
