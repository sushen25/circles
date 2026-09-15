import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { retryWhenReachable, trackEventsTransport } from './transport';

const EVENT = {
  event_id: '00000000-0000-4000-8000-00000000000a',
  name: 'circle_join_opened' as const,
  version: 1,
  occurred_at: '2026-09-17T08:30:00.000Z',
  properties: {},
};

describe('the analytics transport', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://db.test';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the batch to track-events with the publishable key', async () => {
    const fetched = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetched);

    await trackEventsTransport()([EVENT]);

    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://db.test/functions/v1/track-events');
    expect(JSON.parse(String(init.body))).toMatchObject({ events: [EVENT] });
  });

  it('uses the session token when there is one, so the event has an owner', async () => {
    const fetched = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetched);

    await trackEventsTransport({ accessToken: () => 'a-session-token' })([EVENT]);

    const [, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer a-session-token',
    );
  });

  it('rejects on a failed send, so the batch is kept rather than lost', async () => {
    // `flush()` reads a rejection as "still offline" and puts the batch back.
    // Resolving here would drop a guest's whole session on one bad response.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    await expect(trackEventsTransport()([EVENT])).rejects.toThrow('503');
  });

  it('rejects rather than sending nowhere when nothing is configured', async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = '';
    const fetched = vi.fn();
    vi.stubGlobal('fetch', fetched);

    await expect(trackEventsTransport()([EVENT])).rejects.toThrow('no Supabase URL');
    expect(fetched).not.toHaveBeenCalled();
  });
});

describe('retrying when the device comes back', () => {
  it('flushes on the events a browser fires, and stops when torn down', async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('addEventListener', (type: string, handler: () => void) => {
      listeners.set(type, handler);
    });
    vi.stubGlobal('removeEventListener', (type: string) => {
      listeners.delete(type);
    });

    const flushed = vi.fn(async () => {});
    const teardown = retryWhenReachable(flushed);

    listeners.get('online')?.();
    expect(flushed).toHaveBeenCalledTimes(1);

    teardown();
    expect(listeners.size).toBe(0);
  });

  it('keeps a slow heartbeat for runtimes that fire neither', () => {
    vi.useFakeTimers();
    try {
      const flushed = vi.fn(async () => {});
      const teardown = retryWhenReachable(flushed);

      vi.advanceTimersByTime(60_000);
      expect(flushed).toHaveBeenCalled();

      teardown();
      const before = flushed.mock.calls.length;
      vi.advanceTimersByTime(180_000);
      expect(flushed.mock.calls.length).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('attribution', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://db.test';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'publishable-key';
  });

  it('reads the token on every send, so signing in mid-session starts attributing', async () => {
    // Captured once, a guest who signs in halfway through would go on sending
    // as nobody for the rest of the session.
    const fetched = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetched);

    const session: { token: string | undefined } = { token: undefined };
    const send = trackEventsTransport({ accessToken: () => session.token });

    await send([EVENT]);
    session.token = 'a-session-token';
    await send([EVENT]);

    const authorisations = (fetched.mock.calls as unknown as [string, RequestInit][]).map(
      ([, init]) => init.headers as Record<string, string>,
    );
    expect(authorisations[0]?.['Authorization']).toBe('Bearer publishable-key');
    expect(authorisations[1]?.['Authorization']).toBe('Bearer a-session-token');
  });
});
