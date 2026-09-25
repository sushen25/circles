import { z } from 'zod';

import { PlanId } from '../ids.js';
import { Instant } from '../time.js';

/**
 * `quiet-view` — what the caller may see of a quiet plan, and only that
 * (spec §5.4, S2-02).
 *
 * The server builds it with `quietView` in `packages/domain` from facts that
 * live in `private` — whether the caller started the ask, what they answered,
 * whether an expired one had opened — and returns the view alone. **Those
 * facts never reach a client** (review round 1): a device that held
 * `is_initiator: true` or `keen` would hold the two things a quiet ask exists
 * to keep, for whoever picks the phone up. What comes back is capabilities —
 * "answered", "may withdraw", "may take the role" — built for this viewer and
 * about nobody else.
 *
 * A read, so no idempotency key. `view` is null for a named plan, and for a
 * plan the caller is not an active member of.
 */
export const QuietViewRequest = z.object({ plan_id: PlanId });
export type QuietViewRequest = z.infer<typeof QuietViewRequest>;

/** Asking: when it closes and what opens it. No count, for anybody (§5.4.3). */
const Seeking = z.strictObject({
  phase: z.literal('seeking'),
  closes_at: Instant,
  threshold: z.int().min(2),
  /** Whether the caller has answered — never *what*. */
  answered_by_me: z.boolean(),
  /** Only ever true for the caller who asked, and only on their own screen. */
  may_withdraw: z.boolean(),
});

/** Opened: the keen count fixed when it opened (ADR 0035), and the organiser once there is one. */
const Opened = z.strictObject({
  phase: z.literal('opened'),
  keen_count: z.int().nonnegative().nullable(),
  organiser: z.string().nullable(),
  may_take_role: z.boolean(),
});

/** Closed: nothing, but the initiator's "this one closed quietly" (SparkExpired). */
const Closed = z.strictObject({
  phase: z.literal('closed'),
  show_closed_notice: z.boolean(),
});

export const QuietView = z.discriminatedUnion('phase', [Seeking, Opened, Closed]);
export type QuietView = z.infer<typeof QuietView>;

export const QuietViewResponse = z.object({ view: QuietView.nullable() });
export type QuietViewResponse = z.infer<typeof QuietViewResponse>;
