/**
 * Who can make a stretch of time — the engine's own test, on its own, so that
 * the picker, the review screen and the server cannot disagree (ADR 0051).
 *
 * The engine asks it for every start it enumerates; the organiser's picker asks
 * it for any stretch they care to try. It is **one rule**: a member whose
 * willing windows fully contain the stretch, or who said "I'm easy", can make
 * it. Everyone else cannot, and a member who has not answered at all is not
 * counted as someone who cannot: they are a third group, because the screens
 * say "Alex hasn't answered" and never "doesn't work for Alex" (manifesto §3.5,
 * spec §5.6). `private.stretch_availability` is the same rule in SQL.
 */

import type { UserId } from '../circles/types.js';
import type { Instant } from '../shared/instant.js';
import { type Interval, contains, interval } from '../shared/interval.js';
import type { MemberResponse } from './types.js';

/**
 * The members-list order, which is how the app renders people and so how the
 * engine reports them.
 *
 * Every set the engine returns is ordered by this and nothing else. A required
 * member who has since left the circle is not on the list; those sort last, by
 * id, so the answer stays canonical rather than depending on the order the
 * caller happened to pass `requiredMemberIds` in — that field is a set, and
 * `canonicalise` sorts it, so two inputs with the same hash must give the same
 * answer.
 */
export function byMemberList(activeMemberIds: readonly UserId[]): (a: UserId, b: UserId) => number {
  const position = new Map(activeMemberIds.map((id, index) => [id, index] as const));
  const at = (id: UserId) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
  return (a, b) => at(a) - at(b) || a.localeCompare(b);
}

/** What the engine and the picker both read: the answers and who is being asked. */
export type StretchInput = {
  readonly responses: readonly (readonly [UserId, MemberResponse])[];
  readonly activeMemberIds: readonly UserId[];
};

export type StretchAvailability = {
  /** Windows that contain the stretch, in members-list order. */
  readonly explicit: readonly UserId[];
  /** "I'm easy", in members-list order. */
  readonly flexible: readonly UserId[];
  /** Explicit and flexible together, in members-list order: the "can make it" set. */
  readonly available: readonly UserId[];
  /** Answered, and cannot make it: other times, or none work, or not this time. */
  readonly cannot: readonly UserId[];
  /** Has not answered. Never inside `available` and never inside `cannot`. */
  readonly awaiting: readonly UserId[];
};

/**
 * Step 2 of the algorithm (architecture §12), for any stretch.
 *
 * Explicit means a window **fully contains** the whole meetup, not that it
 * overlaps: someone free 7–8 cannot attend a two-hour dinner starting at 7.
 * Flexible members count without constraining. Non-responders, `none_work`,
 * `more_notice` and `not_this_time` are unavailable, and a non-responder never
 * appears in the available set (§5.6).
 *
 * Iterated in `activeMemberIds` order, so every list is stable. Only the people
 * being asked count: an answer from somebody who has left is nothing.
 */
export function whoCanMake(input: StretchInput, start: Instant, end: Instant): StretchAvailability {
  const meetup: Interval = interval(start, end);
  const byId = new Map(input.responses);

  const explicit: UserId[] = [];
  const flexible: UserId[] = [];
  const cannot: UserId[] = [];
  const awaiting: UserId[] = [];

  for (const userId of input.activeMemberIds) {
    const response = byId.get(userId);
    if (response === undefined) {
      awaiting.push(userId);
    } else if (response.status === 'flexible') {
      flexible.push(userId);
    } else if (response.status === 'windows' && response.windows.some((w) => contains(w, meetup))) {
      explicit.push(userId);
    } else {
      cannot.push(userId);
    }
  }

  const order = byMemberList(input.activeMemberIds);
  return {
    explicit,
    flexible,
    available: [...explicit, ...flexible].sort(order),
    cannot,
    awaiting,
  };
}
