import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual, Raw } from 'typeorm';
import { Feedback } from '../feedback/entities/feedback.entity';
import { ChildProfile } from '../child/entities/child-profile.entity';
import { Story } from '../story/entities/story.entity';
import { PaginatedResponse } from '../../common/dto/pagination.dto';
import { ListFeedbackDto } from './dto/list-feedback.dto';

export interface AdminFeedbackItem {
  feedback_id: string;
  created_at: string | null;
  rating: number | null;
  listened_complete: number | null;
  wants_more: number | null;
  suitable: number | null;
  note: string | null;
  story_id: string;
  story_title: string | null;
  child_name: string | null;
  tenant_id: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class AdminFeedbackService {
  private readonly logger = new Logger('AdminFeedback');

  constructor(
    @InjectDataSource('core') private readonly core: DataSource,
    @InjectDataSource('local') private readonly local: DataSource,
  ) {}

  async list(query: ListFeedbackDto): Promise<PaginatedResponse<AdminFeedbackItem>> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = query.offset ?? 0;

    const [rows, total] = await this.core.getRepository(Feedback).findAndCount({
      where: this.buildWhere(query),
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    // core.db and local.db are separate SQLite files, so the story title cannot
    // be joined in SQL. Two extra lookups scoped to this page keep it at three
    // queries total, not N+1.
    const childNames = await this.lookupChildNames(rows);
    const storyTitles = await this.lookupStoryTitles(rows);

    return {
      items: rows.map((row) => ({
        feedback_id: row.feedbackId,
        created_at: row.createdAt ?? null,
        rating: row.rating ?? null,
        listened_complete: row.listenedComplete ?? null,
        wants_more: row.wantsMore ?? null,
        suitable: row.suitable ?? null,
        note: row.note ?? null,
        story_id: row.storyId,
        story_title: storyTitles.get(row.storyId) ?? null,
        child_name: row.childId ? childNames.get(row.childId) ?? null : null,
        tenant_id: row.tenantId,
      })),
      total,
      limit,
      offset,
    };
  }

  private buildWhere(query: ListFeedbackDto): FindOptionsWhere<Feedback> {
    const where: FindOptionsWhere<Feedback> = {};

    if (query.rating !== undefined) where.rating = query.rating;

    if (query.has_note === 1) {
      // A submitted-but-blank note is not a note.
      where.note = Raw((alias) => `${alias} IS NOT NULL AND ${alias} != ''`);
    } else if (query.has_note === 0) {
      where.note = Raw((alias) => `${alias} IS NULL OR ${alias} = ''`);
    }

    // created_at is SQLite's `datetime('now')` -- 'YYYY-MM-DD HH:MM:SS' in UTC,
    // which compares correctly as a string.
    if (query.from && query.to) {
      where.createdAt = Raw(
        (alias) => `${alias} >= :from AND ${alias} <= :to`,
        { from: `${query.from} 00:00:00`, to: `${query.to} 23:59:59` },
      );
    } else if (query.from) {
      where.createdAt = MoreThanOrEqual(`${query.from} 00:00:00`);
    } else if (query.to) {
      where.createdAt = LessThanOrEqual(`${query.to} 23:59:59`);
    }

    return where;
  }

  private async lookupChildNames(rows: Feedback[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.childId).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const children = await this.core.getRepository(ChildProfile).find({
      where: { childId: In(ids) },
      select: ['childId', 'childName'],
    });
    return new Map(children.map((c) => [c.childId, c.childName]));
  }

  private async lookupStoryTitles(rows: Feedback[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.storyId).filter(Boolean))];
    if (ids.length === 0) return new Map();
    try {
      const stories = await this.local.getRepository(Story).find({
        where: { storyId: In(ids) },
        select: ['storyId', 'title'],
      });
      return new Map(stories.map((s) => [s.storyId, s.title]));
    } catch (err) {
      // The feedback itself lives in core.db. A broken local.db costs titles,
      // not the whole page.
      this.logger.warn(
        JSON.stringify({ event: 'admin_story_title_lookup_failed', count: ids.length }),
      );
      return new Map();
    }
  }
}
