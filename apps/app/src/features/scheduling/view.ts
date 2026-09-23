import type { Member } from '../../components';
import { t } from '../../copy';
import type { PlanCandidates } from '../../data/scheduling';
import { nameList, numberWord } from './names';
import { namesOf, notAnswered } from './sentences';
import { deadlineOf, weekdayOf, zoneNoteOf } from './words';

/**
 * What the screens say around the cards: the header, the headline, the line
 * under it and the nudge (spec §5.6).
 *
 * Kept apart from the flows so that what a screen *says* can be read — and
 * tested — in one place, the way the availability editor's `view.ts` is. The
 * cards themselves are `cards.ts`; this re-exports them so a screen has one
 * place to import from.
 */

export { cardOf, cardsOf, exceptionOf, nearMissesOf, type CardView } from './cards';
export { listOf, namesWithYou, notAnswered } from './sentences';

export type HeaderView = {
  title: string;
  /** Everybody asked, with the people still to answer dashed. */
  members: Member[];
  /** What a screen reader hears instead, when reply state is not readable. */
  marksLabel: string | undefined;
  replied: string;
  closes: string;
  zoneNote: string | undefined;
};

export function headerOf(data: PlanCandidates): HeaderView {
  const replied = data.responded === null ? null : new Set(data.responded);
  const names = new Map(data.roster.map((m) => [m.userId, m.name]));
  // **No marks at all when reply state is not readable.** A mark with no
  // `waiting` flag is a mark `Marks` draws as answered, so a member looking at
  // a plan before options exist would have seen six filled squares beside
  // "1 of 6 replied" — a per-person fact the view deliberately withholds from
  // them (§5.6). The count beside them is the whole of what they may know.
  const members: Member[] =
    replied === null
      ? []
      : data.participants.map((id) => ({
          name: names.get(id) ?? t('candidates', 'someone'),
          waiting: !replied.has(id),
        }));

  return {
    title: data.title,
    members,
    marksLabel:
      replied === null
        ? t('candidates', 'asked_label', { count: data.participants.length })
        : undefined,
    replied: t('candidates', 'replied', { count: data.repliedCount, total: data.askedCount }),
    closes: data.repliesOpen
      ? t('candidates', 'closes', { deadline: deadlineOf(data.responseDeadline, data.zone) })
      : t('candidates', 'replies_closed'),
    zoneNote: zoneNoteOf(data.zone),
  };
}

/** "Thursday looks good for five of you." */
export function headlineOf(data: PlanCandidates): string {
  const top = data.candidates[0];
  if (top === undefined) return t('candidates', 'headline_waiting');
  return t('candidates', 'headline_ready', {
    day: weekdayOf(top.startsAt, data.zone),
    count: numberWord(top.availableUserIds.length),
  });
}

/**
 * What the organiser can do about the people still to answer, in one line.
 *
 * Nothing, once replies have closed: a plan stays `ready` past its deadline so
 * the organiser can decide (spec §8), but `replace_response` refuses an answer
 * then — so "wait until Tuesday" would be advice about a Tuesday that has gone,
 * about people who could not answer if they wanted to.
 */
export function leadOf(data: PlanCandidates): string {
  if (!data.repliesOpen) return t('candidates', 'lead_closed');
  const waiting = namesOf(data, notAnswered(data));
  const list = nameList(waiting);
  const deadline = deadlineOf(data.responseDeadline, data.zone);
  switch (list.kind) {
    case 'none':
      return t('candidates', 'lead_everyone');
    case 'one':
      return t('candidates', 'lead_one', { name: list.a, deadline });
    case 'two':
      return t('candidates', 'lead_two', { name: list.a, other: list.b, deadline });
    case 'three':
      return t('candidates', 'lead_three', {
        name: list.a,
        other: list.b,
        third: list.c,
        deadline,
      });
    case 'many':
      return t('candidates', 'lead_many', { count: waiting.length, deadline });
  }
}

/**
 * "Nudge Alex", "Nudge 5 people" — absent when everybody has answered, and
 * absent once replies have closed, because the message it sends asks for one.
 */
export function nudgeOf(data: PlanCandidates): string | undefined {
  if (!data.repliesOpen) return undefined;
  const waiting = namesOf(data, notAnswered(data));
  const list = nameList(waiting);
  switch (list.kind) {
    case 'none':
      return undefined;
    case 'one':
      return t('candidates', 'nudge_one', { name: list.a });
    case 'two':
      return t('candidates', 'nudge_two', { name: list.a, other: list.b });
    case 'three':
      return t('candidates', 'nudge_three', { name: list.a, other: list.b, third: list.c });
    case 'many':
      return t('candidates', 'nudge_many', { count: waiting.length });
  }
}

export { weekdayOf };
