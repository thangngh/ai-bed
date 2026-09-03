import React, { useSyncExternalStore } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { beginGoogleLogin, isSignedIn, signOut, subscribe } from '../utils/authSession';

interface AccountButtonProps {
  isNightMode: boolean;
}

/**
 * Self-contained on purpose: it reads the session straight from the module
 * store, so adding sign-in did not have to thread another prop through Header
 * and App.
 */
export const AccountButton: React.FC<AccountButtonProps> = ({ isNightMode }) => {
  const signedIn = useSyncExternalStore(subscribe, isSignedIn, () => false);

  const className = `p-2 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all ${
    isNightMode
      ? 'bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200'
      : 'bg-amber-100/80 hover:bg-amber-200/60 border border-amber-200 text-amber-900'
  }`;

  if (signedIn) {
    return (
      <button
        id="btn-header-sign-out"
        onClick={() => {
          void signOut();
        }}
        className={className}
        title="Đăng xuất"
      >
        <LogOut className="w-4 h-4 text-slate-400" />
        <span className="hidden md:inline">Đăng xuất</span>
      </button>
    );
  }

  return (
    <button
      id="btn-header-sign-in"
      onClick={beginGoogleLogin}
      className={className}
      title="Đăng nhập bằng Google để đồng bộ hồ sơ của bé"
    >
      <LogIn className="w-4 h-4 text-sky-500" />
      <span className="hidden md:inline">Đăng nhập</span>
    </button>
  );
};
