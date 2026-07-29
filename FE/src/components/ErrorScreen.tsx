import React from 'react';
import { AlertCircle, RotateCcw, Home, Wifi, Clock, Server } from 'lucide-react';

interface ErrorScreenProps {
  onRetry: () => void;
  onGoHome: () => void;
  isNightMode: boolean;
  errorType?: 'network' | 'timeout' | 'server' | 'unknown';
}

const ERROR_MESSAGES: Record<string, { title: string; message: string; icon: React.ReactNode }> = {
  network: {
    title: 'Mạng không ổn định',
    message: 'Kết nối mạng có vẻ không ổn định. Ba mẹ kiểm tra lại kết nối và thử lại nhé.',
    icon: <Wifi className="w-8 h-8" />,
  },
  timeout: {
    title: 'Máy kể chuyện hơi chậm',
    message: 'Quá trình tạo truyện lâu hơn dự kiến. Vui lòng thử lại, bé nhé!',
    icon: <Clock className="w-8 h-8" />,
  },
  server: {
    title: 'Máy chủ đang bảo trì',
    message: 'Máy kể chuyện đang nghỉ ngơi chút ít. Ba mẹ quay lại sau giúp bé nhé!',
    icon: <Server className="w-8 h-8" />,
  },
  unknown: {
    title: 'Ối, có chút gián đoạn nhỏ!',
    message: 'Quá trình dệt câu chuyện bị gián đoạn chốc lát. Ba mẹ hãy nhấn thử lại nhé.',
    icon: <AlertCircle className="w-8 h-8" />,
  },
};

export const ErrorScreen: React.FC<ErrorScreenProps> = ({
  onRetry,
  onGoHome,
  isNightMode,
  errorType = 'unknown',
}) => {
  const error = ERROR_MESSAGES[errorType] || ERROR_MESSAGES.unknown;

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center animate-fadeIn space-y-6">
      <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-500 flex items-center justify-center">
        {error.icon}
      </div>

      <div className="space-y-2 max-w-sm mx-auto">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
          {error.title}
        </h2>
        <p className="text-xs sm:text-sm opacity-80 leading-relaxed">
          {error.message}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          id="btn-error-retry"
          onClick={onRetry}
          className="py-3 px-6 rounded-2xl font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-700 shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Thử lại ngay</span>
        </button>

        <button
          id="btn-error-gohome"
          onClick={onGoHome}
          className={`py-3 px-6 rounded-2xl font-bold text-sm border flex items-center justify-center gap-2 cursor-pointer transition-all ${
            isNightMode
              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              : 'bg-white hover:bg-amber-100 border-amber-200 text-amber-950'
          }`}
        >
          <Home className="w-4 h-4" />
          <span>Về trang chủ</span>
        </button>
      </div>
    </div>
  );
};