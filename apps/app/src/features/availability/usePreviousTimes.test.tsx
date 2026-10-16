import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The previous-times read and the start event (ADR 0005, ADR 0037, SUS-159,
 * ADR 0068). Since ADR 0077 the read is not applied on open; the editor asks
 * for it only to offer the explicit "Use my usual days" tap (SUS-227).
 */
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
const usualTimes = vi.fn();
vi.mock('../../data/availability', () => ({
  usualTimes: (...args: unknown[]) => usualTimes(...args),
}));

const { usePreviousTimes, useStartedEvent } = await import('./usePreviousTimes');

function wrapper(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  track.mockReset();
  usualTimes.mockReset();
});

describe('usePreviousTimes', () => {
  it("returns this opening's read, for this plan", async () => {
    usualTimes.mockResolvedValue(['weekday_evening']);
    const { result } = renderHook(
      () => usePreviousTimes({ planId: 'p1', userId: 'nina', enabled: true }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.parts).toEqual(['weekday_evening']));
    expect(usualTimes).toHaveBeenCalledWith('p1');
    expect(result.current.settled).toBe(true);
  });

  it('offers nothing when the read fails', async () => {
    usualTimes.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(
      () => usePreviousTimes({ planId: 'p1', userId: 'nina', enabled: true }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.parts).toBeUndefined();
  });

  it('does not read when it is not enabled, or without a person', () => {
    renderHook(() => usePreviousTimes({ planId: 'p1', userId: 'nina', enabled: false }), {
      wrapper: wrapper(),
    });
    renderHook(() => usePreviousTimes({ planId: 'p1', userId: undefined, enabled: true }), {
      wrapper: wrapper(),
    });
    expect(usualTimes).not.toHaveBeenCalled();
  });

  it('remembers that the answer began from the tap', async () => {
    usualTimes.mockResolvedValue([]);
    const { result } = renderHook(
      () => usePreviousTimes({ planId: 'p1', userId: 'nina', enabled: true }),
      { wrapper: wrapper() },
    );
    expect(result.current.used).toBe(false);
    act(() => result.current.markUsed());
    expect(result.current.used).toBe(true);
  });
});

describe('useStartedEvent', () => {
  it('sends the start once with the flag when the read has settled', () => {
    const { rerender } = renderHook(() =>
      useStartedEvent({ active: true, planId: 'p1', settled: true, offered: false }),
    );
    rerender();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('availability_started', {
      plan_id: 'p1',
      usual_offered: false,
    });
  });

  it('never holds the start back for a read that does not come: it goes without the flag', async () => {
    renderHook(() =>
      useStartedEvent({ active: true, planId: 'p1', settled: false, offered: false }),
    );
    expect(track).not.toHaveBeenCalled();
    await waitFor(
      () => expect(track).toHaveBeenCalledWith('availability_started', { plan_id: 'p1' }),
      { timeout: 3000 },
    );
  });

  it('still counts an opening left before the read came back, without the flag', () => {
    const { unmount } = renderHook(() =>
      useStartedEvent({ active: true, planId: 'p1', settled: false, offered: false }),
    );
    unmount();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('availability_started', { plan_id: 'p1' });
  });
});
