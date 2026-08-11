import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
