import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../analytics/track', () => ({ track: vi.fn() }));
const calendarFile = vi.fn();
// No key on the deployment: every fetch here is the file.
vi.mock('../../data/confirmation', () => ({
  calendarFile: (...a: unknown[]) => calendarFile(...a),
  calendarLink: () => Promise.resolve(null),
}));
const saveFile = vi.fn();
vi.mock('../../platform/download', () => ({ saveFile: (...a: unknown[]) => saveFile(...a) }));

const { useCalendar } = await import('./useCalendar');

const target = (confirmationId: string, version: string) => ({
  circleId: 'c',
  planId: 'p',
  confirmationId,
  version,
  filename: 'x.ics',
});

/** A fetch the test settles by hand, in any order. */
function pending() {
  const settle = new Map<string, (ics: string) => void>();
  calendarFile.mockImplementation(
    (id: string) => new Promise<string>((resolve) => settle.set(id, resolve)),
  );
  return settle;
}

beforeEach(() => {
  vi.clearAllMocks();
  saveFile.mockReturnValue('saved');
});

describe('useCalendar', () => {
  it('asks once for a version, however many callers ask in a render', async () => {
    const settle = pending();
    const { result } = renderHook(() => useCalendar(target('a', 'a1')));
    await act(async () => {
      result.current.prepare();
      result.current.show();
    });
    expect(calendarFile).toHaveBeenCalledTimes(1);
    await act(async () => settle.get('a')?.('ICS'));
    expect(result.current.phase).toBe('ready');
  });

  it('fetches again when the same confirmation is edited, so the file is never the old one', async () => {
    const settle = pending();
    const { result, rerender } = renderHook(({ v }) => useCalendar(target('a', v)), {
      initialProps: { v: 'a1' },
    });
    await act(async () => result.current.prepare());
    await act(async () => settle.get('a')?.('OLD'));
    expect(result.current.phase).toBe('ready');

    rerender({ v: 'a2' });
    expect(result.current.phase).toBe('idle');
    await act(async () => result.current.prepare());
    expect(calendarFile).toHaveBeenCalledTimes(2);
    await act(async () => settle.get('a')?.('NEW'));
    act(() => result.current.download());
    expect(saveFile.mock.calls[0]?.[0]).toBe('NEW');
  });

  it('ignores a late answer for an obsolete version', async () => {
    const settle = pending();
    const { result, rerender } = renderHook(({ id, v }) => useCalendar(target(id, v)), {
      initialProps: { id: 'a', v: 'a1' },
    });
    await act(async () => result.current.prepare());
    rerender({ id: 'b', v: 'b1' });
    await act(async () => result.current.prepare());

    await act(async () => settle.get('b')?.('B'));
    await act(async () => settle.get('a')?.('A'));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    act(() => result.current.download());
    expect(saveFile.mock.calls[0]?.[0]).toBe('B');
  });
});
