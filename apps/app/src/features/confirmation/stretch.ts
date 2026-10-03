import { ownTimeCautions, toISO } from '@circles/domain';

import type { Member } from '../../components';
import { t } from '../../copy';
import type { Stretch } from '../../data/confirmation';
import type { PlanCandidates } from '../../data/scheduling';
import { nameList } from '../scheduling/names';
import { phrase } from '../scheduling/sentences';
import { dateOf } from '../scheduling/words';
import { instantsOf, planShape, type TimePick } from './time';

/**
 * Who a stretch works for, in the words the candidate cards use (ADR 0050).
 *
 * "You, Priya and Tom can make it · Doesn't work for Jess or Sam · Alex hasn't
 * answered": the same three clauses and the same names-then-a-count rule as an
 * option's card (`cards.ts`), so a time the organiser picked reads like a time
 * the engine offered. The *who* is the database's, by the engine's own rule
 * (`stretch_availability`); this only says it, and says the cautions.
 *
 * The caution is text, never colour alone, and only when it applies: below the
 * plan's number, or on a day the plan never asked about. When both hold the day
 * is the one said, because it is the larger surprise and it already means nobody
 * said either way.
 */

export type StretchView = {
  /** "3 of 6 can make it". */
  count: string;
  /** The whole line, said once and live-announced as the time changes. */
  line: string;
  /** Who can make it, as the marks; those who have not answered, dashed. */
  marks: Member[];
  /** What the marks announce. */
  marksLabel: string;
  /** Absent unless one applies. */
  caution: string | undefined;
  /** The same two facts, for the confirmation and the analytics. */
  belowQuorum: boolean;
  outsidePlanDays: boolean;
  /**
   * The people the time does not cover: answered otherwise, or not answered. The
   * reader is left out: they chose the time, and the sentences that use this say
   * who else is asked.
   */
  notGoing: string[];
};

type Words = Pick<PlanCandidates, 'roster' | 'me'>;

function nameOf(data: Words, id: string): string {
  return data.roster.find((m) => m.userId === id)?.name ?? t('candidates', 'someone');
}

/**
 * The reader is "You", first, wherever they stand in the circle: capitalised at
 * the start of a sentence ("You, Priya and Tom can make it"), plain inside one
 * ("Not you, Jess or Sam").
 */
export function named(data: Words, ids: readonly string[], opening = false): string[] {
  const mine = data.me !== undefined && ids.includes(data.me);
  return [
    ...(mine ? [opening ? t('setTime', 'you') : t('candidates', 'you')] : []),
    ...ids.filter((id) => id !== data.me).map((id) => nameOf(data, id)),
  ];
}

export function stretchWords(data: PlanCandidates, stretch: Stretch, pick: TimePick): StretchView {
  const available = stretch.available;
  const { start } = instantsOf(pick, data.zone);
  const cautions = ownTimeCautions(
    { ...planShape(data), quorum: data.quorum },
    start,
    available.length,
  );

  const can = phrase(nameList(named(data, available, true)), 'can');
  const not = phrase(nameList(named(data, stretch.cannot)), 'not');
  const waiting = phrase(nameList(named(data, stretch.awaiting)), 'waiting');
  const date = dateOf(toISO(start), data.zone);

  // A day the plan never asked about: whoever answered times for other days has
  // not said no to this one, so only the people who are easy are named.
  const clauses = cautions.outsidePlanDays
    ? available.length === 0
      ? [t('setTime', 'outside_none')]
      : [can, t('setTime', 'outside_rest')]
    : [can ?? t('setTime', 'nobody_can'), not, waiting];

  return {
    count: t('setTime', 'who_count', { count: available.length, total: data.askedCount }),
    line: clauses.filter((part): part is string => part !== undefined).join(' · '),
    marks: [
      ...available.map((id) => ({ name: nameOf(data, id) })),
      ...stretch.awaiting.map((id) => ({ name: nameOf(data, id), waiting: true })),
    ],
    marksLabel: can ?? t('candidates', 'can_nobody'),
    caution: cautions.outsidePlanDays
      ? t('setTime', 'caution_outside', { date })
      : cautions.belowQuorum
        ? t('setTime', 'caution_short', { count: available.length, quorum: data.quorum })
        : undefined,
    belowQuorum: cautions.belowQuorum,
    outsidePlanDays: cautions.outsidePlanDays,
    notGoing: [...stretch.cannot, ...stretch.awaiting]
      .filter((id) => id !== data.me)
      .map((id) => nameOf(data, id)),
  };
}
