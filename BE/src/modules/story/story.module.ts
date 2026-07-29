import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoryController } from './story.controller';
import { StoryService } from './story.service';
import { Story } from './entities/story.entity';
import { StorySection } from './entities/story-section.entity';
import { ChildModule } from '../child/child.module';
import { MemoryModule } from '../memory/memory.module';
import { EngineGatewayModule } from '../engine-gateway/engine-gateway.module';
import { QueueService } from '../../common/services/queue.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Story, StorySection], 'local'),
    ChildModule,
    MemoryModule,
    EngineGatewayModule,
  ],
  controllers: [StoryController],
  providers: [
    StoryService,
    {
      provide: QueueService,
      useFactory: () => new QueueService({
        maxConcurrent: parseInt(process.env.QUEUE_MAX_CONCURRENT || '2'),
        minTime: parseInt(process.env.QUEUE_MIN_TIME_MS || '6000'),
        reservoir: parseInt(process.env.QUEUE_RESERVOIR || '10'),
        reservoirRefreshInterval: parseInt(process.env.QUEUE_RESERVOIR_REFRESH_MS || '60000'),
      }),
    },
  ],
  exports: [StoryService],
})
export class StoryModule {}
