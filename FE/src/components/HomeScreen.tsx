import React, { useEffect, useState } from 'react';
import { Sparkles, Moon, Heart, Star, BookOpen, ArrowRight, ShieldCheck, Smile } from 'lucide-react';
import { BedtimeStory, ChildProfile } from '../types';
import { MemoryContext } from '../types';
import { memoryClient } from '../utils/memoryClient';

interface HomeScreenProps {
  onStartNewStory: () => void;
  onSelectPresetStory: (story: BedtimeStory) => void;
  presetStories: BedtimeStory[];
  isNightMode: boolean;
  activeChild?: ChildProfile | null;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onStartNewStory,
  onSelectPresetStory,
  presetStories,
  isNightMode,
  activeChild,
}) => {
  const [memoryContext, setMemoryContext] = useState<MemoryContext | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);

  useEffect(() => {
    if (!activeChild?.childId) return;
    setMemoryLoading(true);
    memoryClient.getContext(activeChild.childId)
      .then(setMemoryContext)
      .catch(() => setMemoryContext(null))
      .finally(() => setMemoryLoading(false));
  }, [activeChild?.childId]);

  const filteredStories = activeChild
    ? presetStories.filter(s => s.childAge === activeChild.age)
    : presetStories;
  return (
    <div className="space-y-10 py-4 md:py-8 animate-fadeIn">
      {/* Hero Section */}
      <div
        className={`relative rounded-3xl p-6 sm:p-10 text-center overflow-hidden border shadow-sm transition-colors ${
          isNightMode
            ? 'bg-gradient-to-b from-indigo-950/90 via-slate-900 to-slate-950 border-indigo-900/60 text-slate-100'
            : 'bg-gradient-to-b from-amber-100/90 via-orange-50/60 to-amber-50 border-amber-200/80 text-amber-950'
        }`}
      >
        {/* Decorative Floating Moon & Stars */}
        <div className="absolute top-4 left-6 opacity-20 pointer-events-none animate-bounce duration-[4000ms]">
          <Moon className="w-12 h-12 text-indigo-400" />
        </div>
        <div className="absolute top-6 right-8 opacity-25 pointer-events-none animate-pulse">
          <Star className="w-8 h-8 text-amber-300" />
        </div>
        <div className="absolute bottom-4 left-1/4 opacity-15 pointer-events-none">
          <Sparkles className="w-6 h-6 text-indigo-300" />
        </div>

        <div className="max-w-2xl mx-auto space-y-5 relative z-10">
          {/* Child Greeting */}
          <div className="pt-1">
            {activeChild ? (
              <div className="animate-fadeIn">
                <p className="text-lg sm:text-xl font-bold">
                  🌟 Chào bé {activeChild.childName} ơi!
                </p>
                <p className="text-sm opacity-80">
                  Hôm nay {activeChild.childName} bao nhiêu tuổi? → {activeChild.age} tuổi 🌈
                </p>
              </div>
            ) : (
              <p className="text-lg font-bold">Chào ba mẹ!</p>
            )}
          </div>

          {/* Product Name & Short Description */}
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight leading-tight">
            Bedtime Story <span className="text-indigo-500 dark:text-indigo-400">Companion</span>
          </h1>

          <p className="text-lg sm:text-xl font-medium leading-relaxed opacity-90 max-w-xl mx-auto">
            Tạo câu chuyện trước giờ ngủ cho bé chỉ trong vài giây.
          </p>

          <p className="text-sm opacity-75 max-w-md mx-auto leading-normal">
            Mỗi tối một câu chuyện riêng dịu dàng, lồng ghép bài học yêu thương và điểm dừng tương tác gắn kết tình cảm gia đình.
          </p>

          {/* Primary CTA */}
          <div className="pt-2">
            <button
              id="btn-home-create-new-story"
              onClick={onStartNewStory}
              className="inline-flex items-center justify-center gap-3 px-8 py-4 rounded-2xl text-base font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/25 hover:shadow-indigo-600/40 transform hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer"
            >
              <Sparkles className="w-5 h-5 text-amber-300 fill-amber-300 animate-spin" style={{ animationDuration: '6s' }} />
              <span>Tạo truyện mới</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Memory Suggestions */}
      {memoryLoading && (
        <div className="space-y-2">
          <div className="h-4 w-32 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
          <div className="flex gap-3">
            <div className="h-16 w-32 bg-gray-200 dark:bg-slate-700 rounded-xl animate-pulse" />
            <div className="h-16 w-32 bg-gray-200 dark:bg-slate-700 rounded-xl animate-pulse" />
          </div>
        </div>
      )}
      {!memoryLoading && memoryContext && activeChild && (
        <div className="space-y-3">
          <h3 className={`text-sm font-semibold ${isNightMode ? 'text-slate-300' : 'text-amber-800'}`}>
            Gợi ý cho bé
          </h3>
          <div className="flex flex-wrap gap-3">
            {(() => {
              const suggestions = [
                ...(memoryContext.interests || []).map(i => ({ label: i.value, theme: i.value })),
                ...(memoryContext.recentThemes || []).slice(-2).map(t => ({ label: t.value, theme: t.value })),
              ].slice(0, 4);
              return suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => onStartNewStory()}
                  className={`px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                    isNightMode
                      ? 'bg-indigo-900/50 hover:bg-indigo-800/60 text-indigo-200 border border-indigo-700/50'
                      : 'bg-amber-100/80 hover:bg-amber-200/80 text-amber-800 border border-amber-200'
                  }`}
                >
                  🎯 {s.label}
                </button>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Feature Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          className={`p-5 rounded-2xl border transition-all ${
            isNightMode
              ? 'bg-slate-800/60 border-slate-700/80 text-slate-200'
              : 'bg-white/80 border-amber-200/60 text-amber-950 shadow-xs'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
            <Smile className="w-5 h-5" />
          </div>
          <h2 className="font-bold text-base mb-1">Cá nhân hóa bé</h2>
          <p className="text-xs opacity-80 leading-relaxed">
            Dễ dàng lồng ghép tên bé, độ tuổi, nhân vật yêu thích và bài học muốn gửi gắm đêm nay.
          </p>
        </div>

        <div
          className={`p-5 rounded-2xl border transition-all ${
            isNightMode
              ? 'bg-slate-800/60 border-slate-700/80 text-slate-200'
              : 'bg-white/80 border-amber-200/60 text-amber-950 shadow-xs'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3">
            <Sparkles className="w-5 h-5" />
          </div>
          <h2 className="font-bold text-base mb-1">Điểm dừng tương tác</h2>
          <p className="text-xs opacity-80 leading-relaxed">
            Các điểm gợi ý dừng lại hỏi bé giúp ba mẹ trò chuyện, kích thích trí tưởng tượng trước khi nhắm mắt.
          </p>
        </div>

        <div
          className={`p-5 rounded-2xl border transition-all ${
            isNightMode
              ? 'bg-slate-800/60 border-slate-700/80 text-slate-200'
              : 'bg-white/80 border-amber-200/60 text-amber-950 shadow-xs'
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h2 className="font-bold text-base mb-1">An toàn & Ấm áp</h2>
          <p className="text-xs opacity-80 leading-relaxed">
            100% nội dung tiếng Việt trong sáng, dịu nhẹ, không bạo lực, êm ái xua tan mệt mỏi cuối ngày.
          </p>
        </div>
      </div>

      {/* Preset / Sample Stories Section */}
      {filteredStories.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-lg sm:text-xl flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-500" />
                <span>Hoặc chọn đọc ngay truyện mẫu</span>
              </h2>
              <p className="text-xs opacity-70">
                Thử trải nghiệm giao diện đọc truyện dịu dàng dành cho bé
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filteredStories.map((story) => (
              <button
                key={story.id}
                id={`btn-sample-story-${story.id}`}
                onClick={() => onSelectPresetStory(story)}
                className={`p-5 rounded-2xl text-left border transition-all cursor-pointer group hover:-translate-y-1 ${
                  isNightMode
                    ? 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-100 hover:border-indigo-500/50'
                    : 'bg-white hover:bg-amber-50/80 border-amber-200/80 text-amber-950 hover:border-amber-400 shadow-xs'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
                    Bé {story.childName} ({story.childAge} tuổi)
                  </span>
                  <span className="text-xs opacity-60 flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                    <span>{story.topic}</span>
                  </span>
                </div>
                <h3 className="font-bold text-base group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors line-clamp-2 mb-2">
                  {story.title}
                </h3>
                <p className="text-xs opacity-75 line-clamp-2 leading-relaxed">
                  {story.segments.opening}
                </p>
                <div className="mt-3 pt-2 border-t border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  <span>Đọc ngay cùng bé</span>
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
