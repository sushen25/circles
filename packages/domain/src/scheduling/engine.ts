/**
 * `generateCandidates` — the algorithm in architecture §12, step for step.
 *
 * Nothing here reads a clock, allocates randomly, or iterates a `Map`: the same
 * input has to give the same output on a phone and on a server, because the
 * client shows a preview and the server is the authority, and a disagreement
 * between them is a person being offered a time that then vanishes.
 */

import type { UserId } from '../circles/types.js';
import { contains, interval } from '../shared/interval.js';
import { type Instant, addMinutes } from '../shared/instant.js';
import { type LocalDate, isWeekend } from '../shared/local-date.js';
import { fromLocal, fromLocalEnd, localSlotStarts, toLocal } from '../shared/zone.js';
import { addDays } from '../shared/local-date.js';
import { inputHash } from './hash.js';
import {
  SCORING_VERSION,
  type Candidate,
  type CandidateSet,
  type EngineInput,
  type EnginePlan,
  type Explanation,
  type ExplanationCode,
  type NearMiss,
  type NearMissReason,
} from './types.js';

const MAX_RESULTS = 3;

/** A start with everything the ranking needs, computed once. */
type Scored = {
  readonly start: Instant;
  readonly end: Instant;
  /** The start read off a wall clock in the plan's zone — see `compareCandidates`. */
  readonly localDate: LocalDate;
  readonly localMinutes: number;
  readonly available: readonly UserId[];
  readonly explicitCount: number;
  readonly flexibleCount: number;
  readonly requiredMissing: readonly UserId[];
  readonly eligible: boolean;
};

/**
 * Step 1 — every 30-minute start whose whole duration fits inside that day's
 * band, in the plan's zone, skipping the past.
 *
 * Days are walked one at a time through `localSlotStarts`, so the day the
 * clocks change has the right number of starts rather than a number derived
 * from arithmetic: two extra when an hour repeats, two fewer when one is
 * skipped.
 *
 * Named for what it enumerates rather than `enumerateStarts`, which
 * `shared/interval` already uses for the zone-free version over a single range.
 */
export function enumerateCandidateStarts(plan: EnginePlan, now: Instant): Instant[] {
  const starts: Instant[] = [];
  let date = plan.window.start;

  while (date <= plan.window.end) {
    const bandStart = fromLocal(date, plan.daily.startMin, plan.zone);
    const bandEnd = fromLocalEnd(date, plan.daily.endMin, plan.zone);

    for (const start of localSlotStarts(bandStart, bandEnd, plan.zone)) {
      // The meetup has to finish inside the band, and it has to be in future.
      if (addMinutes(start, plan.durationMinutes) > bandEnd) continue;
      if (start <= now) continue;
      starts.push(start);
    }
    date = addDays(date, 1);
  }
  return starts;
}

/**
 * Step 2 — who can make it.
 *
 * Explicit means a window **fully contains** the whole meetup, not that it
 * overlaps: someone free 7–8 cannot attend a two-hour dinner starting at 7.
 * Flexible members count without constraining. Everyone else — non-responders,
 * `none_work`, `more_notice`, `not_this_time` — is unavailable, and a
 * non-responder never appears in the available set (§5.6).
 */
function score(plan: EnginePlan, input: EngineInput, start: Instant): Scored {
  const end = addMinutes(start, plan.durationMinutes);
  const local = toLocal(start, plan.zone);
  const meetup = interval(start, end);
  const byId = new Map(input.responses);

  const explicit: UserId[] = [];
  const flexible: UserId[] = [];

  // Iterated in `activeMemberIds` order, so the available list is stable.
  for (const userId of input.activeMemberIds) {
    const response = byId.get(userId);
    if (response === undefined) continue;

    if (response.status === 'flexible') {
      flexible.push(userId);
    } else if (response.status === 'windows' && response.windows.some((w) => contains(w, meetup))) {
      explicit.push(userId);
    }
  }

  const available = [...explicit, ...flexible].sort(
    (a, b) => input.activeMemberIds.indexOf(a) - input.activeMemberIds.indexOf(b),
  );
  const availableSet = new Set(available);
  const requiredMissing = plan.requiredMemberIds.filter((id) => !availableSet.has(id));

  return {
    start,
    end,
    localDate: local.date,
    localMinutes: local.minutesOfDay,
    available,
    explicitCount: explicit.length,
    flexibleCount: flexible.length,
    requiredMissing,
    // Step 3.
    eligible: requiredMissing.length === 0 && available.length >= plan.quorum,
  };
}

