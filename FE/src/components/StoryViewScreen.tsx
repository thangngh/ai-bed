import React, { useState } from 'react';
import {
  BookOpen,
  RotateCcw,
  PlusCircle,
  MessageSquare,
  Bookmark,
  CheckCircle2,
  // Volume2,  // TTS tạm tắt — xem khối "Voice Text to Speech" bên dưới
  // VolumeX,
  Type,
  HelpCircle,
  Heart,
  Sparkles,
} from 'lucide-react';
import { BedtimeStory } from '../types';

interface StoryViewScreenProps {
  story: BedtimeStory;
  onReadAgain: () => void;
  onCreateNew: () => void;
  onGoToFeedback: () => void;
  onSaveStory: (story: BedtimeStory) => void;
  isSaved: boolean;
  isNightMode: boolean;
}

export const StoryViewScreen: React.FC<StoryViewScreenProps> = ({
  story,
  onReadAgain,
  onCreateNew,
  onGoToFeedback,
  onSaveStory,
  isSaved,
  isNightMode,
}) => {
  const [fontSize, setFontSize] = useState<'normal' | 'large' | 'xlarge'>('large');
  const [askedPrompts, setAskedPrompts] = useState<{ [key: string]: boolean }>({});

  const togglePromptChecked = (key: string) => {
    setAskedPrompts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // --- TTS tạm tắt ---------------------------------------------------------
  // Web Speech API phụ thuộc voice của hệ điều hành: Windows thường không có
  // vi-VN, còn nơi có thì giọng máy quá cứng cho truyện trước giờ ngủ. Giữ lại
  // nguyên khối để tham chiếu cho đến khi chốt hướng giọng đọc thuần Việt.
  //
  // const [isSpeaking, setIsSpeaking] = useState(false);
  //
  // // Stop speech when component unmounts
  // useEffect(() => {
  //   return () => {
  //     if ('speechSynthesis' in window) {
  //       window.speechSynthesis.cancel();
  //     }
  //   };
  // }, []);
  //
  // const toggleSpeech = () => {
  //   if (!('speechSynthesis' in window)) {
  //     alert('Trình duyệt của bạn không hỗ trợ đọc tự động.');
  //     return;
  //   }
  //
  //   if (isSpeaking) {
  //     window.speechSynthesis.cancel();
  //     setIsSpeaking(false);
  //   } else {
  //     const fullText = `${story.title}. ${story.segments.opening}. ${story.segments.situation}. ${story.segments.challenge}. ${story.segments.ending}. ${story.segments.moralSummary}`;
  //     const utterance = new SpeechSynthesisUtterance(fullText);
  //     utterance.lang = 'vi-VN';
  //     utterance.rate = 0.85; // Soothing slow rate for bedtime
  //     utterance.pitch = 1.0;
  //
  //     utterance.onend = () => setIsSpeaking(false);
  //     utterance.onerror = () => setIsSpeaking(false);
  //
  //     window.speechSynthesis.speak(utterance);
  //     setIsSpeaking(true);
  //   }
  // };
  // -------------------------------------------------------------------------

  // Font size classes calculation
  const getTextSizeClass = () => {
    switch (fontSize) {
      case 'normal':
        return 'text-base sm:text-lg leading-relaxed';
      case 'large':
        return 'text-lg sm:text-xl leading-relaxed';
      case 'xlarge':
        return 'text-xl sm:text-2xl leading-loose';
      default:
        return 'text-lg sm:text-xl leading-relaxed';
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-4 md:py-6 animate-fadeIn space-y-6">
      {/* Controls & Quick Actions Toolbar */}
      <div
        className={`p-3.5 rounded-2xl border flex items-center justify-between gap-2 text-xs font-medium backdrop-blur-md sticky top-16 z-30 transition-all ${
          isNightMode
            ? 'bg-slate-900/90 border-slate-800 text-slate-200 shadow-md'
            : 'bg-amber-100/90 border-amber-200/80 text-amber-950 shadow-xs'
        }`}
      >
        {/* Child Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 font-bold">
          <BookOpen className="w-3.5 h-3.5" />
          <span>Dành cho bé {story.childName} ({story.childAge}t)</span>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1.5">
          {/* Font size toggle */}
          <button
            id="btn-story-font-size"
            onClick={() => {
              if (fontSize === 'normal') setFontSize('large');
              else if (fontSize === 'large') setFontSize('xlarge');
              else setFontSize('normal');
            }}
            className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors flex items-center gap-1"
            title="Điều chỉnh cỡ chữ"
          >
            <Type className="w-4 h-4 text-amber-500" />
            <span className="hidden sm:inline uppercase font-bold text-[10px]">
              {fontSize === 'normal' ? 'Cỡ vừa' : fontSize === 'large' ? 'Cỡ lớn' : 'Cỡ rất lớn'}
            </span>
          </button>

          {/* Voice Text to Speech — tạm tắt, xem ghi chú ở đầu component
          <button
            id="btn-story-tts"
            onClick={toggleSpeech}
            className={`p-2 rounded-xl transition-colors flex items-center gap-1 ${
              isSpeaking
                ? 'bg-rose-500 text-white animate-pulse'
                : 'hover:bg-black/5 dark:hover:bg-white/10'
            }`}
            title={isSpeaking ? 'Dừng đọc tự động' : 'Đọc giọng dịu dàng bằng AI máy'}
          >
            {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-500" />}
            <span className="hidden sm:inline text-[10px]">{isSpeaking ? 'Đang đọc' : 'Đọc tự động'}</span>
          </button>
          */}

          {/* Save Story */}
          <button
            id="btn-story-save"
            onClick={() => onSaveStory(story)}
            className={`p-2 rounded-xl transition-colors flex items-center gap-1 ${
              isSaved
                ? 'bg-indigo-600 text-white'
                : 'hover:bg-black/5 dark:hover:bg-white/10 text-indigo-500'
            }`}
            title={isSaved ? 'Đã lưu vào tủ truyện' : 'Lưu vào tủ truyện'}
          >
            <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-white' : ''}`} />
            <span className="hidden sm:inline text-[10px]">{isSaved ? 'Đã lưu' : 'Lưu'}</span>
          </button>
        </div>
      </div>

      {/* Story Card Container */}
      <div
        className={`p-6 sm:p-10 rounded-3xl border shadow-xl space-y-8 transition-colors ${
          isNightMode
            ? 'bg-slate-900 border-indigo-950 text-slate-100 shadow-indigo-950/40'
            : 'bg-gradient-to-b from-amber-50/90 via-orange-50/40 to-amber-100/50 border-amber-200/90 text-amber-950'
        }`}
      >
        {/* Story Title */}
        <div className="text-center space-y-3 pb-6 border-b border-dashed border-gray-200 dark:border-gray-800">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Chủ đề: {story.topic}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight leading-snug">
            {story.title}
          </h1>
        </div>

        {/* Story Content & Interactive Cards */}
        <div className={`space-y-7 ${getTextSizeClass()}`}>
          {/* Paragraph 1: Mở đầu */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-500 block opacity-80">
              1. Mở đầu câu chuyện
            </span>
            <p className="font-serif leading-relaxed opacity-95">
              {story.segments.opening}
            </p>
          </div>

          {/* Paragraph 2: Tình huống nhẹ */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-500 block opacity-80">
              2. Tình huống dịu dàng
            </span>
            <p className="font-serif leading-relaxed opacity-95">
              {story.segments.situation}
            </p>
          </div>

          {/* Prompt 1 — a story from the Engine may carry fewer than three
              interaction points, so an empty slot renders nothing at all. */}
          {story.segments.interaction1 && (
          <div
            onClick={() => togglePromptChecked('prompt1')}
            className={`p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer select-none space-y-1.5 ${
              askedPrompts['prompt1']
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-900 dark:text-emerald-200'
                : 'bg-indigo-500/10 border-indigo-400/40 text-indigo-950 dark:text-indigo-200 hover:border-indigo-400'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wide flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300">
                <HelpCircle className="w-4 h-4 text-amber-400" />
                <span>Điểm dừng tương tác 1</span>
              </span>
              <span className="text-xs font-semibold flex items-center gap-1">
                {askedPrompts['prompt1'] ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Đã hỏi bé
                  </span>
                ) : (
                  <span className="opacity-70">Nhấn khi ba mẹ đã hỏi</span>
                )}
              </span>
            </div>
            <p className="font-semibold text-sm sm:text-base italic text-amber-800 dark:text-amber-200">
              💡 {story.segments.interaction1}
            </p>
          </div>
          )}

          {/* Paragraph 3: Thử thách nhỏ */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-500 block opacity-80">
              3. Thử thách nhỏ
            </span>
            <p className="font-serif leading-relaxed opacity-95">
              {story.segments.challenge}
            </p>
          </div>

          {/* Prompt 2 */}
          {story.segments.interaction2 && (
          <div
            onClick={() => togglePromptChecked('prompt2')}
            className={`p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer select-none space-y-1.5 ${
              askedPrompts['prompt2']
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-900 dark:text-emerald-200'
                : 'bg-indigo-500/10 border-indigo-400/40 text-indigo-950 dark:text-indigo-200 hover:border-indigo-400'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wide flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300">
                <HelpCircle className="w-4 h-4 text-amber-400" />
                <span>Điểm dừng tương tác 2</span>
              </span>
              <span className="text-xs font-semibold flex items-center gap-1">
                {askedPrompts['prompt2'] ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Đã hỏi bé
                  </span>
                ) : (
                  <span className="opacity-70">Nhấn khi ba mẹ đã hỏi</span>
                )}
              </span>
            </div>
            <p className="font-semibold text-sm sm:text-base italic text-amber-800 dark:text-amber-200">
              💡 {story.segments.interaction2}
            </p>
          </div>
          )}

          {/* Paragraph 4: Kết thúc ấm áp */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-500 block opacity-80">
              4. Kết thúc ấm áp
            </span>
            <p className="font-serif leading-relaxed opacity-95">
              {story.segments.ending}
            </p>
          </div>

          {/* Prompt 3 */}
          {story.segments.interaction3 && (
          <div
            onClick={() => togglePromptChecked('prompt3')}
            className={`p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer select-none space-y-1.5 ${
              askedPrompts['prompt3']
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-900 dark:text-emerald-200'
                : 'bg-indigo-500/10 border-indigo-400/40 text-indigo-950 dark:text-indigo-200 hover:border-indigo-400'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wide flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300">
                <HelpCircle className="w-4 h-4 text-amber-400" />
                <span>Điểm dừng tương tác 3</span>
              </span>
              <span className="text-xs font-semibold flex items-center gap-1">
                {askedPrompts['prompt3'] ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Đã hỏi bé
                  </span>
                ) : (
                  <span className="opacity-70">Nhấn khi ba mẹ đã hỏi</span>
                )}
              </span>
            </div>
            <p className="font-semibold text-sm sm:text-base italic text-amber-800 dark:text-amber-200">
              💡 {story.segments.interaction3}
            </p>
          </div>
          )}

          {/* Moral Lesson Summary Box */}
          <section
            aria-labelledby="moral-lesson-title"
            className={`p-5 sm:p-6 rounded-2xl border space-y-2 ${
              isNightMode
                ? 'bg-slate-950 border-slate-700 text-slate-100'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-950'
            }`}
          >
            <span
              id="moral-lesson-title"
              className={`text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 ${
                isNightMode ? 'text-amber-200' : 'text-amber-700'
              }`}
            >
              <Heart
                className={`w-4 h-4 ${
                  isNightMode ? 'text-amber-300' : 'text-rose-500 fill-rose-500'
                }`}
              />
              <span>Bài học nhân văn gửi gắm</span>
            </span>
            <p className="text-sm sm:text-base font-medium leading-relaxed">
              {story.segments.moralSummary}
            </p>
          </section>
        </div>
      </div>

      {/* End Actions Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
        <button
          id="btn-story-read-again"
          onClick={onReadAgain}
          className={`py-3.5 px-4 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 border transition-all cursor-pointer ${
            isNightMode
              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-100'
              : 'bg-white hover:bg-amber-100 border-amber-200 text-amber-950'
          }`}
        >
          <RotateCcw className="w-4 h-4 text-indigo-500" />
          <span>Đọc lại từ đầu</span>
        </button>

        <button
          id="btn-story-create-new"
          onClick={onCreateNew}
          className={`py-3.5 px-4 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 border transition-all cursor-pointer ${
            isNightMode
              ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-100'
              : 'bg-white hover:bg-amber-100 border-amber-200 text-amber-950'
          }`}
        >
          <PlusCircle className="w-4 h-4 text-emerald-500" />
          <span>Tạo truyện khác</span>
        </button>

        <button
          id="btn-story-go-feedback"
          onClick={onGoToFeedback}
          className="py-3.5 px-4 rounded-2xl font-bold text-xs sm:text-sm text-white bg-indigo-600 hover:bg-indigo-700 shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <MessageSquare className="w-4 h-4 text-amber-300" />
          <span>Đánh giá & Phản hồi</span>
        </button>
      </div>
    </div>
  );
};
