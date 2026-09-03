import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AuthCallbackScreen from '../AuthCallbackScreen';
import { __resetAuthSessionForTests, getAccessToken, isSignedIn } from '../../utils/authSession';

/**
 * The component reads the fragment off `window.location`, not off the router:
 * the fragment is what the BE redirect actually put in the address bar, and
 * MemoryRouter never touches it.
 */
function renderCallback(options: { hash?: string; query?: string; strict?: boolean } = {}) {
  window.location.hash = options.hash ?? '';
  const tree = (
    <MemoryRouter initialEntries={[`/auth/callback${options.query ?? ''}`]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackScreen />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>
  );
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe('AuthCallbackScreen', () => {
  beforeEach(() => {
    __resetAuthSessionForTests();
    localStorage.clear();
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('moves the token out of the fragment and sends the parent home', async () => {
    renderCallback({ hash: '#access_token=token-1&tenant_id=tenant-1' });

    expect(getAccessToken()).toBe('token-1');
    expect(localStorage.getItem('bsc_tenant_id')).toBe('tenant-1');
    expect(await screen.findByText('home')).toBeTruthy();
  });

  it('keeps the session under StrictMode double rendering', () => {
    // The token is read during render, so React invoking the effect twice must
    // not be able to observe an already-spent fragment and undo the login.
    renderCallback({ hash: '#access_token=token-1', strict: true });

    expect(isSignedIn()).toBe(true);
  });

  it('explains a cancelled login instead of redirecting', () => {
    renderCallback({ query: '?error=oauth_denied' });

    expect(screen.getByText('Bạn đã huỷ đăng nhập bằng Google.')).toBeTruthy();
    expect(screen.queryByText('home')).toBeNull();
    expect(isSignedIn()).toBe(false);
  });

  it('falls back to the generic message for an unknown error code', () => {
    renderCallback({ query: '?error=something_else' });

    expect(screen.getByText('Đăng nhập bằng Google thất bại, vui lòng thử lại.')).toBeTruthy();
  });

  it('ignores a token smuggled in alongside an error', () => {
    // A failed callback must not leave a usable session behind.
    renderCallback({ query: '?error=oauth_failed', hash: '#access_token=token-1' });

    expect(isSignedIn()).toBe(false);
  });
});
