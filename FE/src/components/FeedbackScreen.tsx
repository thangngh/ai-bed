import React, { useState } from 'react';
import { Star, CheckCircle, Heart, Send, Sparkles, ArrowRight, RotateCcw } from 'lucide-react';
import { FeedbackData } from '../types';

interface FeedbackScreenProps {
  storyId: string;
  childName: string;
  onSubmitFeedback: (data: FeedbackData) => void;
  onStartNewStory: () => void;
  onOpenSupport: () => void;
  isNightMode: boolean;
}

export const FeedbackScreen: React.FC<FeedbackScreenProps> = ({
  storyId,
  childName,
  onSubmitFeedback,
  onStartNewStory,
  onOpenSupport,
  isNightMode,
}) => {
  const [listenedUntilEnd, setListenedUntilEnd] = useState<boolean | null>(true);
  const [wantsMoreStories, setWantsMoreStories] = useState<'yes' | 'normal' | 'no' | null>('yes');
  const [suitabilityRating, setSuitabilityRating] = useState<number>(5);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmitFeedback({
        storyId,
        listenedUntilEnd,
        wantsMoreStories,
        suitabilityRating,
        comment: comment.trim(),
      });
      setSubmitted(true);
    } catch {
      // Error handling — still show submitted for now
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-md mx-auto py-10 px-6 text-center animate-fadeIn space-y-6">
        <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center shadow-lg">
          <CheckCircle className="w-10 h-10" />
        </div>

        <div className="space-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight">Cảm ơn ba mẹ!</h2>
          <p className="text-sm opacity-80 leading-relaxed">
            Phản hồi quý giá này giúp chúng tôi hoàn thiện và dệt nên nhiều câu chuyện ấm áp hơn nữa cho bé {childName}.
          </p>
        </div>

        <div className="p-4 rounded-2xl border bg-amber-500/10 border-amber-500/20 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2 justify-center">
          <Heart className="w-4 h-4 text-rose-500 fill-rose-500 shrink-0" />
          <span>Chúc bé {childName} có một giấc ngủ thật ngon và những giấc mơ ngọt ngào! 🌙✨</span>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <button
            id="btn-feedback-create-another"
            onClick={onStartNewStory}
            className="w-full py-3.5 px-6 rounded-2xl font-bold text-sm text-white bg-indigo-600 hover:bg-indigo-700 shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>Tạo truyện mới cho bé</span>
          </button>
        </div>

        <div className={`rounded-2xl border p-4 text-left ${
          isNightMode
            ? 'border-slate-700 bg-slate-900/60 text-slate-200'
            : 'border-rose-200 bg-rose-50/60 text-amber-950'
        }`}>
          <div className="flex items-start gap-3">
            <Heart className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            <div className="space-y-2">
              <p className="text-sm font-bold">Giúp những câu chuyện tiếp tục được kể</p>
              <p className={`text-xs leading-relaxed ${isNightMode ? 'text-slate-300' : 'text-amber-800/80'}`}>
                Nếu dự án hữu ích với gia đình mình, ba mẹ có thể ủng hộ tùy tâm cho chi phí vận hành.
                Việc ủng hộ không ảnh hưởng đến quyền sử dụng ứng dụng.
              </p>
              <button
                id="btn-feedback-open-support"
                type="button"
                onClick={onOpenSupport}
                className="text-xs font-bold text-indigo-500 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                Xem mã VietQR
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-6 animate-fadeIn space-y-6">
      <div className="text-center space-y-2">
        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 inline-block">
          Màn hình phản hồi nhanh
        </span>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
          Cảm nhận của bé {childName} đêm nay
        </h2>
        <p className="text-xs sm:text-sm opacity-80">
          Ba mẹ chia sẻ nhanh trong vài giây để giúp nâng cao chất lượng câu chuyện cho bé nhé!
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Question 1 */}
        <div
          className={`p-5 rounded-2xl border space-y-3 transition-colors ${
            isNightMode
              ? 'bg-slate-800/80 border-slate-700/80 text-slate-100'
              : 'bg-white border-amber-200/80 text-amber-950 shadow-xs'
          }`}
        >
          <label className="block text-sm font-bold">1. Bé có nghe hết câu chuyện không?</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              id="btn-q1-yes"
              onClick={() => setListenedUntilEnd(true)}
              className={`py-3 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                listenedUntilEnd === true
                  ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                  : isNightMode
                  ? 'bg-slate-900/60 border-slate-700 text-slate-300'
                  : 'bg-amber-50/60 border-amber-200 text-amber-900'
              }`}
            >
              Có, bé nghe hết 👍
            </button>

            <button
              type="button"
              id="btn-q1-no"
              onClick={() => setListenedUntilEnd(false)}
              className={`py-3 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                listenedUntilEnd === false
                  ? 'bg-rose-600 border-rose-600 text-white shadow-sm'
                  : isNightMode
                  ? 'bg-slate-900/60 border-slate-700 text-slate-300'
                  : 'bg-amber-50/60 border-amber-200 text-amber-900'
              }`}
            >
              Chưa nghe hết / Ngủ gật giữa chừng 😴
            </button>
          </div>
        </div>

        {/* Question 2 */}
        <div
          className={`p-5 rounded-2xl border space-y-3 transition-colors ${
            isNightMode
              ? 'bg-slate-800/80 border-slate-700/80 text-slate-100'
              : 'bg-white border-amber-200/80 text-amber-950 shadow-xs'
          }`}
        >
          <label className="block text-sm font-bold">2. Bé có muốn nghe tiếp câu chuyện khác không?</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { val: 'yes', label: 'Rất thích 🥰' },
              { val: 'normal', label: 'Bình thường 🙂' },
              { val: 'no', label: 'Chưa thích 🙁' },
            ].map((item) => (
              <button
                type="button"
                key={item.val}
                id={`btn-q2-${item.val}`}
                onClick={() => setWantsMoreStories(item.val as any)}
                className={`py-3 px-2 rounded-xl text-xs font-bold border text-center transition-all cursor-pointer ${
                  wantsMoreStories === item.val
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                    : isNightMode
                    ? 'bg-slate-900/60 border-slate-700 text-slate-300'
                    : 'bg-amber-50/60 border-amber-200 text-amber-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Question 3 */}
        <div
          className={`p-5 rounded-2xl border space-y-3 transition-colors ${
            isNightMode
              ? 'bg-slate-800/80 border-slate-700/80 text-slate-100'
              : 'bg-white border-amber-200/80 text-amber-950 shadow-xs'
          }`}
        >
          <label className="block text-sm font-bold">3. Mức độ phù hợp của truyện với bé {childName}</label>
          <div className="flex items-center justify-center gap-2 py-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                type="button"
                key={star}
                id={`btn-star-${star}`}
                onClick={() => setSuitabilityRating(star)}
                className="p-1 cursor-pointer transition-transform hover:scale-125 focus:outline-none"
              >
                <Star
                  className={`w-8 h-8 ${
                    star <= suitabilityRating
                      ? 'text-amber-400 fill-amber-400 drop-shadow-sm'
                      : 'text-gray-300 dark:text-gray-600'
                  }`}
                />
              </button>
            ))}
          </div>
          <p className="text-center text-xs opacity-75 font-medium">
            {suitabilityRating === 5
              ? 'Rất phù hợp và ấm áp!'
              : suitabilityRating >= 3
              ? 'Khá hay và phù hợp'
              : 'Cần cải thiện thêm'}
          </p>
        </div>

        {/* Optional Comment */}
        <div
          className={`p-5 rounded-2xl border space-y-2 transition-colors ${
            isNightMode
              ? 'bg-slate-800/80 border-slate-700/80 text-slate-100'
              : 'bg-white border-amber-200/80 text-amber-950 shadow-xs'
          }`}
        >
          <label htmlFor="input-feedback-comment" className="block text-xs font-bold opacity-90">
            Góp ý thêm cho đội ngũ thiết kế (Tùy chọn)
          </label>
          <textarea
            id="input-feedback-comment"
            rows={2}
            placeholder="Ba mẹ muốn thêm chủ đề gì hay có câu hỏi gì khác không..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className={`w-full p-3 rounded-xl text-xs border focus:outline-none transition-all ${
              isNightMode
                ? 'bg-slate-900 border-slate-700 text-slate-100'
                : 'bg-amber-50/50 border-amber-200 text-amber-950'
            }`}
          />
        </div>

        {/* Submit button */}
        <button
          id="btn-feedback-submit"
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-4 px-6 rounded-2xl text-base font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all ${
            isSubmitting ? 'opacity-60' : ''
          }`}
        >
          <Send className="w-5 h-5 text-amber-300" />
          <span>{isSubmitting ? 'Đang gửi...' : 'Gửi phản hồi ngay'}</span>
        </button>
      </form>
    </div>
  );
};
