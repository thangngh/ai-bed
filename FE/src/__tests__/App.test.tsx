import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import App from '../App';
import { ChildProfile } from '../types';

vi.mock('../utils/childClient', () => ({
  childClient: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const CHILD_A: ChildProfile = { childId: 'c1', childName: 'An', age: 4 };

describe('App - profile edit target lifecycle', () => {
  beforeEach(async () => {
    const { childClient } = await import('../utils/childClient');
    vi.mocked(childClient.list).mockResolvedValue([CHILD_A]);
    localStorage.setItem('bsc_active_child', JSON.stringify(CHILD_A));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('does not reopen a finished edit when returning to the profile screen via header nav', async () => {
    render(<App />);

    // Open the child selector from the header avatar and edit child A.
    const avatarButton = await screen.findByTitle('An');
    fireEvent.click(avatarButton);

    const selectorHeading = await screen.findByRole('heading', { name: /chọn bé/i });
    const selectorRoot = selectorHeading.parentElement!.parentElement!;
    const editButton = within(selectorRoot).getAllByRole('button')[1];
    fireEvent.click(editButton);

    // The editor for An should be open now.
    expect(await screen.findByText('Sửa hồ sơ')).toBeInTheDocument();
    expect(screen.getByDisplayValue('An')).toBeInTheDocument();

    // Cancel out of the editor -- the user is done with An.
    fireEvent.click(screen.getByRole('button', { name: /trở về/i }));
    expect(await screen.findByText('Trang các bé')).toBeInTheDocument();

    // Navigate Home, then back to the children list via the header.
    fireEvent.click(document.getElementById('btn-header-home')!);
    fireEvent.click(document.getElementById('btn-header-children')!);

    // The user asked for the children list, not An's editor again.
    expect(await screen.findByText('Trang các bé')).toBeInTheDocument();
    expect(screen.queryByText('Sửa hồ sơ')).not.toBeInTheDocument();
  });
});
