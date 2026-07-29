import React from 'react';
import { X, UserPlus, Check, Pencil } from 'lucide-react';
import { ChildProfile } from '../types';
import { getAvatarColor, getInitial } from '../utils/avatar';

interface ChildSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  children: ChildProfile[];
  activeChild: ChildProfile | null;
  onSelect: (child: ChildProfile) => void;
  onAddNew: () => void;
  onEdit: (child: ChildProfile) => void;
  isNightMode: boolean;
}

export const ChildSelector: React.FC<ChildSelectorProps> = ({
  isOpen, onClose, children, activeChild, onSelect, onAddNew, onEdit, isNightMode,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className={`w-full max-w-sm rounded-3xl border shadow-2xl overflow-hidden ${
        isNightMode ? 'bg-slate-900 border-slate-700 text-slate-100' : 'bg-white border-amber-200 text-amber-950'
      }`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <h2 className="font-extrabold text-lg flex items-center gap-2">
            <span>👶</span>
            <span>Chọn bé</span>
          </h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Child list */}
        <div className="p-4 space-y-2">
          {children.length === 0 ? (
            <p className="text-center py-6 text-sm opacity-70">Chưa có hồ sơ bé nào</p>
          ) : children.map((child) => {
            const color = getAvatarColor(child.childId);
            const isActive = activeChild?.childId === child.childId;
            return (
              <div
                key={child.childId}
                onClick={() => { onSelect(child); onClose(); }}
                className={`p-3 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all ${
                  isActive
                    ? isNightMode
                      ? 'bg-indigo-900/40 border-indigo-600/50'
                      : 'bg-indigo-50 border-indigo-300'
                    : isNightMode
                      ? 'bg-slate-800/60 border-slate-700 hover:bg-slate-700'
                      : 'bg-amber-50/60 border-amber-200 hover:bg-amber-100'
                }`}
              >
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full ${color.bg} ${color.text} flex items-center justify-center font-bold text-lg shrink-0`}>
                  {getInitial(child.childName)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm flex items-center gap-2">
                    <span>{child.childName}</span>
                    {isActive && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-600 text-white font-semibold">ĐANG DÙNG</span>
                    )}
                  </div>
                  <p className="text-xs opacity-70">{child.age} tuổi</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                  {isActive && <Check className="w-4 h-4 text-indigo-500" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(child); }}
                    className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5 opacity-60" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add new */}
        <div className="px-4 pb-4">
          <button
            onClick={() => { onAddNew(); }}
            className={`w-full py-3 rounded-2xl text-sm font-bold border-2 border-dashed flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              isNightMode
                ? 'border-slate-600 text-slate-300 hover:border-indigo-500 hover:text-indigo-400'
                : 'border-amber-300 text-amber-800 hover:border-indigo-400 hover:text-indigo-600'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            <span>Thêm hồ sơ mới</span>
          </button>
        </div>
      </div>
    </div>
  );
};