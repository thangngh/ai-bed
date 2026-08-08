import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RequireAdmin from '../RequireAdmin';
import { ADMIN_TOKEN_KEY } from '../adminSession';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/admin/feedback']}>
      <Routes>
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
        <Route path="/admin/feedback" element={<RequireAdmin><p>SECRET</p></RequireAdmin>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireAdmin', () => {
  beforeEach(() => { localStorage.clear(); });

  it('redirects to login when there is no token', () => {
    renderGuarded();
    expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument();
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
  });

  it('redirects to login when the token has expired', () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    localStorage.setItem(ADMIN_TOKEN_KEY, `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a', username: 'b', exp })}.sig`);
    renderGuarded();
    expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument();
  });

  it('renders the children when the token is live', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(ADMIN_TOKEN_KEY, `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a', username: 'b', exp })}.sig`);
    renderGuarded();
    expect(screen.getByText('SECRET')).toBeInTheDocument();
  });
});
