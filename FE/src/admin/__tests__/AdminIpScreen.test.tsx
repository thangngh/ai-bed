import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminIpScreen from '../AdminIpScreen';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import * as api from '../dashboardClient';
import type { IpRule } from '../dashboardTypes';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function rule(over: Partial<IpRule> = {}): IpRule {
  return {
    id: 1, type: 'ip', pattern: '10.0.0.9', action: 'deny', tier: 'default',
    note: null, createdBy: 'admin', createdAt: '2026-08-14T10:30:00', enabled: true,
    ...over,
  };
}

function renderScreen(entry = '/admin/ip') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/admin/ip" element={<AdminIpScreen />} />
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminIpScreen — rules', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
    vi.spyOn(api, 'fetchIpRules').mockResolvedValue([rule()]);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lists the rules', async () => {
    renderScreen();
    expect(await screen.findByText('10.0.0.9')).toBeInTheDocument();
  });

  it('toggling enabled patches the rule and refetches the list', async () => {
    const update = vi.spyOn(api, 'updateIpRule').mockResolvedValue(rule({ enabled: false }));
    renderScreen();
    await screen.findByText('10.0.0.9');

    await userEvent.click(screen.getByRole('checkbox', { name: /bật rule 10\.0\.0\.9/i }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(1, { enabled: false }));
    expect(api.fetchIpRules).toHaveBeenCalledTimes(2);
  });

  it('creates a rule from the form and refetches', async () => {
    const create = vi.spyOn(api, 'createIpRule').mockResolvedValue(rule({ id: 2, pattern: '10.0.0.10' }));
    renderScreen();
    await screen.findByText('10.0.0.9');

    await userEvent.type(screen.getByLabelText('Pattern'), '10.0.0.10');
    await userEvent.click(screen.getByRole('button', { name: 'Tạo rule' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        type: 'ip', pattern: '10.0.0.10', action: 'deny', tier: 'default', note: null,
      }),
    );
    expect(api.fetchIpRules).toHaveBeenCalledTimes(2);
  });

  it('refuses to submit an empty pattern without calling the API', async () => {
    const create = vi.spyOn(api, 'createIpRule');
    renderScreen();
    await screen.findByText('10.0.0.9');

    await userEvent.click(screen.getByRole('button', { name: 'Tạo rule' }));

    expect(await screen.findByText('Pattern không được để trống')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('deleting asks first, and cancelling calls nothing', async () => {
    const del = vi.spyOn(api, 'deleteIpRule');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderScreen();
    await screen.findByText('10.0.0.9');

    await userEvent.click(screen.getByRole('button', { name: /xoá rule 10\.0\.0\.9/i }));

    expect(confirm).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('deleting proceeds when confirmed', async () => {
    const del = vi.spyOn(api, 'deleteIpRule').mockResolvedValue({ deleted: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderScreen();
    await screen.findByText('10.0.0.9');

    await userEvent.click(screen.getByRole('button', { name: /xoá rule 10\.0\.0\.9/i }));

    await waitFor(() => expect(del).toHaveBeenCalledWith(1));
    expect(api.fetchIpRules).toHaveBeenCalledTimes(2);
  });

  it('apply confirms with the number of enabled rules', async () => {
    vi.spyOn(api, 'fetchIpRules').mockResolvedValue([rule(), rule({ id: 2, enabled: false })]);
    const apply = vi.spyOn(api, 'applyIpRules').mockResolvedValue({ matched: 3, alerts_created: 1 });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderScreen();
    await screen.findByRole('button', { name: 'Áp dụng rule' });

    await userEvent.click(screen.getByRole('button', { name: 'Áp dụng rule' }));

    expect(String(confirm.mock.calls[0][0])).toContain('1');
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(await screen.findByText(/matched: 3/i)).toBeInTheDocument();
  });

  it('shows the BE message when a write fails', async () => {
    const { ApiError } = await import('../../utils/api');
    vi.spyOn(api, 'applyIpRules').mockRejectedValue(new ApiError('API_ERROR', 'Apply failed', 500));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderScreen();
    await screen.findByRole('button', { name: 'Áp dụng rule' });

    await userEvent.click(screen.getByRole('button', { name: 'Áp dụng rule' }));

    expect(await screen.findByText('Apply failed')).toBeInTheDocument();
  });
});
