import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Story } from '../story/entities/story.entity';
import { Feedback } from '../feedback/entities/feedback.entity';
import { MemoryItem } from '../memory/entities/memory-item.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Story], 'local'),
    TypeOrmModule.forFeature([Feedback], 'core'),
    TypeOrmModule.forFeature([MemoryItem], 'local'),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}