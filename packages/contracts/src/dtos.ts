import { z } from 'zod';

import { CircleId, ShortCode, UserId } from './ids.js';
import { Instant, Zone } from './time.js';

/**
 * What a client is given back, as distinct from what a table holds.
 *
 * Architecture §7.4: "Return a DTO; never the raw row." The difference is not
 * ceremony — `circles` carries `owner_user_id`, `creation_key` and the
 * bookkeeping columns, and none of those are any of a joining guest's business.
 * A DTO is the decision about what leaves the server, written down once so that
 * every function returning a circle returns the same circle.
 */

/** A circle, as its members see it. */
export const CircleDto = z.object({
  id: CircleId,
  name: z.string(),
  color: z.string(),
  time_zone: Zone,
  cadence: z.enum(['weekly', 'fortnightly', 'monthly', 'two_monthly', 'none']),
  /** The code in `/j/:code` links. Not a secret; the invite fragment is. */
  short_code: ShortCode,
  status: z.enum(['active', 'archived']),
  /** Null until the circle has met once. */
  last_met_at: Instant.nullable(),
});
export type CircleDto = z.infer<typeof CircleDto>;

/**
 * One row of the "Continue as" list (ADR 0006).
 *
 * A name and the id needed to reattach to it, and **nothing else**. No reply
 * state and no email flag — that is the ADR's one explicit constraint on this
 * list, and the shape is where it is easiest to keep: a field that does not
 * exist cannot be added by accident.
 */
export const GuestMemberOption = z.object({
  member_user_id: UserId,
  display_name: z.string(),
});
export type GuestMemberOption = z.infer<typeof GuestMemberOption>;
