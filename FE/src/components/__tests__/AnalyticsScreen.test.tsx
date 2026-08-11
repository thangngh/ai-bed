import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnalyticsScreen } from '../AnalyticsScreen';

vi.mock('../../utils/analyticsClient', () => ({
  analyticsClient: {
    getStoryStats: vi.fn().mockResolvedValue(null),
    getFeedbackStats: vi.fn().mockResolvedValue(null),
    getMemoryStats: vi.fn().mockResolvedValue(null),
  },
}));

describe('AnalyticsScreen', () => {
  it('lets a parent with no children add one from the empty state', async () => {
    const onAddChild = vi.fn();
    render(
      <AnalyticsScreen
        childProfiles={[]}
        activeChild={null}
        onBack={vi.fn()}
        isNightMode={false}
        onAddChild={onAddChild}
      />
    );

    const button = await screen.findByRole('button', { name: /thêm hồ sơ bé/i });
    fireEvent.click(button);

    await waitFor(() => expect(onAddChild).toHaveBeenCalled());
  });
});
