import {
  type EventName,
  type EventPayload,
  type TrackedEvent,
  validateEvent,
} from '@circles/contracts';

/**
 * Client-side analytics.
 *
 * Three properties matter more than throughput:
 *
 * 1. **Tracking never breaks a screen.** Every failure path here ends in a
 *    dropped event, never a thrown error into a render or a tap handler.
 * 2. **Nothing leaves that the catalogue does not declare.** The payload is
 *    validated against `@circles/contracts` before it is buffered, so an
 *    undeclared key cannot reach the wire even if a caller passes one.
 * 3. **A guest on a train still gets counted.** Events buffer while offline and
 *    flush when a send succeeds — the no-install path is the whole product, and
 *    it is exactly the path with the worst connectivity.
 *
 * The `track-events` function itself lands in S1-21; until a transport is
 * configured, events simply accumulate up to the cap.
 */

/** Sends a batch. Rejects to signal "still offline" — the batch is kept. */
export type Transport = (events: TrackedEvent[]) => Promise<void>;

/**
 * Older events are dropped first when the cap is reached. A buffer that grows
 * without limit turns a long offline session into a memory problem, and the
 * oldest events are the least useful by then.
 */
const MAX_BUFFERED = 200;

let transport: Transport | null = null;
let buffer: TrackedEvent[] = [];
let flushing = false;
let clock: () => Date = () => new Date();

export function configureAnalytics(options: { transport?: Transport; now?: () => Date }): void {
  if (options.transport !== undefined) transport = options.transport;
  if (options.now !== undefined) clock = options.now;
}

/** Test seam. */
export function resetAnalytics(): void {
  transport = null;
  buffer = [];
  flushing = false;
  clock = () => new Date();
}

export function bufferedEvents(): readonly TrackedEvent[] {
  return buffer;
}

/**
 * Record an event. Returns whether it was accepted, so a test can assert it;
 * callers in the app ignore the result.
 */
export function track<E extends EventName>(name: E, payload: EventPayload<E>): boolean {
  const validated = validateEvent(name, payload);

  if (!validated) {
    // In development this is a mistake worth stopping for: the catalogue is the
    // contract, and a payload that does not fit it is a bug in the caller. In
    // production it is a dropped event and nothing more.
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      throw new Error(
        `track("${name}") was called with a payload the catalogue rejects. ` +
          'Add the field to packages/contracts/src/analytics.ts, deliberately, or remove it.',
      );
    }
    return false;
  }

  buffer.push({
    name: validated.name,
    version: validated.version,
    occurred_at: clock().toISOString(),
    properties: validated.properties as Record<string, unknown>,
  });

  if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);

  void flush();
  return true;
}

/**
 * Try to send everything buffered. Safe to call at any time; concurrent calls
 * collapse into one. A failed send keeps the batch rather than losing it.
 */
export async function flush(): Promise<void> {
  if (flushing || transport === null || buffer.length === 0) return;

  flushing = true;
  const batch = buffer;
  buffer = [];

  try {
    await transport(batch);
  } catch {
    // Still offline. Put the batch back in front of anything recorded since,
    // and let the cap drop the oldest if it has grown meanwhile.
    buffer = [...batch, ...buffer].slice(-MAX_BUFFERED);
  } finally {
    flushing = false;
  }
}
