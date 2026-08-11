import React, { useState } from 'react';
import { ArrowLeft, Sparkles, Save } from 'lucide-react';
import { AgeGroup, GenderOption, ChildProfile } from '../types';
import { childClient } from '../utils/childClient';
import { ApiError } from '../utils/api';

interface ProfileEditorProps {
  editChild?: ChildProfile | null;
  onSave: (child: ChildProfile) => void;
  onCancel: () => void;
  isNightMode: boolean;
}

const TOPIC_SUGGESTIONS = [
  { id: 'share', name: 'Chia sẻ', icon: '🤝' },
  { id: 'brave', name: 'Dũng cảm', icon: '🦁' },
  { id: 'honest', name: 'Trung thực', icon: '⭐' },
  { id: 'kind', name: 'Tốt bụng', icon: '💖' },
];

export const ProfileEditor: React.FC<ProfileEditorProps> = ({
  editChild, onSave, onCancel, isNightMode,
}) => {
  const isEdit = !!editChild;
  const [childName, setChildName] = useState(editChild?.childName || '');
  const [age, setAge] = useState<AgeGroup>(editChild?.age || 4);
  const [gender, setGender] = useState<GenderOption>((editChild?.gender as GenderOption) || 'unspecified');
  const [interests, setInterests] = useState(editChild?.interests || '');
  const [preferredCharacters, setPreferredCharacters] = useState(editChild?.preferredCharacters || '');
  const [bedtimeGoal, setBedtimeGoal] = useState(editChild?.bedtimeGoal || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!childName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        child_name: childName.trim(),
        age,
        gender: gender !== 'unspecified' ? gender : undefined,
        interests: interests.trim() || undefined,
        preferred_characters: preferredCharacters.trim() || undefined,
        bedtime_goal: bedtimeGoal.trim() || undefined,
      };
      if (isEdit && editChild) {
        // The response now carries every field, so there is nothing to patch
        // back in by hand -- doing so was how stale values got re-saved.
        onSave(await childClient.update(editChild.childId, payload));
      } else {
        onSave(await childClient.create(payload));
      }
    } catch (err) {
      // A silent failure here reads as a dead button. 409 is the only case a
      // parent can act on, so it gets its own words.
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Đã có bé tên này rồi. Ba mẹ chọn tên khác nhé!'
          : 'Lưu hồ sơ thất bại. Ba mẹ thử lại nhé!'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-4 animate-fadeIn space-y-5">
      <button onClick={onCancel} className={`inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer ${
        isNightMode ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-300' : 'bg-amber-100/80 hover:bg-amber-200/60 text-amber-900'
      }`}>
        <ArrowLeft className="w-4 h-4" />
        <span>Trở về</span>
      </button>

      <h2 className="text-2xl font-extrabold flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-amber-400" />
        <span>{isEdit ? 'Sửa hồ sơ' : 'Thêm hồ sơ mới'}</span>
      </h2>

      <form onSubmit={handleSubmit} className={`p-5 rounded-3xl border space-y-5 ${
        isNightMode ? 'bg-slate-800/80 border-slate-700/80' : 'bg-white border-amber-200/80'
      }`}>
        {/* Name */}
        <div className="space-y-1.5">
          <label htmlFor="input-profile-child-name" className="text-sm font-bold">Tên bé <span className="text-rose-500">*</span></label>
          <input id="input-profile-child-name" value={childName} onChange={e => { setChildName(e.target.value); setError(null); }}
            className={`w-full px-4 py-3 rounded-2xl text-sm border focus:outline-none focus:ring-2 ${
              error ? 'border-rose-500' : isNightMode ? 'bg-slate-900 border-slate-700' : 'bg-amber-50/50 border-amber-200'
            }`} />
          {error && <p className="text-xs text-rose-500 font-medium pl-1">{error}</p>}
        </div>

        {/* Age */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Tuổi</label>
          <div className="grid grid-cols-4 gap-2">
            {([3, 4, 5, 6] as AgeGroup[]).map(a => (
              <button type="button" key={a} onClick={() => setAge(a)}
                className={`py-3 rounded-2xl text-sm font-bold border transition-all cursor-pointer ${
                  age === a ? 'bg-indigo-600 border-indigo-600 text-white' : isNightMode
                    ? 'bg-slate-900/60 border-slate-700' : 'bg-amber-50/60 border-amber-200'
                }`}>{a} tuổi</button>
            ))}
          </div>
        </div>

        {/* Gender */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Giới tính</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'unspecified' as const, label: 'Chưa chọn' },
              { value: 'boy' as const, label: 'Bé trai 👦' },
              { value: 'girl' as const, label: 'Bé gái 👧' },
            ].map(g => (
              <button type="button" key={g.value} onClick={() => setGender(g.value)}
                className={`py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                  gender === g.value ? 'bg-indigo-600 border-indigo-600 text-white' : isNightMode
                    ? 'bg-slate-900/60 border-slate-700' : 'bg-amber-50/60 border-amber-200'
                }`}>{g.label}</button>
            ))}
          </div>
        </div>

        {/* Interests */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Sở thích</label>
          <input value={interests} onChange={e => setInterests(e.target.value)} placeholder="Thích khủng long, công chúa, tàu hỏa..."
            className={`w-full px-4 py-3 rounded-2xl text-sm border focus:outline-none ${
              isNightMode ? 'bg-slate-900 border-slate-700' : 'bg-amber-50/50 border-amber-200'
            }`} />
        </div>

        {/* Preferred Characters */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Nhân vật yêu thích</label>
          <input value={preferredCharacters} onChange={e => setPreferredCharacters(e.target.value)} placeholder="Gấu Pooh, Thỏ Bông..."
            className={`w-full px-4 py-3 rounded-2xl text-sm border focus:outline-none ${
              isNightMode ? 'bg-slate-900 border-slate-700' : 'bg-amber-50/50 border-amber-200'
            }`} />
        </div>

        {/* Bedtime goal */}
        <div className="space-y-1.5">
          <label className="text-sm font-bold">Bài học muốn gửi gắm</label>
          <div className="flex flex-wrap gap-2">
            {TOPIC_SUGGESTIONS.map(item => (
              <button type="button" key={item.id} onClick={() => setBedtimeGoal(item.name)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                  bedtimeGoal === item.name ? 'bg-indigo-600 border-indigo-600 text-white' : isNightMode
                    ? 'bg-slate-900/60 border-slate-700' : 'bg-amber-50/60 border-amber-200'
                }`}>
                <span>{item.icon} {item.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button type="submit" disabled={saving || !childName.trim()}
          className="w-full py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer">
          <Save className="w-4 h-4" />
          <span>{saving ? 'Đang lưu...' : isEdit ? 'Cập nhật' : 'Thêm bé'}</span>
        </button>
      </form>
    </div>
  );
};