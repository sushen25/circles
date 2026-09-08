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

/** Statuses that carry no windows. Anything else with windows is a bug. */
export const STATUSES_WITHOUT_WINDOWS: readonly ResponseStatus[] = [
  'flexible',
  'none_work',
  'more_notice',
  'not_this_time',
];

/**
 * A member's answer to one **revision** of a plan. An edit that changes the
 * question bumps the revision and the old answers stop counting — which is why
 * the revision is part of the identity here rather than a detail.
 */
export type Response = {
  readonly planId: PlanId;
  readonly revision: number;
  readonly userId: UserId;
  readonly status: ResponseStatus;
  /** Empty unless the status is `windows`. Aligned, merged, sorted. */
  readonly windows: readonly Interval[];
  /**
   * Whether the device calendar was used to help fill this in (Slice 3).
   * A flag only: no calendar data crosses the boundary (spec §5.5, §14).
   */
  readonly usedCalendarOverlay: boolean;
  readonly submittedAt: Instant;
};

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
