import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminFeedbackScreen from '../AdminFeedbackScreen';
import { ADMIN_TOKEN_KEY } from '../adminSession';
import { ApiError } from '../../utils/api';
import type { AdminFeedbackItem, AdminFeedbackPage } from '../types';
import * as client from '../adminClient';

const b64url = (obj: unknown) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function liveToken(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'a1', username: 'thang', exp })}.sig`;
}

function item(id: string, over: Partial<AdminFeedbackItem> = {}): AdminFeedbackItem {
  return {
    feedback_id: id, created_at: '2026-08-06 14:22:01', rating: 5,
    listened_complete: 1, wants_more: 1, suitable: 1, note: 'hay',
    story_id: 's1', story_title: 'Chú thỏ ngủ quên', child_name: 'Bống', tenant_id: 't1',
    ...over,
  };
}

function page(items: AdminFeedbackItem[], total: number, offset = 0): AdminFeedbackPage {
  return { items, total, limit: 20, offset };
}

function renderScreen(initialEntry = '/admin/feedback') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin/feedback" element={<AdminFeedbackScreen />} />
        <Route path="/admin/login" element={<p>LOGIN SCREEN</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminFeedbackScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ADMIN_TOKEN_KEY, liveToken());
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows a loading state, then the rows', async () => {
    vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([item('f1')], 1));
    renderScreen();

    expect(screen.getByText(/đang tải/i)).toBeInTheDocument();
    expect(await screen.findByText('Chú thỏ ngủ quên')).toBeInTheDocument();
  });

  it('requests limit 20 at offset 0 by default', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([], 0));
    renderScreen();

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const params = spy.mock.calls[0][0];
    expect(params.get('limit')).toBe('20');
    expect(params.get('offset')).toBe('0');
  });

  it('shows an empty state rather than a blank page', async () => {
    vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([], 0));
    renderScreen();
    expect(await screen.findByText(/chưa có feedback nào khớp bộ lọc/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry that refetches', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks')
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR'))
      .mockResolvedValueOnce(page([item('f1')], 1));

    renderScreen();
    expect(await screen.findByRole('alert')).toHaveTextContent(/không kết nối được máy chủ/i);

    await userEvent.click(screen.getByRole('button', { name: /thử lại/i }));
    expect(await screen.findByText('Chú thỏ ngủ quên')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('redirects to login when the session has expired', async () => {
    vi.spyOn(client, 'fetchAdminFeedbacks').mockRejectedValue(new ApiError('UNAUTHORIZED', undefined, 401));
    renderScreen();
    expect(await screen.findByText('LOGIN SCREEN')).toBeInTheDocument();
  });

  it('reads filters out of the URL on first load', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([], 0));
    renderScreen('/admin/feedback?rating=5&has_note=1&from=2026-08-01&to=2026-08-02');

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const params = spy.mock.calls[0][0];
    expect(params.get('rating')).toBe('5');
    expect(params.get('has_note')).toBe('1');
    expect(params.get('from')).toBe('2026-08-01');
    expect(params.get('to')).toBe('2026-08-02');
  });

  it('refetches with the new filter and resets to the first page', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([item('f1')], 40, 20));
    renderScreen('/admin/feedback?offset=20');

    await screen.findByText('Chú thỏ ngủ quên');
    await userEvent.selectOptions(screen.getByLabelText(/đánh giá/i), '5');

    await waitFor(() => {
      const params = spy.mock.calls.at(-1)![0];
      expect(params.get('rating')).toBe('5');
      // Landing on page 2 of a narrower result set is how you get a blank page.
      expect(params.get('offset')).toBe('0');
    });
  });

  it('sends has_note=0 so the empty-note filter is exactly the set the BE defines', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([], 0));
    renderScreen('/admin/feedback?has_note=0');

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const params = spy.mock.calls[0][0];
    expect(params.get('has_note')).toBe('0');
  });

  it('omits empty filters from the request entirely', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([], 0));
    renderScreen();

    await waitFor(() => expect(spy).toHaveBeenCalled());
    const params = spy.mock.calls[0][0];
    expect(params.has('rating')).toBe(false);
    expect(params.has('has_note')).toBe(false);
    expect(params.has('from')).toBe(false);
  });

  it('shows the visible range and total', async () => {
    vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(
      page(Array.from({ length: 20 }, (_, i) => item(`f${i}`)), 137, 20),
    );
    renderScreen('/admin/feedback?offset=20');
    expect(await screen.findByText(/21–40 \/ 137/)).toBeInTheDocument();
  });

  it('pages forward and back, and disables the edges', async () => {
    const spy = vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(
      page(Array.from({ length: 20 }, (_, i) => item(`f${i}`)), 40, 0),
    );
    renderScreen();

    await screen.findByRole('button', { name: /sau/i });
    expect(screen.getByRole('button', { name: /trước/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /sau/i }));
    await waitFor(() => expect(spy.mock.calls.at(-1)![0].get('offset')).toBe('20'));
  });

  it('disables Sau on the last page', async () => {
    vi.spyOn(client, 'fetchAdminFeedbacks').mockResolvedValue(page([item('f1')], 21, 20));
    renderScreen('/admin/feedback?offset=20');
    await screen.findByText('Chú thỏ ngủ quên');
    expect(screen.getByRole('button', { name: /sau/i })).toBeDisabled();
  });
});