/**
 * Step 4 — the ranking, as a comparator so the order is one readable thing.
 *
 * More people first; then a set with at least one explicit answer ahead of a
 * flexible-only one, because "everyone said whatever suits" is weaker evidence
 * than "four people chose this"; then earlier.
 *
 * Earlier means earlier *on the clock people read*, which is not the same as
 * earlier by instant. On the day the clocks go back, 02:30 happens twice: the
 * second 02:30 is a later instant than the 02:00 that follows the first one,
 * so ordering by instant would list 02:30 above 02:00 and the screen would
 * show a list that runs backwards. Local date, then local minutes, then the
 * instant to separate the two occurrences of a repeated hour from each other.
 */
export function compareCandidates(a: Scored, b: Scored): number {
  if (a.available.length !== b.available.length) return b.available.length - a.available.length;

  const aHasExplicit = a.explicitCount > 0 ? 1 : 0;
  const bHasExplicit = b.explicitCount > 0 ? 1 : 0;
  if (aHasExplicit !== bHasExplicit) return bHasExplicit - aHasExplicit;

  if (a.localDate !== b.localDate) return a.localDate < b.localDate ? -1 : 1;
  if (a.localMinutes !== b.localMinutes) return a.localMinutes - b.localMinutes;

  return a.start - b.start;
}

/** Later on the wall clock, by the same reading `compareCandidates` uses. */
function isLater(a: Scored, b: Scored): boolean {
  if (a.localDate !== b.localDate) return a.localDate > b.localDate;
  if (a.localMinutes !== b.localMinutes) return a.localMinutes > b.localMinutes;
  return a.start > b.start;
}

/**
 * Step 5 — at most three, spread across dates.
 *
 * Take the best. After that, when the next few tie on attendance, prefer one on
 * a date not already offered: three times on one evening is one option wearing
 * three hats. Two picks never land on the same date within a duration of each
 * other, which would offer overlapping times.
 */
function select(ranked: readonly Scored[], plan: EnginePlan): Scored[] {
  const picked: Scored[] = [];
  const usedDates = new Set<LocalDate>();

  let remaining = [...ranked];
  while (picked.length < MAX_RESULTS && remaining.length > 0) {
    const best = remaining[0] as Scored;
    const tier = remaining.filter((c) => c.available.length === best.available.length);
    const chosen = tier.find((c) => !usedDates.has(c.localDate)) ?? best;

    picked.push(chosen);
    usedDates.add(chosen.localDate);

    remaining = remaining.filter(
      (c) =>
        c !== chosen &&
        // Never two on the same date within a duration of each other.
        !(
          c.localDate === chosen.localDate &&
          Math.abs(c.start - chosen.start) < plan.durationMinutes * 60_000
        ),
    );
  }
  return picked;
}

/**
 * Step 6 — why this option, given the ones above it.
 *
 * Each code is used once. When the natural description is already taken — the
 * artboard's third option is a weekend and one fewer, exactly like its second —
 * it falls back to `also_n_later`, which is what the design says: "Also four, a
 * day later".
 */
