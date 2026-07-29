import React, { useEffect, useState } from 'react';
import { Sparkles, Moon, Star, Heart } from 'lucide-react';

interface LoadingScreenProps {
  childName?: string;
  isNightMode: boolean;
}

const BEDTIME_TIPS = [
  'Đang dệt từng trang cổ tích ấm áp...',
  'Lồng ghép các câu hỏi tương tác để ba mẹ trò chuyện cùng bé...',
  'Thì thầm giọng dịu dàng khi đọc sẽ giúp bé nhanh đi vào giấc ngủ hơn...',
  'Sắp hoàn tất rồi! Hãy ôm bé thật ấm áp ba mẹ nhé...',
];

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  childName,
  isNightMode,
}) => {
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % BEDTIME_TIPS.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center animate-fadeIn space-y-6">
      {/* Animated Night Sky Icon Container */}
      <div className="relative w-28 h-28 flex items-center justify-center">
        {/* Glowing Outer Ring */}
        <div className="absolute inset-0 rounded-full bg-indigo-500/20 animate-ping opacity-75" />
        <div className="absolute inset-2 rounded-full bg-indigo-600/30 blur-md" />

        {/* Center Card */}
        <div
          className={`relative z-10 w-20 h-20 rounded-3xl flex items-center justify-center border shadow-xl ${
            isNightMode
              ? 'bg-slate-900 border-indigo-700/60 text-amber-300'
              : 'bg-white border-amber-300 text-amber-600'
          }`}
        >
          <Moon className="w-10 h-10 animate-bounce" style={{ animationDuration: '3s' }} />
        </div>

        {/* Floating Stars */}
        <Star className="absolute top-1 right-1 w-5 h-5 text-amber-400 fill-amber-400 animate-pulse" />
        <Star className="absolute bottom-2 left-2 w-4 h-4 text-indigo-400 fill-indigo-400 animate-pulse" style={{ animationDelay: '500ms' }} />
        <Sparkles className="absolute top-3 left-2 w-5 h-5 text-amber-300 animate-spin" style={{ animationDuration: '6s' }} />
      </div>

      {/* Main Message */}
      <div className="space-y-2 max-w-md mx-auto">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
          Đang tạo câu chuyện cho bé {childName || 'nhỏ'}...
        </h2>
        <p className="text-xs sm:text-sm font-medium opacity-80 min-h-[40px] flex items-center justify-center px-4 transition-all duration-300">
          {BEDTIME_TIPS[tipIndex]}
        </p>
      </div>

      {/* Subtle Progress Bar */}
      <div className="w-48 h-1.5 rounded-full bg-indigo-200/40 dark:bg-slate-800 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-amber-400 via-indigo-500 to-indigo-600 animate-pulse rounded-full w-3/4" />
      </div>

      <div className="flex items-center gap-1.5 text-[11px] opacity-60">
        <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400" />
        <span>Sản phẩm dành cho giấc ngủ dịu êm của trẻ nhỏ</span>
      </div>
    </div>
  );
};
