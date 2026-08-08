import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminLogin } from './adminClient';
import { setToken } from './adminSession';
import { ApiError } from '../utils/api';

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Sai tài khoản hoặc mật khẩu',
  LOGIN_THROTTLED: 'Sai quá nhiều lần. Vui lòng thử lại sau ít phút.',
  NETWORK_ERROR: 'Không kết nối được máy chủ',
  TIMEOUT: 'Không kết nối được máy chủ',
  VALIDATION_ERROR: 'Vui lòng nhập đủ tài khoản và mật khẩu',
};

function messageFor(err: unknown): string {
  const code = err instanceof ApiError ? err.code : '';
  return MESSAGES[code] ?? 'Đăng nhập không thành công. Vui lòng thử lại.';
}

export default function AdminLoginScreen() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await adminLogin(username, password);
      setToken(result.token);
      navigate('/admin/feedback', { replace: true });
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-lg shadow p-6 space-y-4"
      >
        <h1 className="text-lg font-semibold">Đăng nhập quản trị</h1>

        <div className="space-y-1">
          <label htmlFor="admin-username" className="block text-sm">Tài khoản</label>
          <input
            id="admin-username"
            name="username"
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="admin-password" className="block text-sm">Mật khẩu</label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded bg-slate-900 text-white py-2 disabled:opacity-50"
        >
          {pending ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
