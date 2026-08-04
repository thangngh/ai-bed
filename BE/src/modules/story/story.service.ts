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
      gender: dto.gender,
      preferred_characters: dto.favorite_character,
      bedtime_goal: dto.goal,
    });

    const memories = await this.memoryService.getRelevant(tenantId, child.childId);
    const recentStories = await this.getRecentSummaries(tenantId, child.childId);

    const engineResult = await this.queueService.schedule(tenantId, () =>
      this.engineGateway.generate({
        childName: child.childName,
        age: child.age,
        theme: dto.theme,
        goal: dto.goal,
        mood: dto.mood,
        language: dto.language || 'vi',
        memories,
        recentStories,
        // The form's answers win; the stored profile fills the gaps. Dropping
        // these here is what made every story ignore gender and the child's
        // favourite character even though the SPA and the Engine both carry them.
        gender: dto.gender || child.gender || '',
        favoriteCharacter: dto.favorite_character || child.preferredCharacters || '',
        tenantId,
      })
    );

    const story = new Story();
    story.storyId = uuidv4();
    story.tenantId = tenantId;
    story.childId = child.childId;
    story.requestId = engineResult.requestId || undefined;
    story.title = engineResult.title;
    story.content = JSON.stringify(engineResult.content);
    story.theme = dto.theme;
    story.goal = dto.goal || null;
    story.mood = dto.mood || null;
    story.language = dto.language || 'vi';
    story.safetyStatus = engineResult.safetyStatus;
    story.llmCalls = engineResult.llmCalls;
    story.retryCount = engineResult.retryCount;
    story.totalLatencyMs = engineResult.latencyMs;
    story.wordCount = engineResult.wordCount;
    story.isFallback = engineResult.isFallback ? 1 : 0;
    await this.storyRepo.save(story);

    await this.saveSections(story.storyId, tenantId, engineResult.content);

    if (engineResult.memories?.length) {
      await this.memoryService.extractFromStory(child.childId, tenantId, engineResult.memories, story.storyId);
    }

    return StoryResponse.from(story, engineResult);
  }

  /**
   * The story is returned to the caller from the Engine payload, but re-opening
   * it later reads `story_sections`. Without this the sections table stayed
   * empty and every saved story came back as a title with no text.
   */
  private async saveSections(storyId: string, tenantId: string, content: unknown): Promise<void> {
    if (!Array.isArray(content) || content.length === 0) return;

    const sections = content.map((raw: any, index: number) => {
      const section = new StorySection();
      section.sectionId = uuidv4();
      section.storyId = storyId;
      section.tenantId = tenantId;
      section.sectionType = String(raw?.type || 'context');
      section.content = String(raw?.text ?? '');
      section.orderIndex = Number.isFinite(raw?.order) ? Number(raw.order) : index;
      section.interactionPrompt = raw?.prompt ? String(raw.prompt) : undefined;
      section.interactionOptions = raw?.options ? JSON.stringify(raw.options) : undefined;
      return section;
    });

    await this.sectionRepo.save(sections);
  }

  /** Last few titles for this child, so the Engine can avoid repeating itself. */
  private async getRecentSummaries(tenantId: string, childId: string) {
    const recent = await this.storyRepo.find({
      where: { tenantId, childId },
      order: { createdAt: 'DESC' },
      take: 3,
    });
    return recent.map(s => ({ title: s.title, theme: s.theme }));
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

  /**
   * Full story for re-reading. The child's name and age live in the other
   * datasource, so they are resolved here rather than read off the story row.
   */
  async getDetail(storyId: string, tenantId: string) {
    const story = await this.findById(storyId, tenantId);
    if (!story) return null;

    const child = story.childId ? await this.childService.findById(story.childId) : null;
    return StoryResponse.detail(story, child?.tenantId === tenantId ? child : null);
  }

  async toggleSave(storyId: string, tenantId: string): Promise<{ is_saved: number }> {
    const story = await this.storyRepo.findOne({ where: { storyId, tenantId } });
    if (!story) throw new NotFoundException('Story not found');
    story.isSaved = story.isSaved ? 0 : 1;
    await this.storyRepo.save(story);
    return { is_saved: story.isSaved };
  }
}
