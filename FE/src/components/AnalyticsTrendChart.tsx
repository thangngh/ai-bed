import React from 'react';
import { StoryStats } from '../types';

interface AnalyticsTrendChartProps {
  storyStats: StoryStats | null;
  isNightMode: boolean;
}

const dayAbbrevMap: Record<string, string> = {
  Mon: 'T2',
  Tue: 'T3',
  Wed: 'T4',
  Thu: 'T5',
  Fri: 'T6',
  Sat: 'T7',
  Sun: 'CN',
};

const AnalyticsTrendChart: React.FC<AnalyticsTrendChartProps> = ({
  storyStats,
  isNightMode,
}) => {
  const data = storyStats?.stories_per_day ?? [];
  const max = Math.max(...data.map(d => d.count), 1);

  const sectionClass = `rounded-2xl border p-4 ${
    isNightMode
      ? 'bg-slate-800/60 border-slate-700 text-slate-100'
      : 'bg-white/80 border-amber-200/60 text-amber-950'
  }`;

  return (
    <section className={sectionClass}>
      <h3 className="text-sm font-semibold mb-3">📈 Xu hướng (7 ngày qua)</h3>
      {data.length === 0 || data.every(d => d.count === 0) ? (
        <p className="text-sm opacity-70">Chưa có dữ liệu</p>
      ) : (
        <div className="flex items-end gap-2 h-32">
          {data.map(d => {
            const height = (d.count / max) * 100;
            const label = dayAbbrevMap[d.day] ?? d.day;
            return (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="bg-indigo-500 rounded-t-md min-h-[4px] transition-all"
                  style={{ height: `${height}%`, width: '100%' }}
                />
                <span className="text-[10px] opacity-70">{label}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default AnalyticsTrendChart;