import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLoginScreen from '../AdminLoginScreen';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import { ApiError } from '../../utils/api';
import * as client from '../adminClient';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/admin/login']}>
      <Routes>
        <Route path="/admin/login" element={<AdminLoginScreen />} />
        <Route path="/admin/feedback" element={<p>FEEDBACK SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLoginScreen', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('stores the token and navigates on success', async () => {
    vi.spyOn(client, 'adminLogin').mockResolvedValue({
      token: 'tok-123', expires_at: 'x', admin: { admin_id: 'a1', username: 'thang' },
    });

    renderLogin();
    await userEvent.type(screen.getByLabelText(/tài khoản/i), 'thang');
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), 'my-password');
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    await waitFor(() => expect(screen.getByText('FEEDBACK SCREEN')).toBeInTheDocument());
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBe('tok-123');
  });

  it('shows the Vietnamese message for INVALID_CREDENTIALS', async () => {
    vi.spyOn(client, 'adminLogin').mockRejectedValue(new ApiError('INVALID_CREDENTIALS', undefined, 401));

    renderLogin();
    await userEvent.type(screen.getByLabelText(/tài khoản/i), 'thang');
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sai tài khoản hoặc mật khẩu');
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('shows a throttle message', async () => {
    vi.spyOn(client, 'adminLogin').mockRejectedValue(new ApiError('LOGIN_THROTTLED', undefined, 429));

    renderLogin();
    await userEvent.type(screen.getByLabelText(/tài khoản/i), 'thang');
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sai quá nhiều lần/i);
  });

  it('shows a connection message for a network failure', async () => {
    vi.spyOn(client, 'adminLogin').mockRejectedValue(new ApiError('NETWORK_ERROR'));

    renderLogin();
    await userEvent.type(screen.getByLabelText(/tài khoản/i), 'thang');
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/không kết nối được máy chủ/i);
  });

  it('disables the button while the request is in flight', async () => {
    let release!: () => void;
    vi.spyOn(client, 'adminLogin').mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ token: 't', expires_at: 'x', admin: { admin_id: 'a1', username: 'thang' } });
      }),
    );

    renderLogin();
    await userEvent.type(screen.getByLabelText(/tài khoản/i), 'thang');
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /đăng nhập/i }));

    expect(screen.getByRole('button', { name: /đang đăng nhập/i })).toBeDisabled();
    release();
  });

  it('marks the password field as a current-password for password managers', () => {
    renderLogin();
    expect(screen.getByLabelText(/tài khoản/i)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/mật khẩu/i)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByLabelText(/mật khẩu/i)).toHaveAttribute('type', 'password');
  });
});
