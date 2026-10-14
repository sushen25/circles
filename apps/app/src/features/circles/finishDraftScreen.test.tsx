import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WAIT } from '../../components/wait';
import { FinishDraftScreen, type FinishDraftProblem } from './FinishDraftScreen';

/**
 * The finish's waiting state is the shared loading screen (SUS-207), and its
 * five problem states are what they were.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('FinishDraftScreen: waiting', () => {
  it('shows no skeleton or sentence for a fast finish, then both together', () => {
    render(<FinishDraftScreen circleName="Walkies" />);

    tick(WAIT.skeletonAfter - 1);
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(screen.queryByText('Setting up Walkies')).not.toBeInTheDocument();

    tick(1);
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Setting up Walkies')).toHaveAttribute('aria-live', 'polite');
  });

  it('says "Still working on it…" after the shared delay, and offers no Try again of its own', () => {
    render(<FinishDraftScreen circleName="Walkies" onRetry={vi.fn()} />);

    tick(WAIT.slowAfter - 1);
    expect(screen.queryByText('Still working on it…')).not.toBeInTheDocument();
    tick(1);
    expect(screen.getByText('Still working on it…')).toBeInTheDocument();

    tick(WAIT.retryAfter);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });
});

describe('FinishDraftScreen: problems', () => {
  const cases: [FinishDraftProblem, RegExp, string][] = [
    ['too_many_tries', /a lot of new circles/, 'Try again'],
    ['couldnt_set_up', /Walkies wasn't set up/, 'Try again'],
    ['offline', /You're offline/, 'Try again'],
    ['too_late', /tonight/i, 'Change the time'],
    ['time_passed', /gone by while you signed in/, 'Change the time'],
  ];

  it.each(cases)('%s keeps its words and its one button', (problem, words, button) => {
    const onRetry = vi.fn();
    const onChangeTime = vi.fn();
    render(
      <FinishDraftScreen
        circleName="Walkies"
        problem={problem}
        reference="abc123"
        onRetry={onRetry}
        onChangeTime={onChangeTime}
      />,
    );
    tick(WAIT.retryAfter);

    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(screen.getByText(words)).toBeInTheDocument();
    expect(screen.getByText('Ref abc123')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: button }));
    expect(button === 'Try again' ? onRetry : onChangeTime).toHaveBeenCalledOnce();
  });
});
