import React from 'react';
import { StoryStats } from '../types';

interface AnalyticsTopicsProps {
  storyStats: StoryStats | null;
  isNightMode: boolean;
}

const AnalyticsTopics: React.FC<AnalyticsTopicsProps> = ({
  storyStats,
  isNightMode,
}) => {
  const themes = storyStats?.top_themes ?? [];
  const max = Math.max(...themes.map(t => t.count), 1);

  const sectionClass = `rounded-2xl border p-4 ${
    isNightMode
      ? 'bg-slate-800/60 border-slate-700 text-slate-100'
      : 'bg-white/80 border-amber-200/60 text-amber-950'
  }`;

  return (
    <section className={sectionClass}>
      <h3 className="text-sm font-semibold mb-3">🎯 Chủ đề phổ biến</h3>
      {themes.length === 0 ? (
        <p className="text-sm opacity-70">Chưa có dữ liệu</p>
      ) : (
        <div className="space-y-2">
          {themes.map(t => (
            <div key={t.theme} className="flex items-center gap-2">
              <span className="truncate w-24 text-sm">{t.theme}</span>
              <div className="flex-1 h-6 rounded bg-slate-700/30 overflow-hidden">
                <div
                  className="h-full rounded bg-indigo-500"
                  style={{ width: `${(t.count / max) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right text-sm">{t.count}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default AnalyticsTopics;