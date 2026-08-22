import React, { useState } from 'react';
import { X, BookOpen, Trash2, ArrowRight, Star } from 'lucide-react';
import { BedtimeStory, ChildProfile } from '../types';

interface SavedStoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  savedStories: BedtimeStory[];
  beStories: BedtimeStory[];
  isLoadingBeStories: boolean;
  onSelectStory: (story: BedtimeStory) => void;
  onDeleteStory: (id: string) => void;
  isNightMode: boolean;
  activeChild?: ChildProfile | null;
}

export const SavedStoriesModal: React.FC<SavedStoriesModalProps> = ({
  isOpen,
  onClose,
  savedStories,
  beStories,
  isLoadingBeStories,
  onSelectStory,
  onDeleteStory,
  isNightMode,
  activeChild,
}) => {
  if (!isOpen) return null;

  const [filterTab, setFilterTab] = useState<'all' | 'child'>(activeChild ? 'child' : 'all');
  const showAllStories = filterTab === 'all';

  // Merge BE + localStorage stories. The same BE story may exist in both
  // collections, but two different children may legitimately receive the
  // same title, so identity -- never title or child name -- is the dedup key.
  const allMerged = [...beStories, ...savedStories];
  const seen = new Set<string>();
  const deduped = allMerged.filter(s => {
    const key = s.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const displayedStories = showAllStories || !activeChild
    ? deduped
    : deduped.filter(s => s.childId
      ? s.childId === activeChild.childId
      : s.childName === activeChild.childName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div
        className={`w-full max-w-lg max-h-[85vh] rounded-3xl border shadow-2xl flex flex-col overflow-hidden transition-all ${
          isNightMode
            ? 'bg-slate-900 border-slate-700 text-slate-100'
            : 'bg-white border-amber-200 text-amber-950'
        }`}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-500" />
            <h2 className="font-extrabold text-lg">Tủ truyện trước giờ ngủ</h2>
          </div>
          <button
            id="btn-close-saved-modal"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter tabs */}
        {activeChild && (
          <div className="px-5 pt-3 pb-1 flex gap-2">
            <button
              onClick={() => setFilterTab('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                filterTab === 'all'
                  ? 'bg-indigo-600 text-white'
                  : isNightMode ? 'bg-slate-800 text-slate-300' : 'bg-amber-100 text-amber-900'
              }`}
            >
              Tất cả
            </button>
            <button
              onClick={() => setFilterTab('child')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                filterTab === 'child'
                  ? 'bg-indigo-600 text-white'
                  : isNightMode ? 'bg-slate-800 text-slate-300' : 'bg-amber-100 text-amber-900'
              }`}
            >
              {activeChild.childName}
            </button>
          </div>
        )}

        {/* Content list */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          {isLoadingBeStories && (
            <div className="text-center py-6 text-sm opacity-70">Đang tải...</div>
          )}
          {!isLoadingBeStories && displayedStories.length === 0 ? (
            <div className="text-center py-10 space-y-2 opacity-70">
              <BookOpen className="w-12 h-12 mx-auto text-amber-400 opacity-60" />
              <p className="text-sm font-semibold">Tủ truyện hiện đang trống</p>
              <p className="text-xs">
                Khi ba mẹ tạo câu chuyện mới và nhấn "Lưu", câu chuyện sẽ xuất hiện tại đây để đọc lại bất cứ lúc nào.
              </p>
            </div>
          ) : (
            displayedStories.map((story) => (
              <div
                key={story.id}
                className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-3 ${
                  isNightMode
                    ? 'bg-slate-800/80 border-slate-700 hover:border-indigo-500/50'
                    : 'bg-amber-50/60 border-amber-200 hover:border-amber-400'
                }`}
              >
                <div
                  className="flex-1 cursor-pointer space-y-1"
                  onClick={() => {
                    onSelectStory(story);
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">
                      Bé {story.childName} ({story.childAge}t)
                    </span>
                    <span className="opacity-50">•</span>
                    <span className="opacity-75 flex items-center gap-1">
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                      {story.topic}
                    </span>
                  </div>
                  <h3 className="font-bold text-sm sm:text-base line-clamp-1">{story.title}</h3>
                  <p className="text-xs opacity-75 line-clamp-2">{story.segments.opening}</p>
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <button
                    id={`btn-delete-story-${story.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteStory(story.id);
                    }}
                    className="p-1.5 rounded-lg hover:bg-rose-500/10 text-rose-500 transition-colors cursor-pointer"
                    title="Xóa câu chuyện"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <button
                    id={`btn-select-story-${story.id}`}
                    onClick={() => {
                      onSelectStory(story);
                      onClose();
                    }}
                    className="p-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold flex items-center gap-1 hover:bg-indigo-700 transition-colors cursor-pointer"
                  >
                    <span>Đọc</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
