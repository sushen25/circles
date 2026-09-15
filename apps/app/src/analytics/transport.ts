import type { TrackedEvent } from '@circles/contracts';

/**
 * The wire between `track()` and the `track-events` function.
 *
 * Buffering without a transport is a measurement that never happens, and the
 * events this most matters for are the ones before anybody signs in: a link
 * opened from a group chat is the top of the funnel and by definition precedes
 * a session. So this sends with whatever authority the browser has — the
 * publishable key always, the session's own token when there is one — and the
 * ingest attributes the event or does not.
 *
 * **It rejects rather than swallowing a failure.** `flush()` reads the
 * rejection as "still offline" and puts the batch back, which is what makes a
 * guest on a train get counted when they reach signal. Resolving on a failed
 * send would drop the batch silently, which is the same as not measuring.
 */

/** Per browser, not per person: it identifies a device and is never joined to one. */
const ANONYMOUS_ID_KEY = 'circles.anonymous_id';

function anonymousId(): string | undefined {
  try {
    const stored = globalThis.localStorage?.getItem(ANONYMOUS_ID_KEY);
    if (stored !== null && stored !== undefined && stored !== '') return stored;

    const minted =
      globalThis.crypto?.randomUUID?.() ?? `a${Date.now()}${Math.random()}`.slice(0, 40);
    const clean = minted.replace(/[^A-Za-z0-9_-]/g, '');
    globalThis.localStorage?.setItem(ANONYMOUS_ID_KEY, clean);
    return clean;
  } catch {
    // Private browsing, or a native runtime with no `localStorage`. An event
    // without a device id is still an event.
    return undefined;
  }
}

export interface TransportOptions {
  /** The current session's access token, when there is one. */
  accessToken?: () => string | undefined;
}

export function trackEventsTransport(options: TransportOptions = {}) {
  return async function send(events: TrackedEvent[]): Promise<void> {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (url === undefined || key === undefined || url === '' || key === '') {
      throw new Error('analytics: no Supabase URL or key configured');
    }

    const token = options.accessToken?.() ?? key;
    const response = await fetch(`${url}/functions/v1/track-events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events, anonymous_id: anonymousId() }),
    });

    // A 4xx is our bug and retrying will not fix it, but the batch is kept
    // either way: a dropped measurement is invisible, and a buffer that stops
    // growing at two hundred is bounded anyway.
    if (!response.ok) throw new Error(`analytics: ${response.status}`);
  };
}

/**
 * Try again when the device comes back, rather than when the person happens to
 * do something else.
 *
 * `flush()` is otherwise only reached by the next `track()` call. A guest who
 * answers on a train and then puts their phone away has a buffer that never
 * drains and is lost on reload — which is the exact journey the offline
 * buffering exists for, so "buffers while offline and flushes when a send
 * succeeds" was only half true.
 *
 * Returns the teardown, so a caller that mounts this can unmount it.
 */
export function retryWhenReachable(flush: () => Promise<void>): () => void {
  const attempt = (): void => {
    void flush();
  };

  const teardowns: (() => void)[] = [];

  // Web: the browser says so.
  const target = globalThis as unknown as {
    addEventListener?: (type: string, handler: () => void) => void;
    removeEventListener?: (type: string, handler: () => void) => void;
    document?: { visibilityState?: string };
  };
  if (typeof target.addEventListener === 'function') {
    for (const event of ['online', 'focus']) {
      target.addEventListener(event, attempt);
      teardowns.push(() => target.removeEventListener?.(event, attempt));
    }
  }

  // And a slow heartbeat for everything else — a native app coming back to the
  // foreground, a tab that never fires either event. It does nothing when the
  // buffer is empty, which is almost always.
  const timer = setInterval(attempt, 60_000);
  teardowns.push(() => {
    clearInterval(timer);
  });

  return () => {
    for (const teardown of teardowns) teardown();
  };
}
