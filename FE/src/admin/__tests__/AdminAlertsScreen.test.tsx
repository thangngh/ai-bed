import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminAlertsScreen from '../AdminAlertsScreen';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import * as api from '../dashboardClient';
import type { Alert, Paged } from '../dashboardTypes';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 1, type: 'ddos_permanent', severity: 'critical', ip: '10.0.0.9', provider: null,
    detailJson: '{"score":120}', resolved: false,
    createdAt: '2026-08-14T10:30:00', resolvedAt: null,
    ...over,
  };
}

function page(items: Alert[], total = items.length): Paged<Alert> {
  return { items, total, limit: 50, offset: 0 };
}

function renderScreen(entry = '/admin/alerts') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/alerts" element={<AdminAlertsScreen />} />
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const paramsOfCall = (n: number) =>
  (api.fetchAlerts as unknown as ReturnType<typeof vi.fn>).mock.calls[n][0] as URLSearchParams;

describe('AdminAlertsScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    vi.spyOn(api, 'fetchAlerts').mockResolvedValue(page([alert()]));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('defaults to the unresolved alerts', async () => {
    renderScreen();
    await waitFor(() => expect(paramsOfCall(0).get('resolved')).toBe('false'));
  });

  it('drops the resolved key entirely when the filter is "all"', async () => {
    renderScreen('/admin/alerts?resolved=');
    await waitFor(() => expect(paramsOfCall(0).has('resolved')).toBe(false));
  });

  it('renders the severity as a badge', async () => {
    renderScreen();
    expect(await screen.findByText('critical')).toBeInTheDocument();
  });

  it('renders an em dash for a null provider', async () => {
    renderScreen();
    await screen.findByText('critical');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the parsed detail when the row is expanded', async () => {
    renderScreen();
    await screen.findByText('critical');
    await userEvent.click(screen.getByRole('button', { name: /chi tiết alert 1/i }));
    expect(await screen.findByText(/"score": 120/)).toBeInTheDocument();
  });

  it('falls back to the raw string when detailJson is not valid JSON', async () => {
    vi.spyOn(api, 'fetchAlerts').mockResolvedValue(page([alert({ detailJson: 'not json{' })]));
    renderScreen();
    await screen.findByText('critical');
    await userEvent.click(screen.getByRole('button', { name: /chi tiết alert 1/i }));
    expect(await screen.findByText('not json{')).toBeInTheDocument();
  });

  it('resolving refetches the list', async () => {
    const resolve = vi.spyOn(api, 'resolveAlert').mockResolvedValue(alert({ resolved: true }));
    renderScreen();
    await screen.findByText('critical');

    await userEvent.click(screen.getByRole('button', { name: /đã xử lý alert 1/i }));

    await waitFor(() => expect(resolve).toHaveBeenCalledWith(1));
    expect(api.fetchAlerts).toHaveBeenCalledTimes(2);
  });

  it('hides the resolve button on an already-resolved row', async () => {
    vi.spyOn(api, 'fetchAlerts').mockResolvedValue(
      page([alert({ resolved: true, resolvedAt: '2026-08-14T11:00:00' })]),
    );
    renderScreen('/admin/alerts?resolved=true');
    await screen.findByText('critical');
    expect(screen.queryByRole('button', { name: /đã xử lý alert 1/i })).not.toBeInTheDocument();
  });

  it('polls every 30 seconds while auto-refresh is on', async () => {
    vi.useFakeTimers();
    renderScreen();
    await act(async () => {});
    expect(api.fetchAlerts).toHaveBeenCalledTimes(1);

    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(api.fetchAlerts).toHaveBeenCalledTimes(2);
  });

  it('stops polling when auto-refresh is turned off', async () => {
    // userEvent's click deadlocks against vi fake timers in this environment
    // even with `advanceTimers` configured (a known testing-library/user-event
    // issue on jsdom+Windows). fireEvent dispatches the DOM event synchronously
    // with no internal timers, so it sidesteps the deadlock while still
    // exercising the exact same onChange handler userEvent would trigger.
    vi.useFakeTimers();
    renderScreen();
    await act(async () => {});

    fireEvent.click(screen.getByRole('checkbox', { name: 'Tự động làm mới' }));
    const callsBefore = (api.fetchAlerts as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    await act(async () => { vi.advanceTimersByTime(90_000); });
    expect(api.fetchAlerts).toHaveBeenCalledTimes(callsBefore);
  });
});
