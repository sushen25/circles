import { z } from 'zod';

import { TrackedEvent } from '../analytics.js';

/**
 * `track-events` — the ingest for first-party analytics (architecture §15).
 *
 * Fifty at a time, because the client buffers while offline and a guest on a
 * train is the path the product is built around: the batch that arrives when
 * they get signal is the whole session, not one event.
 *
 * No idempotency key, unlike every mutation: this records rather than decides,
 * and what makes a resend safe is `event_id` on each event rather than a claim
 * on the request. The client puts a failed batch back — including when the
 * insert committed and the answer was lost — so without that, one flaky flush
 * inflates every funnel count it touched.
 */
export const TrackEventsRequest = z.object({
  events: z.array(TrackedEvent).min(1).max(50),
  /**
   * The browser, for the events that happen before anybody signs in — a link
   * opened from a group chat is the top of the funnel and by definition
   * precedes a session.
   *
   * Two things make "never joined to a person" true rather than intended, and
   * both are the ingest's, because this schema cannot enforce either. It is
   * **hashed** before it is stored, since any base64url string of this length
   * fits — a re-entry token included — and a token in an analytics row is what
   * non-negotiable 8 forbids. And it is **dropped entirely once a bearer
   * identifies somebody**, because a row carrying both is the join.
   */
  anonymous_id: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export type TrackEventsRequest = z.infer<typeof TrackEventsRequest>;

export const TrackEventsResponse = z.object({
  /** Validated against the catalogue and stored — or stored already, which is the same answer. */
  accepted: z.int().nonnegative(),
  /** Not in the catalogue, or not the shape the catalogue declares. Dropped, never guessed at. */
  rejected: z.int().nonnegative(),
});
export type TrackEventsResponse = z.infer<typeof TrackEventsResponse>;
