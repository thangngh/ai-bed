import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfileManager } from '../ProfileManager';
import { ChildProfile } from '../../types';

vi.mock('../../utils/childClient', () => ({
  childClient: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const AN: ChildProfile = { childId: 'c1', childName: 'An', age: 4 };

const baseProps = {
  activeChild: null,
  onSelectChild: vi.fn(),
  onUpdate: vi.fn(),
  onBack: vi.fn(),
  isNightMode: false,
};

describe('ProfileManager', () => {
  it('offers a create button when there are no children yet', () => {
    render(<ProfileManager {...baseProps} children={[]} />);

    // The dead end this fixes: the only add button used to be hidden at zero
    // children, so the first profile could never be created.
    expect(screen.getAllByRole('button', { name: /thêm hồ sơ/i }).length).toBeGreaterThan(0);
  });

  it('opens the editor for the child it was asked to edit', () => {
    render(<ProfileManager {...baseProps} children={[AN]} initialEditChild={AN} />);

    expect(screen.getByText('Sửa hồ sơ')).toBeInTheDocument();
    expect(screen.getByDisplayValue('An')).toBeInTheDocument();
  });

  it('shows the list when no edit target is given', () => {
    render(<ProfileManager {...baseProps} children={[AN]} />);

    expect(screen.getByText('Trang các bé')).toBeInTheDocument();
  });

  it('makes the first saved child the active one', async () => {
    const { childClient } = await import('../../utils/childClient');
    const created: ChildProfile = { childId: 'c9', childName: 'Bo', age: 5 };
    vi.mocked(childClient.create).mockResolvedValue(created);
    const onSelectChild = vi.fn();
    const onUpdate = vi.fn();

    render(<ProfileManager {...baseProps} children={[]} onSelectChild={onSelectChild} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: /thêm hồ sơ bé/i }));
    fireEvent.change(screen.getByLabelText(/tên bé/i), { target: { value: 'Bo' } });
    fireEvent.click(screen.getByRole('button', { name: /thêm bé/i }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith([created]));
    expect(onSelectChild).toHaveBeenCalledWith(created);
  });

  it('shows a generic message for a real save failure', async () => {
    const { childClient } = await import('../../utils/childClient');
    const { ApiError } = await import('../../utils/api');
    vi.mocked(childClient.create).mockRejectedValue(new ApiError('API_ERROR', 'Server error', 500));

    render(<ProfileManager {...baseProps} children={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /thêm hồ sơ bé/i }));
    fireEvent.change(screen.getByLabelText(/tên bé/i), { target: { value: 'Trung' } });
    fireEvent.click(screen.getByRole('button', { name: /thêm bé/i }));

    expect(await screen.findByText(/lưu hồ sơ thất bại/i)).toBeInTheDocument();
  });
});
