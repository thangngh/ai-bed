import React from 'react';
import { Moon, Sun, BookOpen, Sparkles, Heart } from 'lucide-react';
import { AppScreen, ChildProfile } from '../types';
import { getAvatarColor, getInitial } from '../utils/avatar';

interface HeaderProps {
  currentScreen: AppScreen;
  setScreen: (screen: AppScreen) => void;
  isNightMode: boolean;
  setIsNightMode: (val: boolean | ((prev: boolean) => boolean)) => void;
  savedStoriesCount: number;
  onOpenSavedStories: () => void;
  activeChild?: ChildProfile | null;
  onOpenChildSelector?: () => void;
  isOffline?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentScreen,
  setScreen,
  isNightMode,
  setIsNightMode,
  savedStoriesCount,
  onOpenSavedStories,
  activeChild,
  onOpenChildSelector,
  isOffline,
}) => {
  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-md transition-colors duration-300 ${
        isNightMode
          ? 'bg-slate-900/80 border-slate-800 text-slate-100'
          : 'bg-amber-50/80 border-amber-200/60 text-amber-950'
      }`}
    >
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Brand Logo + Child Avatar */}
        <div className="flex items-center gap-2">
          {activeChild && onOpenChildSelector && (
            <button
              onClick={onOpenChildSelector}
              className={`w-8 h-8 rounded-full ${getAvatarColor(activeChild.childId).bg} ${getAvatarColor(activeChild.childId).text} flex items-center justify-center font-bold text-sm shrink-0 cursor-pointer hover:ring-2 hover:ring-indigo-400 transition-all`}
              title={activeChild.childName}
            >
              {getInitial(activeChild.childName)}
            </button>
          )}
          <button
            id="btn-header-home"
            onClick={() => setScreen('home')}
            className="flex items-center gap-2.5 text-left group focus:outline-none"
          >
            <div
              className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm transition-transform group-hover:scale-105 ${
                isNightMode
                  ? 'bg-indigo-950/80 border border-indigo-700/50 text-indigo-300'
                  : 'bg-amber-200/70 border border-amber-300/60 text-amber-800'
              }`}
            >
              <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
            </div>
            <div>
              <h1 className="font-bold text-base md:text-lg tracking-tight flex items-center gap-1.5">
                <span>Bedtime Story</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-500/10 border border-indigo-400/20 text-indigo-400">
                  Companion
                </span>
              </h1>
              <p className="text-[11px] opacity-70">
                Chuyện kể trước giờ ngủ cho bé 3-6 tuổi
              </p>
            </div>
          </button>
        </div>

        {/* Offline Indicator */}
        {isOffline && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-semibold">
            📡 Ngoại tuyến
          </span>
        )}

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Saved Stories Button */}
          <button
            id="btn-header-saved-stories"
            onClick={onOpenSavedStories}
            className={`relative p-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all ${
              isNightMode
                ? 'bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200'
                : 'bg-amber-100/80 hover:bg-amber-200/60 border border-amber-200 text-amber-900'
            }`}
            title="Tủ truyện đã lưu"
          >
            <BookOpen className="w-4 h-4 text-amber-500" />
            <span className="hidden sm:inline">Tủ truyện</span>
            {savedStoriesCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center">
                {savedStoriesCount}
              </span>
            )}
          </button>

          {/* Night Mode Toggle */}
          <button
            id="btn-header-theme-toggle"
            onClick={() => setIsNightMode((prev) => !prev)}
            className={`p-2 rounded-xl transition-all ${
              isNightMode
                ? 'bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-800 text-amber-300'
                : 'bg-amber-100 hover:bg-amber-200/80 border border-amber-200 text-slate-700'
            }`}
            title={isNightMode ? 'Chuyển sang giao diện ban ngày' : 'Chuyển sang giao diện đọc đêm'}
          >
            {isNightMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>
  );
};
