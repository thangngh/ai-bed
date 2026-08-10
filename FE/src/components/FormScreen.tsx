import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  User,
  Calendar,
  Compass,
  HeartHandshake,
  Smile,
  Cat,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AgeGroup, GenderOption, StoryFormInput, ChildProfile, MemoryContext } from '../types';
import { TOPIC_SUGGESTIONS, LESSON_SUGGESTIONS, MOOD_SUGGESTIONS } from '../data/sampleStories';
import { memoryClient } from '../utils/memoryClient';
import { childTextError, FIELD_LIMITS } from '../utils/childText';

interface FormScreenProps {
  onSubmit: (data: StoryFormInput) => void;
  onBack: () => void;
  isNightMode: boolean;
  activeChild?: ChildProfile | null;
}

export const FormScreen: React.FC<FormScreenProps> = ({
  onSubmit,
  onBack,
  isNightMode,
  activeChild,
}) => {
  const [childName, setChildName] = useState(activeChild?.childName || '');
  const [childAge, setChildAge] = useState<AgeGroup>(activeChild?.age || 4);
  const [favoriteTopic, setFavoriteTopic] = useState('Động vật');
  const [customTopic, setCustomTopic] = useState('');

  // Optional fields
  const [showOptional, setShowOptional] = useState(true);
  const [gender, setGender] = useState<GenderOption>((activeChild?.gender as GenderOption) || 'unspecified');
  const [lesson, setLesson] = useState(activeChild?.bedtimeGoal || 'Chia sẻ');
  const [customLesson, setCustomLesson] = useState('');
  const [mood, setMood] = useState('Vui vẻ');
  const [favoriteCharacter, setFavoriteCharacter] = useState(activeChild?.preferredCharacters || '');

  const [errors, setErrors] = useState<{
    childName?: string;
    customTopic?: string;
    customLesson?: string;
    favoriteCharacter?: string;
  }>({});

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = childName.trim();
    if (!trimmedName) {
      setErrors({ childName: 'Ba mẹ vui lòng nhập tên của bé nhé!' });
      return;
    }

    // The same rules the BE and the Engine enforce, said here so a parent
    // learns about them at the keyboard rather than after a loading screen.
    // Only the free-text boxes need checking -- the rest of the form is
    // buttons, whose values this component chose itself.
    const trimmedCharacter = favoriteCharacter.trim();
    const found = {
      childName: childTextError(trimmedName),
      customTopic: childTextError(customTopic.trim()),
      customLesson: childTextError(customLesson.trim()),
      favoriteCharacter: childTextError(trimmedCharacter),
    };
    if (Object.values(found).some(Boolean)) {
      setErrors({
        childName: found.childName ?? undefined,
        customTopic: found.customTopic ?? undefined,
        customLesson: found.customLesson ?? undefined,
        favoriteCharacter: found.favoriteCharacter ?? undefined,
      });
      return;
    }

    setErrors({});
    const finalTopic = customTopic.trim() || favoriteTopic;
    const finalLesson = customLesson.trim() || lesson;

    onSubmit({
      childName: trimmedName,
      childAge,
      favoriteTopic: finalTopic,
      gender,
      lesson: finalLesson,
      mood,
      favoriteCharacter: trimmedCharacter,
    });
  };

  return (
    <div className="max-w-2xl mx-auto py-4 md:py-6 animate-fadeIn space-y-6">
      {/* Top Navigation */}
      <button
        id="btn-form-back-home"
        onClick={onBack}
        className={`inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer ${
          isNightMode
            ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-300'
            : 'bg-amber-100/80 hover:bg-amber-200/60 text-amber-900'
        }`}
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Trở về trang chủ</span>
      </button>

      {/* Header */}
      <div className="space-y-1.5">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <span>Tạo câu chuyện cho bé</span>
          <Sparkles className="w-6 h-6 text-amber-400 animate-pulse" />
        </h2>
        <p className="text-xs sm:text-sm opacity-80">
          Chỉ cần điền vài thông tin nhỏ, chúng tôi sẽ dệt nên một câu chuyện ấm áp dành riêng cho bé tối nay.
        </p>
      </div>

      {/* Memory context badge */}
      {memoryLoading && (
        <div className="h-5 bg-gray-200 dark:bg-slate-700 rounded animate-pulse mb-4" />
      )}
      {!memoryLoading && memoryContext && (() => {
        const parts: string[] = [];
        if (memoryContext.interests.length > 0) {
          parts.push(`thích: ${memoryContext.interests.map(i => i.value).slice(0, 3).join(', ')}`);
        }
        if (memoryContext.recentThemes.length > 0) {
          const last = memoryContext.recentThemes[memoryContext.recentThemes.length - 1];
          parts.push(`lần trước: truyện về ${last.value}`);
        }
        if (parts.length === 0) return null;
        return (
          <div className={`text-xs p-2 rounded-lg mb-4 ${isNightMode ? 'bg-indigo-900/40 text-indigo-200' : 'bg-indigo-50 text-indigo-700'}`}>
            🧠 Bé {activeChild?.childName} {parts.join(' · ')}
          </div>
        );
      })()}

      {/* Form Container */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* SECTION 1: TRƯỜNG BẮT BUỘC */}
        <div
          className={`p-5 sm:p-6 rounded-3xl border space-y-5 transition-all ${
            isNightMode
              ? 'bg-slate-800/80 border-slate-700/80 text-slate-100 shadow-lg'
              : 'bg-white border-amber-200/80 text-amber-950 shadow-xs'
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-500">
            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
            <span>Thông tin bắt buộc</span>
          </div>

          {/* 1. Tên bé */}
          <div className="space-y-2">
            <label htmlFor="input-child-name" className="block text-sm font-bold flex items-center gap-1.5">
              <User className="w-4 h-4 text-indigo-500" />
              <span>Tên của bé <span className="text-rose-500">*</span></span>
            </label>
            <input
              id="input-child-name"
              type="text"
              maxLength={FIELD_LIMITS.childName}
              placeholder="Nhập tên bé (Ví dụ: Bé An, Bé Minh, Bơ...)"
              value={childName}
              onChange={(e) => {
                setChildName(e.target.value);
                if (errors.childName) setErrors({ ...errors, childName: undefined });
              }}
              className={`w-full px-4 py-3 rounded-2xl text-sm border focus:outline-none focus:ring-2 transition-all ${
                errors.childName
                  ? 'border-rose-500 focus:ring-rose-500/30'
                  : isNightMode
                  ? 'bg-slate-900 border-slate-700 text-slate-100 focus:ring-indigo-500/50'
                  : 'bg-amber-50/50 border-amber-200 text-amber-950 focus:ring-indigo-500/30'
              }`}
            />
            {errors.childName && (
              <p className="text-xs text-rose-500 font-medium pl-1">{errors.childName}</p>
            )}
            {activeChild && (
              <p className="text-xs text-indigo-500 font-medium">✨ Dùng cho bé {activeChild.childName}</p>
            )}
          </div>

          {/* 2. Tuổi bé */}
          <div className="space-y-2">
            <label className="block text-sm font-bold flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-amber-500" />
              <span>Tuổi của bé <span className="text-rose-500">*</span></span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {([3, 4, 5, 6] as AgeGroup[]).map((age) => (
                <button
                  type="button"
                  key={age}
                  id={`btn-age-${age}`}
                  onClick={() => setChildAge(age)}
                  className={`py-3 px-2 rounded-2xl text-xs sm:text-sm font-bold border transition-all cursor-pointer ${
                    childAge === age
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                      : isNightMode
                      ? 'bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-700'
                      : 'bg-amber-50/60 border-amber-200 text-amber-900 hover:bg-amber-100'
                  }`}
                >
                  {age} tuổi
                </button>
              ))}
            </div>
          </div>

          {/* 3. Chủ đề yêu thích */}
          <div className="space-y-2">
            <label className="block text-sm font-bold flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-emerald-500" />
              <span>Chủ đề bé thích <span className="text-rose-500">*</span></span>
            </label>
            <div className="flex flex-wrap gap-2">
              {TOPIC_SUGGESTIONS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  id={`btn-topic-${item.id}`}
                  onClick={() => {
                    setFavoriteTopic(item.name);
                    setCustomTopic('');
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                    favoriteTopic === item.name && !customTopic
                      ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                      : isNightMode
                      ? 'bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-700'
                      : 'bg-amber-50/60 border-amber-200 text-amber-900 hover:bg-amber-100'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.name}</span>
                </button>
              ))}
            </div>

            <div className="pt-1">
              <input
                id="input-custom-topic"
                type="text"
                maxLength={FIELD_LIMITS.theme}
                placeholder="Hoặc nhập chủ đề khác (ví dụ: Tàu hỏa, Xứ sở kẹo ngọt...)"
                value={customTopic}
                onChange={(e) => {
                  setCustomTopic(e.target.value);
                  if (errors.customTopic) setErrors({ ...errors, customTopic: undefined });
                }}
                className={`w-full px-4 py-2.5 rounded-xl text-xs border focus:outline-none focus:ring-2 transition-all ${
                  errors.customTopic
                    ? 'border-rose-500 focus:ring-rose-500/30'
                    : isNightMode
                    ? 'bg-slate-900 border-slate-700 text-slate-100 focus:ring-emerald-500/40'
                    : 'bg-amber-50/50 border-amber-200 text-amber-950 focus:ring-emerald-500/30'
                }`}
              />
              {errors.customTopic && (
                <p className="text-xs text-rose-500 font-medium pl-1 pt-1">{errors.customTopic}</p>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 2: TRƯỜNG TỦY CHỌN (COLLAPSIBLE / OPEN) */}
        <div
          className={`p-5 sm:p-6 rounded-3xl border space-y-5 transition-all ${
            isNightMode
              ? 'bg-slate-800/80 border-slate-700/80 text-slate-100 shadow-lg'
              : 'bg-white border-amber-200/80 text-amber-950 shadow-xs'
          }`}
        >
          <div
            onClick={() => setShowOptional(!showOptional)}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <span>Thông tin tùy chọn (Để câu chuyện thêm cá nhân hóa)</span>
            </div>
            <button
              type="button"
              className="p-1 rounded-lg text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/10"
            >
              {showOptional ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {showOptional && (
            <div className="space-y-5 pt-2 border-t border-dashed border-gray-200 dark:border-gray-700">
              {/* Giới tính */}
              <div className="space-y-2">
                <label className="block text-xs font-bold opacity-90">Giới tính của bé</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'unspecified', label: 'Chưa chọn' },
                    { value: 'boy', label: 'Bé trai 👦' },
                    { value: 'girl', label: 'Bé gái 👧' },
                  ].map((g) => (
                    <button
                      type="button"
                      key={g.value}
                      id={`btn-gender-${g.value}`}
                      onClick={() => setGender(g.value as GenderOption)}
                      className={`py-2 px-3 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                        gender === g.value
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : isNightMode
                          ? 'bg-slate-900/60 border-slate-700 text-slate-300'
                          : 'bg-amber-50/60 border-amber-200 text-amber-900'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Điều cha mẹ muốn dạy hôm nay */}
              <div className="space-y-2">
                <label className="block text-xs font-bold flex items-center gap-1.5 opacity-90">
                  <HeartHandshake className="w-4 h-4 text-indigo-400" />
                  <span>Điều cha mẹ muốn gửi gắm đêm nay</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {LESSON_SUGGESTIONS.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      id={`btn-lesson-${item.id}`}
                      onClick={() => {
                        setLesson(item.name);
                        setCustomLesson('');
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1 transition-all cursor-pointer ${
                        lesson === item.name && !customLesson
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : isNightMode
                          ? 'bg-slate-900/60 border-slate-700 text-slate-300'
                          : 'bg-amber-50/60 border-amber-200 text-amber-900'
                      }`}
                    >
                      <span>{item.icon}</span>
                      <span>{item.name}</span>
                    </button>
                  ))}
                </div>
                <input
                  id="input-custom-lesson"
                  type="text"
                  maxLength={FIELD_LIMITS.goal}
                  placeholder="Hoặc bài học riêng (Ví dụ: Tự cất đồ chơi, Rửa tay sạch...)"
                  value={customLesson}
                  onChange={(e) => {
                    setCustomLesson(e.target.value);
                    if (errors.customLesson) setErrors({ ...errors, customLesson: undefined });
                  }}
                  className={`w-full px-3.5 py-2 rounded-xl text-xs border focus:outline-none transition-all ${
                    errors.customLesson
                      ? 'border-rose-500'
                      : isNightMode
                      ? 'bg-slate-900 border-slate-700 text-slate-100'
                      : 'bg-amber-50/50 border-amber-200 text-amber-950'
                  }`}
                />
                {errors.customLesson && (
                  <p className="text-xs text-rose-500 font-medium pl-1">{errors.customLesson}</p>
                )}
              </div>

              {/* Tâm trạng của bé hôm nay */}
              <div className="space-y-2">
                <label className="block text-xs font-bold flex items-center gap-1.5 opacity-90">
                  <Smile className="w-4 h-4 text-amber-400" />
                  <span>Tâm trạng của bé hôm nay</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {MOOD_SUGGESTIONS.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      id={`btn-mood-${item.id}`}
                      onClick={() => setMood(item.name)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                        mood === item.name
                          ? 'bg-amber-500 border-amber-500 text-slate-950 font-bold'
                          : isNightMode
                          ? 'bg-slate-900/60 border-slate-700 text-slate-300'
                          : 'bg-amber-50/60 border-amber-200 text-amber-900'
                      }`}
                    >
                      <span>{item.icon}</span>
                      <span>{item.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Nhân vật bé thích */}
              <div className="space-y-2">
                <label htmlFor="input-favorite-character" className="block text-xs font-bold flex items-center gap-1.5 opacity-90">
                  <Cat className="w-4 h-4 text-rose-400" />
                  <span>Nhân vật bé thích</span>
                </label>
                <input
                  id="input-favorite-character"
                  type="text"
                  maxLength={FIELD_LIMITS.favoriteCharacter}
                  placeholder="Ví dụ: Chú gấu Pooh, Khủng long Rex, Thỏ Bông..."
                  value={favoriteCharacter}
                  onChange={(e) => {
                    setFavoriteCharacter(e.target.value);
                    if (errors.favoriteCharacter) {
                      setErrors({ ...errors, favoriteCharacter: undefined });
                    }
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs border focus:outline-none transition-all ${
                    errors.favoriteCharacter
                      ? 'border-rose-500'
                      : isNightMode
                      ? 'bg-slate-900 border-slate-700 text-slate-100'
                      : 'bg-amber-50/50 border-amber-200 text-amber-950'
                  }`}
                />
                {errors.favoriteCharacter && (
                  <p className="text-xs text-rose-500 font-medium pl-1">{errors.favoriteCharacter}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Submit Action */}
        <div className="pt-2">
          <button
            id="btn-form-submit-create-story"
            type="submit"
            className="w-full py-4 px-6 rounded-2xl text-base font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/40 transform hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Sparkles className="w-5 h-5 text-amber-300 fill-amber-300 animate-spin" style={{ animationDuration: '5s' }} />
            <span>Tạo câu chuyện</span>
          </button>
        </div>
      </form>
    </div>
  );
};
