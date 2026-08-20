import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../../utils/api';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import { useAdminAction, useAdminResource } from '../useAdminResource';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function Harness({
  fetcher, pollMs, initialKey = 'k1',
}: { fetcher: () => Promise<string>; pollMs?: number; initialKey?: string }) {
  const [key, setKey] = useState(initialKey);
  const { data, loading, error, reload } = useAdminResource(key, fetcher, { pollMs });
  return (
    <div>
      <p data-testid="state">{loading ? 'LOADING' : 'IDLE'}</p>
      <p data-testid="data">{data ?? 'NONE'}</p>
      <p data-testid="error">{error ?? 'NOERROR'}</p>
      <button type="button" onClick={reload}>reload</button>
      <button type="button" onClick={() => setKey('k2')}>changeKey</button>
    </div>
  );
}

function renderHarness(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/admin/x']}>
      <Routes>
        <Route path="/admin/x" element={ui} />
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useAdminResource', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('loads, then exposes the data', async () => {
    renderHarness(<Harness fetcher={vi.fn().mockResolvedValue('first')} />);
    expect(screen.getByTestId('state')).toHaveTextContent('LOADING');
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));
    expect(screen.getByTestId('state')).toHaveTextContent('IDLE');
  });

  it('refetches when the key changes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    renderHarness(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));
    await userEvent.click(screen.getByText('changeKey'));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('second'));
  });

  it('refetches when reload is called', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second');
    renderHarness(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('first'));
    await userEvent.click(screen.getByText('reload'));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('second'));
  });

  it('shows the BE detail for an unmapped error code', async () => {
    // ApiError keeps `message` equal to the bare code on purpose, so `detail`
    // is the only place the human-readable text lives.
    const fetcher = vi.fn().mockRejectedValue(new ApiError('API_ERROR', 'Log path is outside', 400));
    renderHarness(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Log path is outside'));
  });

  it('redirects to login on a 401', async () => {
    const fetcher = vi.fn().mockRejectedValue(new ApiError('UNAUTHORIZED', 'gone', 401));
    renderHarness(<Harness fetcher={fetcher} />);
    await waitFor(() => expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument());
    expect(localStorage.getItem(ADMIN_TOKEN_KEY)).toBeNull();
  });

  it('discards a response that lost its race with a newer key', async () => {
    let releaseFirst: (v: string) => void = () => {};
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((res) => { releaseFirst = res; }))
      .mockResolvedValueOnce('second');

    renderHarness(<Harness fetcher={fetcher} />);
    await userEvent.click(screen.getByText('changeKey'));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('second'));

    // The stale first request now answers. It must not win.
    await act(async () => { releaseFirst('first'); });
    expect(screen.getByTestId('data')).toHaveTextContent('second');
  });

  it('polls without flipping loading, and keeps the old data when a poll fails', async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', undefined))
      .mockResolvedValue('third');

    renderHarness(<Harness fetcher={fetcher} pollMs={30_000} />);
    await act(async () => {});
    expect(screen.getByTestId('data')).toHaveTextContent('first');

    // Poll 1 fails: the banner appears but the table keeps its rows, and the
    // screen must not blink back to its skeleton.
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId('state')).toHaveTextContent('IDLE');
    expect(screen.getByTestId('data')).toHaveTextContent('first');
    expect(screen.getByTestId('error')).toHaveTextContent('Không kết nối được máy chủ.');

    // Poll 2 succeeds and clears the banner.
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByTestId('data')).toHaveTextContent('third');
    expect(screen.getByTestId('error')).toHaveTextContent('NOERROR');
  });
});

function ActionHarness({ fn }: { fn: () => Promise<unknown> }) {
  const { busy, actionError, run } = useAdminAction();
  return (
    <div>
      <p data-testid="busy">{busy ? 'BUSY' : 'FREE'}</p>
      <p data-testid="action-error">{actionError ?? 'NOERROR'}</p>
      <button type="button" onClick={() => void run(fn)}>go</button>
    </div>
  );
}

describe('useAdminAction', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
  });

  it('surfaces the BE detail of a failed write', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError('API_ERROR', 'IP rule not found', 404));
    renderHarness(<ActionHarness fn={fn} />);
    await userEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByTestId('action-error')).toHaveTextContent('IP rule not found'));
    expect(screen.getByTestId('busy')).toHaveTextContent('FREE');
  });

  it('redirects to login when a write comes back 401', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError('UNAUTHORIZED', 'gone', 401));
    renderHarness(<ActionHarness fn={fn} />);
    await userEvent.click(screen.getByText('go'));
    await waitFor(() => expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument());
  });
});
