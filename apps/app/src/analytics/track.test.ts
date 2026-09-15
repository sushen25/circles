import { afterEach, describe, expect, it, vi } from 'vitest';

import { bufferedEvents, configureAnalytics, flush, resetAnalytics, track } from './track';

afterEach(resetAnalytics);

const at = () => new Date('2026-09-17T08:30:00.000Z');

describe('track', () => {
  it('buffers a valid event with its catalogue version and time', () => {
    configureAnalytics({ now: at });

    expect(track('availability_submitted', { status: 'flexible' })).toBe(true);
    expect(bufferedEvents()).toEqual([
      {
        // Minted per event, so that a batch put back after a failed flush is
        // the same batch when it lands: the ingest settles a resend by id
        // rather than by counting it twice.
        event_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        name: 'availability_submitted',
        version: 1,
        occurred_at: '2026-09-17T08:30:00.000Z',
        properties: { status: 'flexible' },
      },
    ]);
  });

  it('gives every event its own id', () => {
    configureAnalytics({ now: at });

    track('availability_started', {});
    track('availability_started', {});

    const [first, second] = bufferedEvents();
    expect(first?.event_id).not.toBe(second?.event_id);
  });

  it('refuses a payload the catalogue does not declare', () => {
    configureAnalytics({ now: at });
    // `__DEV__` is undefined under the test runner, so this takes the
    // production path: dropped, not thrown.
    expect(track('circle_created', { email: 'redacted' } as never)).toBe(false);
    expect(bufferedEvents()).toHaveLength(0);
  });
});

describe('offline', () => {
  it('keeps events when the send fails, and sends them on the next success', async () => {
    const sent: unknown[][] = [];
    let online = false;
    configureAnalytics({
      now: at,
      transport: async (events) => {
        if (!online) throw new Error('offline');
        sent.push([...events]);
      },
    });

    track('availability_started', {});
    track('availability_submitted', { status: 'windows', window_count: 3 });
    await flush();

    expect(sent).toHaveLength(0);
    expect(bufferedEvents()).toHaveLength(2);

    online = true;
    await flush();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(2);
    expect(bufferedEvents()).toHaveLength(0);
  });

  it('drops the oldest rather than growing without limit', async () => {
    configureAnalytics({ now: at, transport: () => Promise.reject(new Error('offline')) });

    for (let i = 0; i < 250; i += 1) track('circle_join_opened', {});
    await flush();

    expect(bufferedEvents().length).toBeLessThanOrEqual(200);
  });

  it('does not throw out of a tap handler when the transport explodes', async () => {
    configureAnalytics({ now: at, transport: () => Promise.reject(new Error('boom')) });
    expect(() => track('share_opened', { kind: 'invite' })).not.toThrow();
    await expect(flush()).resolves.toBeUndefined();
  });
});

describe('the catalogue is the contract', () => {
  it('rejects an event name that is not declared', () => {
    const unknown = 'made_up_event' as never;
    expect(() => track(unknown, {} as never)).toThrow();
  });

  it('validates before buffering, so nothing undeclared can reach the wire', async () => {
    const transport = vi.fn(async () => undefined);
    configureAnalytics({ now: at, transport });

    track('meetup_confirmed', { attending_count: 5, invited_count: 6 });
    await flush();

    expect(transport).toHaveBeenCalledOnce();
    const [batch] = transport.mock.calls[0] as unknown as [{ properties: object }[]];
    expect(Object.keys(batch[0]!.properties)).toEqual(['attending_count', 'invited_count']);
  });
});

describe('flush', () => {
  it('sends in chunks the ingest will accept, and drains rather than wedging', async () => {
    // A long outage buffers more than one batch. Sending the lot got a 400 —
    // `TrackEventsRequest` caps at fifty — which put the oversized batch back,
    // so every later flush sent the same too-large batch and analytics stopped
    // for the rest of the session.
    const batches: number[] = [];
    // Buffered first, with no transport — which is what an outage looks like:
    // `track()` flushes as it goes, so a queue only grows while sending fails.
    configureAnalytics({ now: at });
    for (let index = 0; index < 120; index += 1) track('availability_started', {});

    configureAnalytics({
      transport: async (events) => {
        batches.push(events.length);
      },
    });
    await flush();

    expect(batches.every((size) => size <= 50)).toBe(true);
    expect(batches.reduce((sum, size) => sum + size, 0)).toBe(120);
    expect(bufferedEvents()).toHaveLength(0);
  });

  it('keeps only what did not land when a later chunk fails', async () => {
    let sent = 0;
    configureAnalytics({ now: at });
    for (let index = 0; index < 120; index += 1) track('availability_started', {});

    configureAnalytics({
      transport: async (events) => {
        sent += 1;
        if (sent > 1) throw new Error('offline');
        void events;
      },
    });
    await flush();

    // The first fifty are gone; the rest are still there to try again.
    expect(bufferedEvents()).toHaveLength(70);
  });
});
