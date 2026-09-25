import type { Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The app tier on a phone (S3-01a): whose first open it was, and that nobody
 * else inherits it. Review round 1 found a first open that nobody read handed
 * to the next person to sign in on the same phone.
 */
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const stamped = new Map<string, string | null>();
vi.mock('./client', () => ({
  authClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: async () => ({ data: { app_installed_at: stamped.get(userId) ?? null } }),
        }),
      }),
    }),
  }),
}));
const mark = vi.fn();
vi.mock('./install', () => ({ markAppInstalled: () => mark() }));

const tier = await import('./appTier');

function session(id: string, anonymous = false): Session {
  return { user: { id, is_anonymous: anonymous } } as unknown as Session;
}

beforeEach(() => {
  tier.resetAppTierForTests();
  stamped.clear();
  mark.mockReset();
});

describe('app tier', () => {
  it('marks a saved place that is not stamped yet, and says it was the first open, once', async () => {
    mark.mockResolvedValue({ installed_at: '2026-09-26T00:00:00Z', first_open: true });
    const heard = vi.fn();
    tier.onAppFirstOpen(heard);

    await tier.loadAppInstalled(session('maya'));

    expect(tier.isAppInstalled()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(await tier.appTierSettled('maya')).toEqual({ firstOpen: true });
    expect(await tier.appTierSettled('maya')).toEqual({ firstOpen: false });
  });

  it("never hands one person's first open to the next person on the phone", async () => {
    mark.mockResolvedValue({ installed_at: '2026-09-26T00:00:00Z', first_open: true });
    // A guest saves their place (nothing asks appTierSettled), then signs out.
    await tier.loadAppInstalled(session('priya'));
    await tier.loadAppInstalled(null);
    // Somebody already stamped signs in.
    stamped.set('tom', '2026-01-01T00:00:00Z');
    await tier.loadAppInstalled(session('tom'));

    expect(await tier.appTierSettled('tom')).toEqual({ firstOpen: false });
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it('does not answer for a different person than the one asked about', async () => {
    mark.mockResolvedValue({ installed_at: '2026-09-26T00:00:00Z', first_open: true });
    await tier.loadAppInstalled(session('maya'));
    expect(await tier.appTierSettled('sam')).toEqual({ firstOpen: false });
  });

  it('asks nothing for a guest, and leaves the tier alone when the function fails', async () => {
    await tier.loadAppInstalled(session('alex', true));
    expect(mark).not.toHaveBeenCalled();

    mark.mockRejectedValue(new Error('offline'));
    await tier.loadAppInstalled(session('maya'));
    expect(tier.isAppInstalled()).toBe(false);
    expect(await tier.appTierSettled('maya')).toEqual({ firstOpen: false });
  });

  it('stops waiting after a few seconds rather than holding sign-in', async () => {
    vi.useFakeTimers();
    mark.mockReturnValue(new Promise(() => undefined));
    void tier.loadAppInstalled(session('maya'));
    const settled = tier.appTierSettled('maya');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await settled).toEqual({ firstOpen: false });
    vi.useRealTimers();
  });
});
