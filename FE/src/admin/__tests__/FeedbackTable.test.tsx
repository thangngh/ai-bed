import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import FeedbackTable from '../FeedbackTable';
import type { AdminFeedbackItem } from '../types';

const base: AdminFeedbackItem = {
  feedback_id: 'f1',
  created_at: '2026-08-06 14:22:01',
  rating: 5,
  listened_complete: 1,
  wants_more: 1,
  suitable: 1,
  note: 'bé đòi nghe lại 2 lần',
  story_id: 's1',
  story_title: 'Chú thỏ ngủ quên',
  child_name: 'Bống',
  tenant_id: 't1',
};

describe('FeedbackTable', () => {
  it('renders one row per item', () => {
    render(<FeedbackTable items={[base, { ...base, feedback_id: 'f2' }]} />);
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2
  });

  it('shows an em dash rather than the word null for missing story or child', () => {
    render(<FeedbackTable items={[{ ...base, story_title: null, child_name: null }]} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(row.textContent).not.toContain('null');
  });

  it('shows an em dash for a missing note and rating', () => {
    render(<FeedbackTable items={[{ ...base, note: null, rating: null }]} />);
    const row = screen.getAllByRole('row')[1];
    expect(row.textContent).not.toContain('null');
  });

  it('renders the boolean-ish columns as readable Vietnamese', () => {
    render(<FeedbackTable items={[{ ...base, listened_complete: 1, wants_more: 0 }]} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('Có')).toBeInTheDocument();
    expect(within(row).getByText('Không')).toBeInTheDocument();
  });

  it('renders the timestamp verbatim, since it is not ISO 8601', () => {
    render(<FeedbackTable items={[base]} />);
    expect(screen.getByText('2026-08-06 14:22:01')).toBeInTheDocument();
  });

  it('renders only the header when there are no items', () => {
    render(<FeedbackTable items={[]} />);
    expect(screen.getAllByRole('row')).toHaveLength(1);
  });
});
