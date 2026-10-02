import { toISO } from '@circles/domain';

import type { Member } from '../../components';
import { t } from '../../copy';
import type { Stretch } from '../../data/confirmation';
import type { PlanCandidates } from '../../data/scheduling';
import { dateWords } from '../availability/days';
import { nameList } from '../scheduling/names';
import { phrase } from '../scheduling/sentences';
import { dateOf, timeOf, zoneNoteOf } from '../scheduling/words';
import { named, stretchWords } from './stretch';
import { instantsOf, pickOf, type TimePick } from './time';

/**
 * The review screen's words for a time the organiser set (ADR 0050), in the
 * words the options' review uses (`review.ts`): the count, who can make it, who
 * cannot and who has not answered — and **one caution in place of the unanswered
 * warning**, saying that it is not one of the options.
 *
 * "This isn't one of the options, and the plan asked for at least 4. Jess, Sam
 * and Alex didn't put this time down. They'll see the plan and can say whether
 * they're coming." The organiser is among the names when their own times did not
 * cover it: they follow their own answer like anyone, and "You" comes first.
 */

export type OwnReviewView = {
  date: string;
  time: string;
  members: Member[];
  membersLabel: string;
  /** "3 of 6 can make it · Not Jess or Sam · Alex hasn't answered". */
  summary: string;
  zoneNote: string | undefined;
  warning: string;
  belowQuorum: boolean;
  outsidePlanDays: boolean;
  pick: TimePick;
};

export function ownReviewOf(
  data: PlanCandidates,
  stretch: Stretch,
  startsAt: string,
  endsAt: string,
): OwnReviewView {
  const pick = pickOf(startsAt, endsAt, data.zone);
  const words = stretchWords(data, stretch, pick);
  const { start } = instantsOf(pick, data.zone);

  const not = phrase(nameList(named(data, stretch.cannot)), 'not');
  const waiting = phrase(nameList(named(data, stretch.awaiting)), 'waiting');
  const exception =
    not === undefined || waiting === undefined
      ? (not ?? waiting)
      : t('candidates', 'exception_both', { first: not, second: waiting });

  const unsure = phrase(nameList(named(data, [...stretch.cannot, ...stretch.awaiting])), 'plain');
  const prefix = words.outsidePlanDays
    ? t('confirmReview', 'own_prefix_outside', { date: dateOf(toISO(start), data.zone) })
    : words.belowQuorum
      ? t('confirmReview', 'own_prefix_short', { quorum: data.quorum })
      : t('confirmReview', 'own_prefix');

  return {
    date: dateWords(pick.day, 'long'),
    time: timeOf(toISO(start), toISO(instantsOf(pick, data.zone).end), data.zone),
    members: words.marks,
    membersLabel: words.marksLabel,
    summary:
      exception === undefined
        ? t('confirmReview', 'summary', { count: stretch.available.length, total: data.askedCount })
        : t('confirmReview', 'summary_with', {
            count: stretch.available.length,
            total: data.askedCount,
            first: exception,
          }),
    zoneNote: zoneNoteOf(data.zone),
    warning: `${prefix} ${
      unsure === undefined
        ? t('confirmReview', 'own_everyone')
        : t('confirmReview', 'own_unsure', { names: unsure })
    }`,
    belowQuorum: words.belowQuorum,
    outsidePlanDays: words.outsidePlanDays,
    pick,
  };
}
