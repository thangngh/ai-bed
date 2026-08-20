import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLayout from '../AdminLayout';
import { ADMIN_TOKEN_KEY } from '../adminSession';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function renderLayout(entry = '/admin/feedback') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route element={<AdminLayout />}>
          <Route path="/admin/feedback" element={<p>FEEDBACK BODY</p>} />
        </Route>
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
  });

  it('renders the nested route inside the shared chrome', () => {
    renderLayout();
    expect(screen.getByText('FEEDBACK BODY')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Feedback' })).toBeInTheDocument();
  });

  it('marks the current tab as the active page', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: 'Feedback' })).toHaveAttribute('aria-current', 'page');
  });

  it('logs out: clears the token and goes to the login screen', async () => {
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: 'Đăng xuất' }));
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
    expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument();
  });
});
