import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Loading } from './Loading';
import { WAIT } from './wait';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('Loading', () => {
  it('shows only the bar until about 300 ms, so a fast load never flashes', () => {
    render(<Loading message="Getting the plan" shape="cards" onBack={() => undefined} />);

    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    tick(WAIT.skeletonAfter - 1);
    expect(screen.queryByText('Getting the plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
  });

  it('shows the skeleton and the sentence together, the sentence as one live region', () => {
    render(<Loading message="Getting the plan" shape="detail" />);
    tick(WAIT.skeletonAfter);

    const sentence = screen.getByText('Getting the plan');
    expect(sentence).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getAllByText(/Getting the plan/)).toHaveLength(1);
  });

  it('adds "Still working on it…" at about 8 s and "Try again" at about 20 s', () => {
    const onRetry = vi.fn();
    render(<Loading message="Getting the options" shape="cards" onRetry={onRetry} />);
    tick(WAIT.slowAfter - 1);
    expect(screen.queryByText('Still working on it…')).not.toBeInTheDocument();
    tick(1);
    expect(screen.getByText('Still working on it…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

    tick(WAIT.retryAfter - WAIT.slowAfter);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('offers no "Try again" where the screen has nothing to retry', () => {
    render(<Loading message="Getting the options" shape="cards" />);
    tick(WAIT.retryAfter);
    expect(screen.getByText('Still working on it…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
