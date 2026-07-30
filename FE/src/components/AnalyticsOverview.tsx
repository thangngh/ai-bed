import React from 'react';
import { BookOpen, Star, Headphones, FileText } from 'lucide-react';
import { StoryStats, FeedbackStats } from '../types';

interface AnalyticsOverviewProps {
  storyStats: StoryStats | null;
  feedbackStats: FeedbackStats | null;
  isNightMode: boolean;
}

const AnalyticsOverview: React.FC<AnalyticsOverviewProps> = ({
  storyStats,
  feedbackStats,
  isNightMode,
}) => {
  const cardClass = `p-4 rounded-2xl border ${
    isNightMode
      ? 'bg-slate-800/60 border-slate-700 text-slate-100'
      : 'bg-white/80 border-amber-200/60 text-amber-950'
  }`;

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className={cardClass}>
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-5 h-5 text-indigo-500" />
          <span className="text-sm opacity-80">Truyện đã tạo</span>
        </div>
        <div className="text-2xl font-bold">
          {storyStats?.total_stories ?? 0}
        </div>
      </div>
      <div className={cardClass}>
        <div className="flex items-center gap-2 mb-2">
          <Star className="w-5 h-5 text-amber-500" />
          <span className="text-sm opacity-80">Đánh giá TB</span>
        </div>
        <div className="text-2xl font-bold">
          {feedbackStats?.avg_rating != null ? feedbackStats.avg_rating.toFixed(1) : '—'}
        </div>
        <span className="text-xs opacity-60">/5</span>
      </div>
      <div className={cardClass}>
        <div className="flex items-center gap-2 mb-2">
          <Headphones className="w-5 h-5 text-emerald-500" />
          <span className="text-sm opacity-80">Đã nghe hết</span>
        </div>
        <div className="text-2xl font-bold">
          {feedbackStats?.listened_complete_rate != null
            ? feedbackStats.listened_complete_rate.toFixed(0)
            : '—'}
        </div>
        <span className="text-xs opacity-60">%</span>
      </div>
      <div className={cardClass}>
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-5 h-5 text-purple-500" />
          <span className="text-sm opacity-80">TB/truyện</span>
        </div>
        <div className="text-2xl font-bold">
          {storyStats?.avg_word_count != null ? storyStats.avg_word_count.toFixed(0) : '—'}
        </div>
        <span className="text-xs opacity-60"> từ</span>
      </div>
    </div>
  );
};

export default AnalyticsOverview;