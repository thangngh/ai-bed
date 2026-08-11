import React, { useState, useEffect } from 'react';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import AnalyticsOverview from './AnalyticsOverview';
import AnalyticsTrendChart from './AnalyticsTrendChart';
import AnalyticsTopics from './AnalyticsTopics';
import AnalyticsMemory from './AnalyticsMemory';
import { analyticsClient } from '../utils/analyticsClient';
import { ChildProfile } from '../types';

interface AnalyticsScreenProps {
  childProfiles: ChildProfile[];
  activeChild: ChildProfile | null;
  onBack: () => void;
  isNightMode: boolean;
  onAddChild: () => void;
}

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({
  childProfiles,
  activeChild,
  onBack,
  isNightMode,
  onAddChild,
}) => {
  const [selectedChildId, setSelectedChildId] = useState<string>(
    activeChild?.childId || (childProfiles.length > 0 ? childProfiles[0].childId : '')
  );
  const [storyStats, setStoryStats] = useState<any>(null);
  const [feedbackStats, setFeedbackStats] = useState<any>(null);
  const [memoryStats, setMemoryStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async (childId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [s, f, m] = await Promise.all([
        analyticsClient.getStoryStats(childId).catch(() => null),
        analyticsClient.getFeedbackStats(childId).catch(() => null),
        analyticsClient.getMemoryStats(childId).catch(() => null),
      ]);
      setStoryStats(s);
      setFeedbackStats(f);
      setMemoryStats(m);
    } catch (err: any) {
      setError(err?.message || 'Lỗi tải thống kê');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedChildId) {
      fetchStats(selectedChildId);
    } else {
      setLoading(false);
    }
  }, [selectedChildId]);

  const handleChildChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedChildId(id);
  };

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        isNightMode ? 'bg-slate-950 text-slate-100' : 'bg-amber-50/70 text-amber-950'
      }`}
    >
      <div className="max-w-4xl mx-auto px-4 pb-16">
        <div className="flex items-center gap-3 mb-4 pt-4">
          <button
            onClick={onBack}
            className={`p-2 rounded-xl transition-all ${
              isNightMode
                ? 'bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200'
                : 'bg-amber-100/80 hover:bg-amber-200/60 border border-amber-200 text-amber-900'
            }`}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-500" />
            Phân tích
          </h1>
        </div>

        {childProfiles.length > 0 && (
          <div className="mb-6">
            <select
              value={selectedChildId}
              onChange={handleChildChange}
              className={`w-full max-w-xs p-2 rounded-xl border text-sm transition-colors ${
                isNightMode
                  ? 'bg-slate-800/80 border-slate-700 text-slate-100'
                  : 'bg-white/80 border-amber-200 text-amber-950'
              }`}
            >
              {childProfiles.map((child) => (
                <option key={child.childId} value={child.childId}>
                  {child.childName}
                </option>
              ))}
            </select>
          </div>
        )}

        {loading && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`p-4 rounded-2xl border animate-pulse ${
                    isNightMode
                      ? 'bg-slate-800/60 border-slate-700'
                      : 'bg-white/80 border-amber-200/60'
                  }`}
                >
                  <div className="h-4 rounded bg-slate-700/30 w-24 mb-3" />
                  <div className="h-8 rounded bg-slate-700/30 w-16" />
                </div>
              ))}
            </div>
            <div className={`rounded-2xl border p-4 animate-pulse ${
              isNightMode
                ? 'bg-slate-800/60 border-slate-700'
                : 'bg-white/80 border-amber-200/60'
            }`} style={{ height: '8rem' }} />
            <div className={`rounded-2xl border p-4 animate-pulse ${
              isNightMode
                ? 'bg-slate-800/60 border-slate-700'
                : 'bg-white/80 border-amber-200/60'
            }`} style={{ height: '8rem' }} />
          </div>
        )}

        {!loading && !selectedChildId && (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">👶</div>
            <p className="text-lg font-semibold mb-2">Chưa có hồ sơ bé nào</p>
            <p className="text-sm opacity-70 mb-5">Thêm hồ sơ để xem thống kê</p>
            <button
              id="btn-analytics-add-child"
              onClick={onAddChild}
              className="px-5 py-3 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            >
              Thêm hồ sơ bé
            </button>
          </div>
        )}

        {!loading && selectedChildId && !error && (
          <div className="space-y-4">
            <AnalyticsOverview
              storyStats={storyStats}
              feedbackStats={feedbackStats}
              isNightMode={isNightMode}
            />
            <AnalyticsTrendChart
              storyStats={storyStats}
              isNightMode={isNightMode}
            />
            <AnalyticsTopics
              storyStats={storyStats}
              isNightMode={isNightMode}
            />
            <AnalyticsMemory
              memoryStats={memoryStats}
              isNightMode={isNightMode}
            />
          </div>
        )}

        {!loading && error && (
          <div className="text-center py-16">
            <p className="text-lg font-semibold mb-2">Lỗi tải dữ liệu</p>
            <p className="text-sm opacity-70">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};