function explain(picked: readonly Scored[], firstCode: ExplanationCode): Explanation[] {
  const used = new Set<ExplanationCode>();
  const first = picked[0];

  return picked.map((candidate, index) => {
    const count = candidate.available.length;
    if (index === 0) {
      used.add(firstCode);
      return { code: firstCode, count };
    }

    const best = first as Scored;
    const fewer = best.available.length - count;
    const weekend = isWeekend(candidate.localDate);
    const later = isLater(candidate, best);

    // Every code that mentions time has to agree with the clock. Ranking is
    // attendance first, so a lower-attendance option can easily fall *earlier*
    // than the best one — a Friday of five above a Thursday of three — and
    // calling that Thursday "a day later" is simply wrong.
    const alsoN: ExplanationCode = later ? 'also_n_later' : 'also_n_sooner';

    let code: ExplanationCode;
    if (fewer === 0) {
      code = weekend
        ? 'same_attendance_weekend'
        : later
          ? 'same_attendance_later'
          : 'same_attendance_sooner';
    } else if (fewer === 1) {
      code = weekend ? 'one_fewer_weekend' : later ? 'one_fewer_later' : 'one_fewer_sooner';
    } else code = alsoN;

    if (used.has(code)) code = alsoN;
    used.add(code);
    return { code, count };
  });
}

/**
 * Step 7 — when nothing is eligible, the closest it got and the one rule that
 * stopped it.
 *
 * A single reason, not a list: the screen offers "lower the quorum", "widen the
 * window" or "close this attempt", and each of those answers one rule. A
 * missing required member is reported ahead of a quorum shortfall because
 * lowering the quorum would not help.
 */
function nearMissReason(scored: Scored, plan: EnginePlan): NearMissReason {
  const missing = scored.requiredMissing[0];
  if (missing !== undefined) return { kind: 'required_missing', userId: missing };
  return { kind: 'quorum_short', by: plan.quorum - scored.available.length };
}

export function generateCandidates(input: EngineInput): CandidateSet {
  const { plan } = input;

  const starts = enumerateCandidateStarts(plan, input.now);
  const scored = starts.map((start) => score(plan, input, start));

  const eligible = scored.filter((s) => s.eligible).sort(compareCandidates);
  const picked = select(eligible, plan);
  const explanations = explain(picked, 'best_attendance');

  const candidates: Candidate[] = picked.map((s, index) => ({
    start: s.start,
    end: s.end,
    availableUserIds: s.available,
    explicitCount: s.explicitCount,
    flexibleCount: s.flexibleCount,
    explanation: explanations[index] as Explanation,
  }));

  let nearMisses: NearMiss[] = [];
  // Only once somebody has answered. Before the first reply there is nothing to
  // be close to, and the screen is showing the waiting state, not a shortfall.
  if (candidates.length === 0 && input.responses.length > 0) {
    // Closest first: most people, then the same tie-breaks as a real ranking.
    //
    // A start nobody can make is not *near* anything, so it is never shown
    // beside one somebody can — offering it as the third best would say "and
    // here is a time with nobody", which answers no question the screen asks.
    // But when every answer was `none_work`, zero is as close as it got, and
    // "Closest: Tuesday, 0 of 5" is the sentence that earns the "widen the
    // window" button. Dropping it left that screen with nothing on it at all.
    const withSomeone = scored.filter((s) => s.available.length > 0);
    const closest = [...(withSomeone.length > 0 ? withSomeone : scored)].sort(compareCandidates);
    const pickedMisses = select(closest, plan);
    const firstMiss = pickedMisses[0];

    nearMisses = pickedMisses.map((s, index) => ({
      start: s.start,
      end: s.end,
      availableUserIds: s.available,
      reason: nearMissReason(s, plan),
      // Near-misses are not ranked against each other the way candidates are —
      // nothing here is on offer, so "one fewer, weekend" would be explaining a
      // choice nobody is being given. The design says "Closest", then "Also
      // three, a day later" — and, exactly as in `explain`, "later" has to be
      // true of the clock. Attendance outranks time here too, so the second
      // miss can sit before the first.
      explanation: {
        code:
          index === 0
            ? 'closest'
            : isLater(s, firstMiss as Scored)
              ? 'also_n_later'
              : 'also_n_sooner',
        count: s.available.length,
      },
    }));
  }

  return {
    scoringVersion: SCORING_VERSION,
    inputHash: inputHash(input),
    eligible: candidates,
    nearMisses,
    stats: {
      startsConsidered: starts.length,
      eligibleCount: eligible.length,
      respondedCount: input.responses.length,
      activeMemberCount: input.activeMemberIds.length,
    },
  };
}
