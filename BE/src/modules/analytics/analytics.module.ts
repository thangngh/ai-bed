import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Story } from '../story/entities/story.entity';
import { Feedback } from '../feedback/entities/feedback.entity';
import { MemoryItem } from '../memory/entities/memory-item.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ChildModule } from '../child/child.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Story, Feedback, MemoryItem], 'core'),
    ChildModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}