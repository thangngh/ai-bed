import React, { useEffect, useRef } from 'react';
import { ExternalLink, Heart, X } from 'lucide-react';
import { SupportPaymentPanel } from './SupportPaymentPanel';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  isNightMode: boolean;
}

export const SupportModal: React.FC<SupportModalProps> = ({ isOpen, onClose, isNightMode }) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="support-modal-backdrop fixed inset-0 z-60 flex items-center justify-center overflow-hidden bg-black/65 p-2 backdrop-blur-xs sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-modal-title"
        className={`support-modal-card flex w-full max-w-xl flex-col overflow-hidden rounded-[1.5rem] border shadow-2xl sm:rounded-3xl ${
          isNightMode
            ? 'border-slate-700 bg-slate-900 text-slate-100'
            : 'border-amber-200 bg-white text-amber-950'
        }`}
      >
        <header className={`flex shrink-0 items-center justify-between gap-3 border-b px-3.5 py-3 sm:px-4 sm:py-3.5 ${
          isNightMode ? 'border-slate-800' : 'border-amber-100'
        }`}>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500 sm:h-10 sm:w-10 sm:rounded-2xl">
              <Heart className="h-4.5 w-4.5 fill-rose-500 sm:h-5 sm:w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="support-modal-title" className="text-lg font-extrabold">Ủng hộ tùy tâm</h2>
              <p className={`support-modal-subtitle text-[11px] leading-relaxed sm:text-xs ${isNightMode ? 'text-slate-300' : 'text-amber-800/80'}`}>
                Góp một chút để những câu chuyện dịu dàng tiếp tục được kể.
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            id="btn-close-support-modal"
            type="button"
            onClick={onClose}
            className={`shrink-0 rounded-xl p-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
              isNightMode ? 'hover:bg-white/10' : 'hover:bg-black/5'
            }`}
            aria-label="Đóng cửa sổ ủng hộ"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 p-3 sm:p-4">
          <SupportPaymentPanel isNightMode={isNightMode} compact />

          <div className={`mt-3 flex items-center justify-between gap-3 border-t pt-3 text-[11px] sm:text-xs ${
            isNightMode ? 'border-slate-800 text-slate-300' : 'border-amber-100 text-amber-800'
          }`}>
            <p className="leading-relaxed">Tự nguyện · Không ảnh hưởng quyền sử dụng</p>
            <a
              href="/support"
              className="inline-flex shrink-0 items-center gap-1 font-semibold text-indigo-500 hover:underline"
            >
              Xem minh bạch
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};
