import { apiClient } from './api';
import { StoryStats, FeedbackStats, MemoryStats, OverviewStats } from '../types';

export const analyticsClient = {
  getStoryStats: (childId: string) =>
    apiClient<StoryStats>(`/analytics/stories/${childId}`),

  getFeedbackStats: (childId: string) =>
    apiClient<FeedbackStats>(`/analytics/feedback/${childId}`),

  getMemoryStats: (childId: string) =>
    apiClient<MemoryStats>(`/analytics/memory/${childId}`),

  getOverview: () =>
    apiClient<OverviewStats>('/analytics/overview'),
};