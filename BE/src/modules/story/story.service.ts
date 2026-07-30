import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Story } from './entities/story.entity';
import { StorySection } from './entities/story-section.entity';
import { CreateStoryDto } from './dto/create-story.dto';
import { StoryResponse } from './dto/story-response.dto';
import { ChildService } from '../child/child.service';
import { MemoryService } from '../memory/memory.service';
import { EngineGatewayService } from '../engine-gateway/engine-gateway.service';
import { QueueService } from '../../common/services/queue.service';

@Injectable()
export class StoryService {
  private storyRepo: Repository<Story>;
  private sectionRepo: Repository<StorySection>;

  constructor(
    @InjectDataSource('local') private dataSource: DataSource,
    private readonly childService: ChildService,
    private readonly memoryService: MemoryService,
    private readonly engineGateway: EngineGatewayService,
    private readonly queueService: QueueService,
  ) {
    this.storyRepo = this.dataSource.getRepository(Story);
    this.sectionRepo = this.dataSource.getRepository(StorySection);
  }

  async create(dto: CreateStoryDto, tenantId: string): Promise<StoryResponse> {
    const child = await this.childService.getOrCreate(tenantId, {
      child_name: dto.child_name,
      age: dto.age,
    });

    const memories = await this.memoryService.getRelevant(tenantId, child.childId);

    const engineResult = await this.queueService.schedule(tenantId, () =>
      this.engineGateway.generate({
        childName: child.childName,
        age: child.age,
        theme: dto.theme,
        goal: dto.goal,
        mood: dto.mood,
        language: dto.language || 'vi',
        memories,
        tenantId,
      })
    );

    const story = new Story();
    story.storyId = uuidv4();
    story.tenantId = tenantId;
    story.childId = child.childId;
    story.title = engineResult.title;
    story.content = JSON.stringify(engineResult.content);
    story.theme = dto.theme;
    story.goal = dto.goal || null;
    story.mood = dto.mood || null;
    story.safetyStatus = engineResult.safetyStatus;
    story.llmCalls = engineResult.llmCalls;
    story.totalLatencyMs = engineResult.latencyMs;
    story.wordCount = engineResult.wordCount;
    story.isFallback = engineResult.isFallback ? 1 : 0;
    await this.storyRepo.save(story);

    if (engineResult.memories?.length) {
      await this.memoryService.extractFromStory(child.childId, tenantId, engineResult.memories, story.storyId);
    }

    return StoryResponse.from(story, engineResult);
  }

  async getLatest(tenantId: string, childName?: string, limit = 10): Promise<Story[]> {
    const where: any = { tenantId };
    if (childName) {
      const profiles = await this.childService.findByTenant(tenantId);
      const child = profiles.find(p => p.childName === childName);
      if (child) where.childId = child.childId;
    }
    return this.storyRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findById(storyId: string, tenantId: string): Promise<Story | null> {
    return this.storyRepo.findOne({
      where: { storyId, tenantId },
      relations: ['sections'],
    });
  }

  async toggleSave(storyId: string, tenantId: string): Promise<{ is_saved: number }> {
    const story = await this.storyRepo.findOne({ where: { storyId, tenantId } });
    if (!story) throw new NotFoundException('Story not found');
    story.isSaved = story.isSaved ? 0 : 1;
    await this.storyRepo.save(story);
    return { is_saved: story.isSaved };
  }
}
