import { MAX_WINDOW_DAYS, addDays, localDate, windowDays } from '@circles/domain';

import { t } from '../../copy';
import type { PlanCandidates } from '../../data/scheduling';
import { weekdayOf } from './words';

/**
 * "What would unlock it" — the three actions on the no-quorum screen, and the
 * one rule that explains why there is nothing to confirm (spec §5.6).
 *
 * The engine reports **one** blocking rule, not a list, and each action answers
 * one of them: a required member who cannot make it is not fixed by lowering
 * the quorum, so that case offers "change who has to be there" instead
 * (S1-16). Two things are never offered:
 *
 * - **A quorum below two.** "A meetup of one is not a meetup" is the floor the
 *   domain and the check constraint both hold, and near-misses can now be zero
 *   of N (ADR 0011) — so the arithmetic that would have produced "Lower to 0"
 *   produces nothing at all.
 * - **A quorum that is not lower.** The action exists to unlock a time; an
 *   equal or higher number unlocks nothing and `revise-plan` would refuse it as
 *   `nothing_to_change`.
 *
 * "Try a wider window" is the artboard's own row — "Ask about the next two
 * weeks instead" — rather than a way into the plan editor, and it means one
 * thing here: run the window out to the fourteen days the domain allows. Two
 * things withhold it:
 *
 * - **A plan already asking about a fortnight** has no wider window to try.
 *   Widening the *hours* is the editor's (S1-26): a form, not one tap.
 * - **Replies that have closed.** A wider window starts a new revision, and
 *   `revise_plan` refuses any re-ask whose deadline has already gone — "an
 *   organiser who reopens or re-asks has to say when replies close, which is
 *   the one thing they are in a position to know". Saying it is S2-05's
 *   "give it one more day", not this screen's; offering the action here would
 *   only ever produce `deadline_out_of_range`.
 */

/** Inclusive local dates, as the plan stores them. `revise-plan` parses them. */
export type PlanWindow = { start: string; end: string };

/** The smallest meetup the domain allows. `Quorum` in contracts holds the same. */
export const MIN_QUORUM = 2;

export type Unlock =
  | { kind: 'lower'; quorum: number; title: string; body: string }
  | { kind: 'required'; title: string; body: string }
  | { kind: 'wider'; window: PlanWindow; title: string; body: string }
  | { kind: 'close'; title: string; body: string };

/** The member a `required_missing` near-miss names, when that is the rule. */
export function requiredMissing(data: PlanCandidates): string | undefined {
  const reason = data.nearMisses[0]?.nearMissReason;
  if (reason?.kind !== 'required_missing') return undefined;
  const member = data.roster.find((m) => m.userId === reason.userId);
  return member?.name ?? t('candidates', 'someone');
}

/**
 * The number that would unlock the best near-miss: the most people any of them
 * has. `undefined` when no such number is both lower than the quorum and at
 * least two.
 */
export function lowerTarget(data: PlanCandidates): number | undefined {
  const best = data.nearMisses.reduce(
    (most, row) => Math.max(most, row.availableUserIds.length),
    0,
  );
  if (best < MIN_QUORUM || best >= data.quorum) return undefined;
  return best;
}

/** Why nothing is on offer, in one sentence. */
export function blockedBy(data: PlanCandidates): string {
  const name = requiredMissing(data);
  if (name !== undefined) return t('noQuorum', 'body_required', { name });
  return t('noQuorum', 'body_quorum', { count: data.quorum });
}

/**
 * The window run out to the fourteen days the domain allows, keeping the day it
 * starts on. `undefined` when it is already that wide.
 */
export function widerWindow(data: PlanCandidates): PlanWindow | undefined {
  const start = localDate(data.windowStart);
  const current = windowDays({ start, end: localDate(data.windowEnd) });
  if (current >= MAX_WINDOW_DAYS) return undefined;
  return { start: String(start), end: String(addDays(start, MAX_WINDOW_DAYS - 1)) };
}

export function unlocksOf(data: PlanCandidates): Unlock[] {
  const unlocks: Unlock[] = [];

  const name = requiredMissing(data);
  if (name !== undefined) {
    unlocks.push({
      kind: 'required',
      title: t('noQuorum', 'required_title'),
      body: t('noQuorum', 'required_body', { name }),
    });
  } else {
    const quorum = lowerTarget(data);
    if (quorum !== undefined) {
      const best = data.nearMisses.find((row) => row.availableUserIds.length === quorum);
      const day = best === undefined ? undefined : weekdayOf(best.startsAt, data.zone);
      unlocks.push({
        kind: 'lower',
        quorum,
        title: t('noQuorum', 'lower_title', { count: quorum }),
        body:
          day === undefined
            ? t('noQuorum', 'lower_body_plain', { count: quorum })
            : data.quorumChosen
              ? t('noQuorum', 'lower_body_chosen', { day })
              : t('noQuorum', 'lower_body', { day, count: quorum }),
      });
    }
  }

  const wider = data.repliesOpen ? widerWindow(data) : undefined;
  if (wider !== undefined) {
    unlocks.push({
      kind: 'wider',
      window: wider,
      title: t('noQuorum', 'wider_title'),
      body: t('noQuorum', 'wider_body', {
        count: MAX_WINDOW_DAYS,
        total: windowDays({ start: localDate(data.windowStart), end: localDate(data.windowEnd) }),
      }),
    });
  }
  unlocks.push({
    kind: 'close',
    title: t('noQuorum', 'close_title'),
    body: t('noQuorum', 'close_body'),
  });
  return unlocks;
}
