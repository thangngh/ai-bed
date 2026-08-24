import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StoryViewScreen } from '../StoryViewScreen';
import { BedtimeStory } from '../../types';

const story: BedtimeStory = {
  id: 'story-1',
  title: 'Chú thỏ dũng cảm',
  childName: 'An',
  childAge: 4,
  topic: 'Động vật',
  segments: {
    opening: 'Ngày xửa ngày xưa, có một chú thỏ nhỏ.',
    situation: 'Chú thỏ sống trong khu rừng.',
    interaction1: 'Bé ơi, chú thỏ nên làm gì?',
    challenge: 'Chú thỏ gặp một con sông lớn.',
    interaction2: 'Bé thử đoán xem?',
    ending: 'Chú thỏ đã vượt qua.',
    interaction3: 'Chú thỏ vui vẻ trở về.',
    moralSummary: 'Dũng cảm sẽ giúp con vượt qua khó khăn.',
  },
  createdAt: new Date().toISOString(),
};

describe('StoryViewScreen', () => {
  it('renders title, child name and moral summary', () => {
    render(
      <StoryViewScreen
        story={story}
        onReadAgain={vi.fn()}
        onCreateNew={vi.fn()}
        onGoToFeedback={vi.fn()}
        onSaveStory={vi.fn()}
        isSaved={false}
        isNightMode={false}
      />,
    );
    expect(screen.getByText('Chú thỏ dũng cảm')).toBeInTheDocument();
    expect(screen.getByText(/Dành cho bé An/i)).toBeInTheDocument();
    expect(screen.getByText(/Dũng cảm sẽ giúp con vượt qua khó khăn/i)).toBeInTheDocument();
  });

  it('uses a quiet high-contrast moral panel in night mode', () => {
    render(
      <StoryViewScreen
        story={story}
        onReadAgain={vi.fn()}
        onCreateNew={vi.fn()}
        onGoToFeedback={vi.fn()}
        onSaveStory={vi.fn()}
        isSaved={false}
        isNightMode
      />,
    );

    const panel = screen.getByRole('region', { name: /bài học nhân văn gửi gắm/i });
    expect(panel).toHaveClass('bg-slate-950', 'border-slate-700', 'text-slate-100');
    expect(panel).not.toHaveClass('bg-amber-500/10');
  });

  it('calls onSaveStory when save button is clicked', () => {
    const onSaveStory = vi.fn();
    render(
      <StoryViewScreen
        story={story}
        onReadAgain={vi.fn()}
        onCreateNew={vi.fn()}
        onGoToFeedback={vi.fn()}
        onSaveStory={onSaveStory}
        isSaved={false}
        isNightMode={false}
      />,
    );
    const saveBtn = screen.getByRole('button', { name: /lưu/i });
    fireEvent.click(saveBtn);
    expect(onSaveStory).toHaveBeenCalledWith(story);
  });

  it('calls onGoToFeedback when feedback button is clicked', () => {
    const onGoToFeedback = vi.fn();
    render(
      <StoryViewScreen
        story={story}
        onReadAgain={vi.fn()}
        onCreateNew={vi.fn()}
        onGoToFeedback={onGoToFeedback}
        onSaveStory={vi.fn()}
        isSaved={false}
        isNightMode={false}
      />,
    );
    const fbBtn = screen.getByRole('button', { name: /đánh giá|feedback|góp ý/i });
    fireEvent.click(fbBtn);
    expect(onGoToFeedback).toHaveBeenCalled();
  });
});
