import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
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

describe('Loading: what it keeps and how it retries (SUS-157)', () => {
  it('draws its header at once, with the bar, before any skeleton', () => {
    render(<Loading message="Opening" shape="list" header={<p>the lockup</p>} />);
    expect(screen.getByText('the lockup')).toBeInTheDocument();
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    tick(WAIT.skeletonAfter);
    expect(screen.getByText('the lockup')).toBeInTheDocument();
    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
  });

  function inClient(client: QueryClient) {
    return render(
      <QueryClientProvider client={client}>
        <Loading message="Getting the plan" shape="detail" />
      </QueryClientProvider>,
    );
  }

  /** A query a screen is waiting on: observed, with no answer yet, and a fetch that never ends. */
  function waitingQuery(client: QueryClient, fetch: () => Promise<string>) {
    const observer = new QueryObserver(client, { queryKey: ['plan'], queryFn: fetch });
    return { stop: observer.subscribe(() => undefined) };
  }

  it('without an onRetry, "Try again" asks the waiting query again after about 20 s', async () => {
    const client = new QueryClient();
    const fetch = vi.fn(() => new Promise<string>(() => undefined));
    const { stop } = waitingQuery(client, fetch);
    inClient(client);
    tick(WAIT.retryAfter - 1);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    tick(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => undefined);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
  });

  it('offers no "Try again" when nothing is waiting on a query', () => {
    inClient(new QueryClient());
    tick(WAIT.retryAfter);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
