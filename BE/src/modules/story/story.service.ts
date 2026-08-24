import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Story } from './entities/story.entity';
import { StorySection } from './entities/story-section.entity';
import { ChildProfile } from '../child/entities/child-profile.entity';
import { CreateStoryDto } from './dto/create-story.dto';
import { StoryResponse } from './dto/story-response.dto';
import { EngineResponse } from '../engine-gateway/dto/engine-response.dto';
import { ChildService } from '../child/child.service';
import { MemoryService } from '../memory/memory.service';
import { EngineGatewayService } from '../engine-gateway/engine-gateway.service';
import { QueueService } from '../../common/services/queue.service';
import { DashboardService } from '../admin/dashboard/services/dashboard.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StoryService {
  private storyRepo: Repository<Story>;
  private sectionRepo: Repository<StorySection>;
  private readonly logger = new Logger(StoryService.name);

  constructor(
    @InjectDataSource('local') private dataSource: DataSource,
    private readonly childService: ChildService,
    private readonly memoryService: MemoryService,
    private readonly engineGateway: EngineGatewayService,
    private readonly queueService: QueueService,
    private readonly dashboardService: DashboardService,
    private readonly config: ConfigService,
  ) {
    this.storyRepo = this.dataSource.getRepository(Story);
    this.sectionRepo = this.dataSource.getRepository(StorySection);
  }

  async create(dto: CreateStoryDto, tenantId: string): Promise<StoryResponse> {
    const child = dto.child_id
      ? await this.resolveChild(dto.child_id, tenantId)
      : await this.childService.getOrCreate(tenantId, {
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

    // Record LLM usage for the traffic dashboard. Fire-and-forget: a failure
    // here must never prevent a story from being saved. The BE's view of
    // provider/model is the configured primary, which may differ from the
    // Engine's actual fallback chain — tokens are estimated from the request.
    this.recordLlmUsage(dto, memories, engineResult, tenantId).catch((err) =>
      this.logger.warn(`LLM usage recording failed: ${err instanceof Error ? err.message : String(err)}`),
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

  private async recordLlmUsage(
    dto: CreateStoryDto,
    memories: Array<{ value: string }>,
    result: EngineResponse,
    tenantId: string,
  ): Promise<void> {
    const provider = this.config.get<string>('engine.provider', 'openai');
    const model = this.config.get<string>('engine.model', 'gpt-4o-mini');
    const promptTokens = this.dashboardService.estimatePromptTokens({
      childName: dto.child_name,
      theme: dto.theme,
      goal: dto.goal,
      mood: dto.mood,
      memories: memories.map((m) => ({ value: m.value })),
    });
    // Vietnamese ≈ 1 token / 1.3 words.
    const completionTokens = Math.max(1, Math.round((result.wordCount || 0) * 1.3));

    await this.dashboardService.recordLlmUsage({
      provider,
      model,
      tenantId,
      promptTokens,
      completionTokens,
      latencyMs: result.latencyMs,
      isFallback: result.isFallback,
    });
  }

  /**
   * The profile behind an explicit `child_id`.
   *
   * This branch never creates. A caller that names an id is claiming the
   * profile already exists, so a miss -- unknown, deleted, or owned by another
   * tenant -- is a 404 rather than a quietly conjured second profile. The
   * tenant check is the isolation boundary: `findById` looks up by primary key
   * alone and would otherwise hand out another tenant's child.
   */
  private async resolveChild(childId: string, tenantId: string): Promise<ChildProfile> {
    const child = await this.childService.findById(childId);
    if (!child || child.tenantId !== tenantId || child.isActive !== 1) {
      throw new NotFoundException('Child profile not found');
    }
    return child;
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

  async getLatest(
    tenantId: string,
    childName?: string,
    limit = 10,
    childId?: string,
  ): Promise<Story[]> {
    const where: any = { tenantId };
    if (childId) {
      // UUID is the canonical identity. This is what the SPA uses, so two
      // children with the same display name keep separate story shelves.
      where.childId = childId;
    } else if (childName) {
      // Backward compatibility for name-only clients: include every matching
      // profile instead of silently choosing the first duplicate.
      const profiles = await this.childService.findByTenant(tenantId);
      const childIds = profiles
        .filter((profile) => profile.childName === childName)
        .map((profile) => profile.childId);
      if (childIds.length === 0) return [];
      where.childId = In(childIds);
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
