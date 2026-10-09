import { t } from '../../copy';
import type { PlanCandidates } from '../../data/scheduling';
import { nameList } from './names';
import { widerWindow } from './unlock';
import { listOf, namesWithYou, notAnswered } from './view';
import { dateOf, weekdayOf } from './words';

/**
 * The sentences the organiser's screens assemble from more than one place —
 * a button that names a day, a line that names people, a warning that names
 * both. The card's own words are `cards.ts`; these are the ones around them.
 */

/** "Review Thursday" for whichever option is selected. */
export function reviewLabel(
  data: PlanCandidates,
  selectedId: string | undefined,
): string | undefined {
  const row = data.candidates.find((c) => c.id === selectedId);
  if (row === undefined) return undefined;
  return t('candidates', 'review', { day: weekdayOf(row.startsAt, data.zone) });
}

/**
 * The waiting screen's words.
 *
 * When the organiser's own times are the only ones in, the screen says so
 * ("Your times are in", "Just you so far") instead of counting a quorum
 * nobody has had the chance to reach, or claiming "everyone has answered"
 * of a circle of one (ADR 0026: a circle of one starts at three).
 */
export function waitingWords(data: PlanCandidates): {
  headline: string;
  body: string;
  answered: string;
  still: string | undefined;
} {
  const counted = t('waiting', 'answered', { count: data.repliedCount, total: data.askedCount });
  if (data.repliedCount === 0) {
    return {
      headline: t('waiting', 'headline_first'),
      body: t('waiting', 'body', { count: data.quorum }),
      answered: counted,
      still: stillToAnswer(data),
    };
  }
  const onlyMine =
    data.repliedCount === 1 && data.me !== undefined && data.responded?.includes(data.me) === true;
  if (onlyMine) {
    return {
      headline: t('waiting', 'headline_only_you'),
      body: t('waiting', 'body_only_you'),
      answered: t('waiting', 'answered_only_you'),
      still: undefined,
    };
  }
  return {
    headline: t('waiting', 'headline'),
    body: t('waiting', 'body', { count: data.quorum }),
    answered: counted,
    still: stillToAnswer(data),
  };
}

/**
 * "Still to answer: you and Tom."
 *
 * The reader is named "you" and put first: the organiser is usually one of the
 * people being asked (ADR 0026 has them answer their own plan right after
 * sharing it), and a screen that reads their own name back at them is a screen
 * that looks like it is talking about somebody else.
 */
export function stillToAnswer(data: PlanCandidates): string {
  const waiting = namesWithYou(data, notAnswered(data));
  const list = nameList(waiting);
  switch (list.kind) {
    case 'none':
      return t('waiting', 'still_none');
    case 'one':
      return t('waiting', 'still_one', { name: list.a });
    case 'two':
      return t('waiting', 'still_two', { name: list.a, other: list.b });
    case 'three':
      return t('waiting', 'still_three', { name: list.a, other: list.b, third: list.c });
    case 'many':
      return t('waiting', 'still_many', { name: list.a, other: list.b, count: list.rest });
  }
}

/**
 * "The plan would run to Sun 4 Oct. It becomes a new question, so everyone who
 * has answered is asked again: you, Nina and 4 others."
 *
 * The names are the ones `revise-plan`'s preview returned, not a list this
 * screen worked out: §5.3's promise is about what the server will actually do.
 */
export function widerWarning(
  data: PlanCandidates,
  askedAgain: string[] | undefined,
): string | undefined {
  if (askedAgain === undefined) return undefined;
  const day = dateOf(`${widerEnd(data)}T12:00:00.000Z`, 'UTC');
  const names = listOf(namesWithYou(data, askedAgain));
  // A plan with gaps is told it will ask about every day, not only the days
  // picked, before it does (ADR 0047).
  if (data.days !== undefined) {
    return names === undefined
      ? t('customWindow', 'wider_confirm_gaps_nobody', { day })
      : t('customWindow', 'wider_confirm_gaps', { day, name: names });
  }
  return names === undefined
    ? t('noQuorum', 'wider_confirm_body_nobody', { day })
    : t('noQuorum', 'wider_confirm_body', { day, name: names });
}

export function widerEnd(data: PlanCandidates): string {
  return widerWindow(data)?.end ?? data.windowEnd;
}
