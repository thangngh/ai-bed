import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeedbackFilters from '../FeedbackFilters';
import type { FeedbackFilterState } from '../types';

const empty: FeedbackFilterState = { rating: '', hasNote: '', from: '', to: '' };

describe('FeedbackFilters', () => {
  it('emits the chosen rating', async () => {
    const onChange = vi.fn();
    render(<FeedbackFilters value={empty} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText(/đánh giá/i), '5');
    expect(onChange).toHaveBeenCalledWith({ ...empty, rating: '5' });
  });

  it('emits the note filter', async () => {
    const onChange = vi.fn();
    render(<FeedbackFilters value={empty} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText(/ghi chú/i), '1');
    expect(onChange).toHaveBeenCalledWith({ ...empty, hasNote: '1' });
  });

  it('emits date changes', async () => {
    const onChange = vi.fn();
    render(<FeedbackFilters value={empty} onChange={onChange} />);

    const from = screen.getByLabelText(/từ ngày/i);
    await userEvent.type(from, '2026-08-01');
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0].from).toBe('2026-08-01');
  });

  it('labels the date range as UTC so the 7-hour offset is not a surprise', () => {
    render(<FeedbackFilters value={empty} onChange={vi.fn()} />);
    expect(screen.getByText(/UTC/)).toBeInTheDocument();
  });

  it('resets every field at once', async () => {
    const onChange = vi.fn();
    render(<FeedbackFilters value={{ rating: '5', hasNote: '1', from: '2026-08-01', to: '2026-08-02' }} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /xoá bộ lọc/i }));
    expect(onChange).toHaveBeenCalledWith(empty);
  });

  it('reflects the current value in the controls', () => {
    render(<FeedbackFilters value={{ rating: '3', hasNote: '0', from: '2026-08-01', to: '' }} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/đánh giá/i)).toHaveValue('3');
    expect(screen.getByLabelText(/ghi chú/i)).toHaveValue('0');
    expect(screen.getByLabelText(/từ ngày/i)).toHaveValue('2026-08-01');
  });
});
