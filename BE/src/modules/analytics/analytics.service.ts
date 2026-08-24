import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Story } from '../story/entities/story.entity';
import { Feedback } from '../feedback/entities/feedback.entity';
import { MemoryItem } from '../memory/entities/memory-item.entity';
import { ChildService } from '../child/child.service';
import { vietnamDateKey } from '../../common/time/vietnam-time';

export interface StoryStats {
  total_stories: number;
  unique_themes: number;
  top_themes: { theme: string; count: number }[];
  stories_per_day: { day: string; count: number }[];
  avg_word_count: number;
  avg_interaction_count: number;
}

export interface FeedbackStats {
  total_feedback: number;
  avg_rating: number;
  listened_complete_rate: number;
  wants_more_rate: number;
  rating_distribution: { rating: number; count: number }[];
}

export interface MemoryStats {
  top_interests: { value: string; confidence: number }[];
  top_characters: string[];
  common_goals: { goal: string; count: number }[];
}

export interface OverviewStats {
  children: {
    childId: string;
    childName: string;
    total_stories: number;
    avg_rating: number | null;
    last_active: string | null;
  }[];
  total_stories: number;
  total_children: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Story, 'local') private storyRepo: Repository<Story>,
    @InjectRepository(Feedback, 'core') private feedbackRepo: Repository<Feedback>,
    @InjectRepository(MemoryItem, 'local') private memoryRepo: Repository<MemoryItem>,
    private readonly childService: ChildService,
  ) {}

  async getStoryStats(childId: string, tenantId: string, days: number = 30): Promise<StoryStats> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().replace('T', ' ').replace('Z', ''); // SQLite format

    const stories = await this.storyRepo.find({
      where: { tenantId, childId, createdAt: MoreThan(sinceStr) },
    });

    const total_stories = stories.length;
    const themeSet = new Set<string>();
    const themeMap = new Map<string, number>();
    const dayMap = new Map<string, number>();
    let wordCountSum = 0;
    let wordCountN = 0;

    for (const s of stories) {
      themeSet.add(s.theme);
      themeMap.set(s.theme, (themeMap.get(s.theme) || 0) + 1);
      if (s.createdAt) {
        const day = vietnamDateKey(s.createdAt);
        dayMap.set(day, (dayMap.get(day) || 0) + 1);
      }
      if (s.wordCount != null) {
        wordCountSum += s.wordCount;
        wordCountN++;
      }
    }

    const top_themes = Array.from(themeMap.entries())
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => b.count - a.count);

    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const stories_per_day: { day: string; count: number }[] = [];
    // Work with calendar keys rather than the server's local zone. Containers
    // run in UTC, while every day shown to parents is a Vietnam day (UTC+7).
    const vietnamToday = new Date(`${vietnamDateKey(new Date())}T00:00:00Z`);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(vietnamToday);
      d.setUTCDate(d.getUTCDate() - i);
      const dayKey = d.toISOString().slice(0, 10);
      stories_per_day.push({ day: DAY_NAMES[d.getUTCDay()], count: dayMap.get(dayKey) || 0 });
    }

    const avg_word_count = wordCountN > 0 ? wordCountSum / wordCountN : 0;

    return {
      total_stories,
      unique_themes: themeSet.size,
      top_themes,
      stories_per_day,
      avg_word_count,
      avg_interaction_count: 0,
    };
  }

  async getFeedbackStats(childId: string, tenantId: string): Promise<FeedbackStats> {
    const feedbacks = await this.feedbackRepo.find({
      where: { tenantId, childId },
    });

    const total_feedback = feedbacks.length;
    const ratings = feedbacks.map(f => f.rating).filter((r): r is number => r != null);
    const avg_rating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

    const listenedCompleteCount = feedbacks.filter(f => f.listenedComplete === 1).length;
    const listened_complete_rate = total_feedback > 0 ? (listenedCompleteCount / total_feedback) * 100 : 0;

    const wantsMoreCount = feedbacks.filter(f => f.wantsMore === 1).length;
    const wants_more_rate = total_feedback > 0 ? (wantsMoreCount / total_feedback) * 100 : 0;

    const ratingMap = new Map<number, number>();
    for (const f of feedbacks) {
      if (f.rating != null) {
        ratingMap.set(f.rating, (ratingMap.get(f.rating) || 0) + 1);
      }
    }
    const rating_distribution = Array.from(ratingMap.entries())
      .map(([rating, count]) => ({ rating, count }))
      .sort((a, b) => a.rating - b.rating);

    return {
      total_feedback,
      avg_rating,
      listened_complete_rate,
      wants_more_rate,
      rating_distribution,
    };
  }

  async getMemoryStats(childId: string, tenantId: string): Promise<MemoryStats> {
    const memories = await this.memoryRepo.find({
      where: { tenantId, childId, isActive: 1 },
      order: { confidence: 'DESC' },
    });

    const top_interests = memories
      .filter(m => m.memoryType === 'interest')
      .map(m => ({ value: m.memoryValue, confidence: m.confidence }));

    const top_characters = memories
      .filter(m => m.memoryType === 'preference' && m.memoryKey === 'liked_character')
      .map(m => m.memoryValue);

    const goalMap = new Map<string, number>();
    for (const m of memories) {
      if (m.memoryType === 'goal') {
        goalMap.set(m.memoryValue, (goalMap.get(m.memoryValue) || 0) + 1);
      }
    }
    const common_goals = Array.from(goalMap.entries())
      .map(([goal, count]) => ({ goal, count }))
      .sort((a, b) => b.count - a.count);

    return {
      top_interests,
      top_characters,
      common_goals,
    };
  }

  async getOverview(tenantId: string): Promise<OverviewStats> {
    const stories = await this.storyRepo.find({
      where: { tenantId },
    });

    const feedbacks = await this.feedbackRepo.find({
      where: { tenantId },
    });

    // Collect unique childIds từ stories và feedbacks
    const childIds = new Set<string>();
    for (const s of stories) if (s.childId) childIds.add(s.childId);
    for (const f of feedbacks) if (f.childId) childIds.add(f.childId);

    // Fetch child names from ChildService
    const childNames = new Map<string, string>();
    for (const id of childIds) {
      try {
        const profile = await this.childService.findById(id);
        if (profile) {
          childNames.set(id, profile.childName);
        }
      } catch {
        childNames.set(id, id); // fallback to UUID
      }
    }

    const childMap = new Map<string, { childId: string; total_stories: number; last_active: string | null }>();
    for (const s of stories) {
      if (s.childId) {
        const existing = childMap.get(s.childId);
        if (existing) {
          existing.total_stories++;
          if (s.createdAt && (!existing.last_active || s.createdAt > existing.last_active)) {
            existing.last_active = s.createdAt;
          }
        } else {
          childMap.set(s.childId, { childId: s.childId, total_stories: 1, last_active: s.createdAt ?? null });
        }
      }
    }

    const ratingMap = new Map<string, { sum: number; count: number }>();
    for (const f of feedbacks) {
      if (f.childId && f.rating != null) {
        const existing = ratingMap.get(f.childId);
        if (existing) {
          existing.sum += f.rating;
          existing.count++;
        } else {
          ratingMap.set(f.childId, { sum: f.rating, count: 1 });
        }
      }
    }

    const children = Array.from(childMap.values()).map(c => ({
      childId: c.childId,
      childName: childNames.get(c.childId) || c.childId,
      total_stories: c.total_stories,
      avg_rating: ratingMap.has(c.childId) ? ratingMap.get(c.childId)!.sum / ratingMap.get(c.childId)!.count : null,
      last_active: c.last_active,
    }));

    children.sort((a, b) => b.total_stories - a.total_stories);

    return {
      children,
      total_stories: stories.length,
      total_children: children.length,
    };
  }
}
