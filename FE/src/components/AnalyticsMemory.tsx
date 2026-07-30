import React from 'react';
import { MemoryStats } from '../types';

interface AnalyticsMemoryProps {
  memoryStats: MemoryStats | null;
  isNightMode: boolean;
}

const AnalyticsMemory: React.FC<AnalyticsMemoryProps> = ({
  memoryStats,
  isNightMode,
}) => {
  const interests = memoryStats?.top_interests.map(i => i.value) ?? [];
  const characters = memoryStats?.top_characters ?? [];
  const goals = memoryStats?.common_goals.map(g => g.goal) ?? [];

  const hasData = interests.length > 0 || characters.length > 0 || goals.length > 0;

  const sectionClass = `rounded-2xl border p-4 ${
    isNightMode
      ? 'bg-slate-800/60 border-slate-700 text-slate-100'
      : 'bg-white/80 border-amber-200/60 text-amber-950'
  }`;

  return (
    <section className={sectionClass}>
      <h3 className="text-sm font-semibold mb-3">🧠 Memory Insights</h3>
      {!hasData ? (
        <p className="text-sm opacity-70">Chưa có dữ liệu</p>
      ) : (
        <div className="space-y-3">
          <div>
            <span className="text-sm">⭐ Sở thích nổi bật</span>
            <p className="text-sm mt-1">{interests.join(', ')}</p>
          </div>
          <div>
            <span className="text-sm">🎭 Nhân vật yêu thích</span>
            <p className="text-sm mt-1">{characters.join(', ')}</p>
          </div>
          {goals.length > 0 && (
            <div>
              <span className="text-sm">📖 Bài học thường chọn</span>
              <p className="text-sm mt-1">{goals.join(', ')}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default AnalyticsMemory;