import React, { useState } from 'react';
import { ArrowLeft, Pencil, Trash2, Sparkles, Plus, UserPlus } from 'lucide-react';
import { ChildProfile } from '../types';
import { childClient } from '../utils/childClient';
import { getAvatarColor, getInitial } from '../utils/avatar';
import { ProfileEditor } from './ProfileEditor';

interface ProfileManagerProps {
  children: ChildProfile[];
  activeChild: ChildProfile | null;
  onSelectChild: (child: ChildProfile | null) => void;
  onUpdate: (children: ChildProfile[]) => void;
  onBack: () => void;
  isNightMode: boolean;
  /** Open straight into the editor for this child. App remounts on change. */
  initialEditChild?: ChildProfile | null;
  /**
   * Fired when the editor closes (save or cancel), so App can drop the edit
   * target it handed us via `initialEditChild`. Without this, App keeps
   * pointing at a child whose editor is long gone, and the next unrelated
   * visit to this screen reopens that editor instead of the list.
   */
  onEditorClose?: () => void;
}

export const ProfileManager: React.FC<ProfileManagerProps> = ({
  children, activeChild, onSelectChild, onUpdate, onBack, isNightMode, initialEditChild, onEditorClose,
}) => {
  const [editingChild, setEditingChild] = useState<ChildProfile | null | 'new'>(initialEditChild ?? null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleEdit = (child: ChildProfile) => setEditingChild(child);
  const handleAddNew = () => setEditingChild('new');

  const handleSave = (saved: ChildProfile) => {
    if (editingChild === 'new') {
      onUpdate([...children, saved]);
      // Nothing else would set an active child, and without one the story
      // form has nobody to write for.
      if (children.length === 0) onSelectChild(saved);
    } else {
      onUpdate(children.map(c => c.childId === saved.childId ? { ...c, ...saved } : c));
    }
    setEditingChild(null);
    onEditorClose?.();
  };

  const handleDelete = async (child: ChildProfile) => {
    if (!confirm(`Xóa hồ sơ của bé ${child.childName}?`)) return;
    setDeleting(child.childId);
    try {
      await childClient.delete(child.childId);
      const updated = children.filter(c => c.childId !== child.childId);
      onUpdate(updated);
      if (activeChild?.childId === child.childId) onSelectChild(null);
    } catch {
      alert('Xóa thất bại. Vui lòng thử lại.');
    } finally {
      setDeleting(null);
    }
  };

  if (editingChild) {
    return (
      <ProfileEditor
        editChild={editingChild === 'new' ? null : editingChild}
        onSave={handleSave}
        onCancel={() => { setEditingChild(null); onEditorClose?.(); }}
        isNightMode={isNightMode}
      />
    );
  }

  return (
    <div className="max-w-lg mx-auto py-4 animate-fadeIn space-y-5">
      <button onClick={onBack} className={`inline-flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors cursor-pointer ${
        isNightMode ? 'bg-slate-800/80 hover:bg-slate-700 text-slate-300' : 'bg-amber-100/80 hover:bg-amber-200/60 text-amber-900'
      }`}>
        <ArrowLeft className="w-4 h-4" /><span>Trở về</span>
      </button>

      <h2 className="text-2xl font-extrabold flex items-center gap-2">
        <Sparkles className="w-6 h-6 text-amber-400" />
        <span>Trang các bé</span>
      </h2>

      <div className="space-y-3">
        {children.length === 0 && (
          <div className="text-center py-10 opacity-70">
            <UserPlus className="w-12 h-12 mx-auto mb-3" />
            <p className="font-semibold">Chưa có hồ sơ bé nào</p>
            <p className="text-xs mt-1 mb-4">Thêm hồ sơ đầu tiên để bắt đầu!</p>
            <button
              id="btn-profile-add-first"
              onClick={handleAddNew}
              className="px-5 py-3 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 inline-flex items-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" /><span>Thêm hồ sơ bé</span>
            </button>
          </div>
        )}
        {children.map(child => {
          const color = getAvatarColor(child.childId);
          const isActive = activeChild?.childId === child.childId;
          return (
            <div key={child.childId} className={`p-4 rounded-2xl border flex items-center gap-3 ${
              isNightMode ? 'bg-slate-800/80 border-slate-700' : 'bg-white border-amber-200'
            }`}>
              <div className={`w-12 h-12 rounded-full ${color.bg} ${color.text} flex items-center justify-center font-bold text-xl shrink-0`}>
                {getInitial(child.childName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold flex items-center gap-2">
                  <span>{child.childName}</span>
                  {isActive && <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-600 text-white">ĐANG DÙNG</span>}
                </div>
                <p className="text-xs opacity-70">{child.age} tuổi</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleEdit(child)} disabled={deleting === child.childId}
                  className="p-2 rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50">
                  <Pencil className="w-4 h-4 opacity-60" />
                </button>
                <button onClick={() => handleDelete(child)} disabled={deleting === child.childId}
                  className="p-2 rounded-xl hover:bg-rose-500/10 text-rose-500 transition-colors cursor-pointer disabled:opacity-50">
                  {deleting === child.childId ? <span className="text-xs">...</span> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button id="btn-profile-add" onClick={handleAddNew} className={`w-full py-3.5 rounded-2xl text-sm font-bold border-2 border-dashed flex items-center justify-center gap-2 transition-colors cursor-pointer ${
        isNightMode ? 'border-slate-600 text-slate-300 hover:border-indigo-500' : 'border-amber-300 text-amber-800 hover:border-indigo-400'
      }`}>
        <Plus className="w-4 h-4" /><span>Thêm hồ sơ mới</span>
      </button>
    </div>
  );
};