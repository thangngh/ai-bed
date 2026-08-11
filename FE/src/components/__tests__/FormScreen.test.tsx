import { ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormScreen } from '../FormScreen';
import { ChildProfile, StoryFormInput } from '../../types';

vi.mock('../../utils/memoryClient', () => ({
  memoryClient: {
    getContext: vi.fn().mockResolvedValue({
      interests: [], preferences: [], recentThemes: [], behaviors: [],
    }),
  },
}));

const AN: ChildProfile = { childId: 'c1', childName: 'An', age: 4 };

const renderForm = (overrides: Partial<ComponentProps<typeof FormScreen>> = {}) =>
  render(
    <FormScreen
      onSubmit={vi.fn()}
      onBack={vi.fn()}
      isNightMode={false}
      activeChild={AN}
      onOpenChildSelector={vi.fn()}
      {...overrides}
    />
  );

describe('FormScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for a child before showing the form when none is active', () => {
    const onOpenChildSelector = vi.fn();
    renderForm({ activeChild: null, onOpenChildSelector });

    expect(screen.queryByRole('button', { name: /tạo câu chuyện/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /chọn bé/i }));
    expect(onOpenChildSelector).toHaveBeenCalled();
  });

  it('does not ask again for a name the profile already holds', () => {
    renderForm();

    expect(screen.queryByLabelText(/tên của bé/i)).not.toBeInTheDocument();
    expect(screen.getByText(/đang kể cho bé an/i)).toBeInTheDocument();
    expect(screen.getByText(/4 tuổi/i)).toBeInTheDocument();
  });

  it('submits the active child id and age', async () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });

    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload: StoryFormInput = onSubmit.mock.calls[0][0];
    expect(payload.childId).toBe('c1');
    expect(payload.childName).toBe('An');
    expect(payload.childAge).toBe(4);
    expect(payload.favoriteTopic).toBe('Động vật');
  });

  it('uses custom topic when provided', async () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText(/nhập chủ đề khác/i), { target: { value: 'Tàu hỏa' } });
    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].favoriteTopic).toBe('Tàu hỏa');
  });

  it('still validates the free-text boxes it does own', async () => {
    const onSubmit = vi.fn();
    renderForm({ onSubmit });

    fireEvent.change(screen.getByPlaceholderText(/nhập chủ đề khác/i), { target: { value: 'ｆｕｌｌｗｉｄｔｈ' } });
    fireEvent.click(screen.getByRole('button', { name: /tạo câu chuyện/i }));

    expect(await screen.findByText(/ký tự rộng \(fullwidth\)/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers a way to switch child from the chip', () => {
    const onOpenChildSelector = vi.fn();
    renderForm({ onOpenChildSelector });

    fireEvent.click(screen.getByRole('button', { name: /đổi bé/i }));

    expect(onOpenChildSelector).toHaveBeenCalled();
  });
});
