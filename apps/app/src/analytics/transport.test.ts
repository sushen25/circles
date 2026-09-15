import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackEventsTransport } from './transport';

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
