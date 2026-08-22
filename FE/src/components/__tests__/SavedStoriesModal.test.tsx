import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SavedStoriesModal } from '../SavedStoriesModal';
import { BedtimeStory, ChildProfile } from '../../types';

const emptySegments = {
  opening: '', situation: '', interaction1: '', challenge: '',
  interaction2: '', ending: '', interaction3: '', moralSummary: '',
};

function story(id: string, childId: string, title: string): BedtimeStory {
  return {
    id,
    childId,
    title,
    childName: 'An',
    childAge: 4,
    topic: 'Động vật',
    segments: emptySegments,
    createdAt: '2026-08-20T00:00:00Z',
  };
}

describe('SavedStoriesModal duplicate child names', () => {
  it('filters by child_id rather than the duplicated display name', () => {
    const activeChild: ChildProfile = { childId: 'child-b', childName: 'An', age: 4 };
    render(
      <SavedStoriesModal
        isOpen
        onClose={vi.fn()}
        savedStories={[
          story('story-a', 'child-a', 'Truyện của An thứ nhất'),
          story('story-b', 'child-b', 'Truyện của An thứ hai'),
        ]}
        beStories={[]}
        isLoadingBeStories={false}
        onSelectStory={vi.fn()}
        onDeleteStory={vi.fn()}
        isNightMode={false}
        activeChild={activeChild}
      />,
    );

    // The child tab is selected initially whenever an active child exists.
    expect(screen.queryByText('Truyện của An thứ nhất')).not.toBeInTheDocument();
    expect(screen.getByText('Truyện của An thứ hai')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    expect(screen.getByText('Truyện của An thứ nhất')).toBeInTheDocument();
    expect(screen.getByText('Truyện của An thứ hai')).toBeInTheDocument();
  });

  it('does not deduplicate different stories merely because titles match', () => {
    render(
      <SavedStoriesModal
        isOpen
        onClose={vi.fn()}
        savedStories={[
          story('story-a', 'child-a', 'Cùng một tiêu đề'),
          story('story-b', 'child-b', 'Cùng một tiêu đề'),
        ]}
        beStories={[]}
        isLoadingBeStories={false}
        onSelectStory={vi.fn()}
        onDeleteStory={vi.fn()}
        isNightMode={false}
      />,
    );

    expect(screen.getAllByText('Cùng một tiêu đề')).toHaveLength(2);
  });
});
