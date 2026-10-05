import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WAIT, useDelayedShow, useLoadingHold, useSlow } from './wait';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('useSlow', () => {
  it('says slow at about 8 s and stuck at about 20 s, and not before', () => {
    const { result } = renderHook(() => useSlow(true));
    expect(result.current).toEqual({ slow: false, stuck: false });

    tick(WAIT.slowAfter - 1);
    expect(result.current).toEqual({ slow: false, stuck: false });
    tick(1);
    expect(result.current).toEqual({ slow: true, stuck: false });

    tick(WAIT.retryAfter - WAIT.slowAfter - 1);
    expect(result.current.stuck).toBe(false);
    tick(1);
    expect(result.current).toEqual({ slow: true, stuck: true });
  });

  it('starts again from nothing for the next wait', () => {
    const { result, rerender } = renderHook(({ on }) => useSlow(on), {
      initialProps: { on: true },
    });
    tick(WAIT.retryAfter);
    expect(result.current.stuck).toBe(true);

    rerender({ on: false });
    expect(result.current).toEqual({ slow: false, stuck: false });

    rerender({ on: true });
    tick(WAIT.slowAfter - 1);
    expect(result.current.slow).toBe(false);
  });

  it('never fires for a wait that ended first', () => {
    const { result, rerender } = renderHook(({ on }) => useSlow(on), {
      initialProps: { on: true },
    });
    tick(WAIT.slowAfter - 1);
    rerender({ on: false });
    tick(WAIT.retryAfter);
    expect(result.current).toEqual({ slow: false, stuck: false });
  });
});

describe('useDelayedShow', () => {
  it('never shows for a wait shorter than the delay', () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedShow(on), {
      initialProps: { on: true },
    });
    tick(WAIT.spinnerAfter - 1);
    rerender({ on: false });
    tick(WAIT.shownAtLeast);
    expect(result.current).toBe(false);
  });

  it('shows after the delay and stays for the minimum once shown', () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedShow(on), {
      initialProps: { on: true },
    });
    tick(WAIT.spinnerAfter);
    expect(result.current).toBe(true);

    // The call settles 50 ms after the spinner appeared.
    tick(50);
    rerender({ on: false });
    expect(result.current).toBe(true);
    tick(WAIT.shownAtLeast - 50 - 1);
    expect(result.current).toBe(true);
    tick(1);
    expect(result.current).toBe(false);
  });
});

describe('useLoadingHold', () => {
  it('lets a fast load go at once, with nothing ever shown', () => {
    const { result, rerender } = renderHook(({ on }) => useLoadingHold(on), {
      initialProps: { on: true },
    });
    tick(WAIT.skeletonAfter - 1);
    rerender({ on: false });
    expect(result.current).toBe(false);
  });

  it('keeps the screen up for at least the minimum once the skeleton was shown', () => {
    const { result, rerender } = renderHook(({ on }) => useLoadingHold(on), {
      initialProps: { on: true },
    });
    tick(WAIT.skeletonAfter + 100);
    rerender({ on: false });
    expect(result.current).toBe(true);
    tick(WAIT.shownAtLeast - 100 - 1);
    expect(result.current).toBe(true);
    tick(1);
    expect(result.current).toBe(false);
  });

  it('does not hold a load that ran long', () => {
    const { result, rerender } = renderHook(({ on }) => useLoadingHold(on), {
      initialProps: { on: true },
    });
    tick(5_000);
    rerender({ on: false });
    tick(0);
    expect(result.current).toBe(false);
  });

  it('survives a second load that starts inside the hold, and ends when that one does', () => {
    const { result, rerender } = renderHook(({ on }) => useLoadingHold(on), {
      initialProps: { on: true },
    });
    tick(WAIT.skeletonAfter + 100);
    rerender({ on: false });
    expect(result.current).toBe(true);
    rerender({ on: true });
    tick(2_000);
    expect(result.current).toBe(true);
    rerender({ on: false });
    tick(0);
    expect(result.current).toBe(false);
  });

  it('is already true in the render the load ends in, so the screen is never unmounted', () => {
    const seen: boolean[] = [];
    const { rerender } = renderHook(
      ({ on }) => {
        const v = useLoadingHold(on);
        seen.push(v);
        return v;
      },
      { initialProps: { on: true } },
    );
    tick(WAIT.skeletonAfter + 100);
    seen.length = 0;
    rerender({ on: false });
    expect(seen[0]).toBe(true);
  });
});
