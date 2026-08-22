import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../Header';

const baseProps = {
  currentScreen: 'home' as const,
  isNightMode: false,
  setIsNightMode: vi.fn(),
  savedStoriesCount: 0,
  onOpenSavedStories: vi.fn(),
  onOpenSupport: vi.fn(),
};

describe('Header', () => {
  it('offers a way to the profile screen even with no child yet', () => {
    const setScreen = vi.fn();
    render(<Header {...baseProps} setScreen={setScreen} activeChild={null} />);

    fireEvent.click(screen.getByRole('button', { name: /^bé$/i }));

    expect(setScreen).toHaveBeenCalledWith('profile');
  });

  it('still shows the avatar shortcut once a child is active', () => {
    const onOpenChildSelector = vi.fn();
    render(
      <Header
        {...baseProps}
        setScreen={vi.fn()}
        activeChild={{ childId: 'c1', childName: 'An', age: 4 }}
        onOpenChildSelector={onOpenChildSelector}
      />
    );

    fireEvent.click(screen.getByTitle('An'));

    expect(onOpenChildSelector).toHaveBeenCalled();
  });

  it('places support beside analytics and opens the support modal', () => {
    const onOpenSupport = vi.fn();
    render(
      <Header
        {...baseProps}
        setScreen={vi.fn()}
        onOpenSupport={onOpenSupport}
      />
    );

    const analytics = document.getElementById('btn-header-analytics')!;
    const support = screen.getByRole('button', { name: 'Ủng hộ dự án' });
    expect(analytics.nextElementSibling).toBe(support);

    fireEvent.click(support);
    expect(onOpenSupport).toHaveBeenCalledTimes(1);
  });
});
