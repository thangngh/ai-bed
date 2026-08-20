import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearToken } from './adminSession';

const TABS = [
  { to: '/admin/feedback', label: 'Feedback' },
  { to: '/admin/ip', label: 'IP' },
];

/**
 * The page chrome every authenticated admin screen shares. Screens render only
 * their own content: the wrapper, the <main> and its spacing live here, so a
 * new screen cannot drift from the others by forgetting them.
 */
export default function AdminLayout() {
  const navigate = useNavigate();

  function logout() {
    clearToken();
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <nav className="flex gap-1">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  `rounded px-3 py-1 text-sm ${
                    isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-200'
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            onClick={logout}
            className="rounded border border-slate-300 px-3 py-1 text-sm"
          >
            Đăng xuất
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <Outlet />
      </main>
    </div>
  );
}
