import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormScreen } from '../FormScreen';
import { StoryFormInput } from '../../types';

vi.mock('../../utils/memoryClient', () => ({
  memoryClient: {
    getContext: vi.fn().mockResolvedValue({
      interests: [], preferences: [], recentThemes: [], behaviors: [],
    }),
  },
}));

const renderForm = (onSubmit = vi.fn()) =>
  render(<FormScreen onSubmit={onSubmit} onBack={vi.fn()} isNightMode={false} />);

describe('FormScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows error when child name is empty', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));
    expect(await screen.findByText(/vui lòng nhập tên của bé/i)).toBeInTheDocument();
  });

  it('submits valid form with defaults', async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    fireEvent.change(screen.getByLabelText(/tên của bé/i), { target: { value: 'An' } });
    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload: StoryFormInput = onSubmit.mock.calls[0][0];
    expect(payload.childName).toBe('An');
    expect(payload.childAge).toBe(4);
    expect(payload.favoriteTopic).toBe('Động vật');
  });

  it('uses custom topic when provided', async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    fireEvent.change(screen.getByLabelText(/tên của bé/i), { target: { value: 'An' } });
    fireEvent.change(screen.getByPlaceholderText(/nhập chủ đề khác/i), { target: { value: 'Tàu hỏa' } });
    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].favoriteTopic).toBe('Tàu hỏa');
  });
});