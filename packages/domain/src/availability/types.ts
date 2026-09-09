/**
 * The availability context.
 *
 * Willing windows are **the only availability data that leaves a device**
 * (spec §5.5). Not a calendar, not a free/busy feed — the half-hour spans a
 * person has said they would actually be up for. Everything here exists to
 * make sure what leaves is exactly that: aligned, merged, inside the plan, and
 * nothing else.
 */

import type { UserId } from '../circles/types.js';
import type { PlanId } from '../planning/types.js';
import type { Instant } from '../shared/instant.js';
import type { Interval } from '../shared/interval.js';

/**
 * Five explicit outcomes (spec §5.5). "None of these dates" is deliberately
 * three-way rather than a bare decline: someone who wants to come but cannot
 * this fortnight is telling you something different from someone who is out.
 */
export type ResponseStatus = 'windows' | 'flexible' | 'none_work' | 'more_notice' | 'not_this_time';

/** Every status other than `windows`. These carry no availability. */
export type StatusWithoutWindows = Exclude<ResponseStatus, 'windows'>;

export const STATUSES_WITHOUT_WINDOWS: readonly StatusWithoutWindows[] = [
  'flexible',
  'none_work',
  'more_notice',
  'not_this_time',
];

/**
 * What every answer carries, whatever it says.
 *
 * The **revision** is part of the identity rather than a detail: an edit that
 * changes the question bumps it and the old answers stop counting.
 */
type ResponseCore = {
  readonly planId: PlanId;
  readonly revision: number;
  readonly userId: UserId;
  /**
   * Whether the device calendar was used to help fill this in (Slice 3).
   * A flag only: no calendar data crosses the boundary (spec §5.5, §14).
   */
  readonly usedCalendarOverlay: boolean;
  readonly submittedAt: Instant;
};

/**
 * A member's answer to one revision of a plan.
 *
 * A union rather than a status beside a list, so that "these statuses carry no
 * windows" is enforced by the compiler instead of asserted in a comment. It was
 * a comment, and `STATUSES_WITHOUT_WINDOWS` was a constant nothing consulted —
 * a caller switching someone from `windows` to `not_this_time` without clearing
 * the array would have persisted availability the person had just withdrawn.
 *
 * The empty tuple, rather than an absent field, keeps `response.windows`
 * readable without narrowing first.
 */
export type Response =
  | (ResponseCore & {
      readonly status: 'windows';
      /** Aligned, merged, sorted — see `normaliseWindows`. */
      readonly windows: readonly Interval[];
    })
  | (ResponseCore & {
      readonly status: StatusWithoutWindows;
      readonly windows: readonly [];
    });

/** "I'm easy — count me in for whatever works for most people." */
export function isFlexible(response: Response): boolean {
  return response.status === 'flexible';
}

/**
 * Whether this response can contribute a time. Flexible members count toward
 * quorum without constraining the search, which is the point of the option.
 */
export function constrainsTimes(response: Response): boolean {
  return response.status === 'windows';
}

export function countsTowardQuorum(response: Response): boolean {
  return response.status === 'windows' || response.status === 'flexible';
}
