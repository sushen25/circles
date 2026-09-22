import type { ExplanationCode } from '@circles/domain';

import type { Member } from '../../components';
import { t } from '../../copy';
import type { CandidateRow, PlanCandidates } from '../../data/scheduling';
import { nameList, numberWord, type NameList } from './names';
import { dateOf, deadlineOf, timeOf, weekdayOf, zoneNoteOf } from './words';

/**
 * The candidate screens' sentences, worked out from the rows (spec §5.6).
 *
 * Kept apart from the flows so that what the screens *say* can be read — and
 * tested — in one place, the way the availability editor's `view.ts` is. The
 * manifesto's test for this screen is that from a card alone a member can say
 * who is coming, who is not, who has not answered and why it ranks where it
 * does (§3.4), so each of those four is a value on `CardView` rather than
 * something a reader has to infer.
 *
 * The card vocabulary lives in the `candidates` namespace and is read from
 * there by the member and no-quorum screens too: the same option is described
 * on three screens, and three copies of "Best attendance" is one copy that
 * will drift.
 */

export type CardView = {
  /** The candidate's start instant, which is its id (S1-16). */
  id: string;
  /** "Best attendance". Absent for a code this build has no sentence for. */
  rank: string | undefined;
  /** "5 of 6", or "Nobody was free" when the answer is zero (ADR 0011). */
  count: string;
  date: string;
  time: string;
  /** Who can make it. Never a non-responder (§5.6). */
  members: Member[];
  /**
   * What a screen reader hears for those marks. The default announces reply
   * state, which is the wrong fact here: these marks mean "can make it".
   */
  membersLabel: string;
  /** "Doesn't work for Priya · Alex hasn't answered". */
  exception: string | undefined;
  recommended: boolean;
};

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

const RANK: Record<ExplanationCode, (count: number) => string> = {
  best_attendance: () => t('candidates', 'rank_best_attendance'),
  same_attendance_weekend: (count) => t('candidates', 'rank_same_weekend', { count }),
  same_attendance_sooner: (count) => t('candidates', 'rank_same_sooner', { count }),
  same_attendance_later: (count) => t('candidates', 'rank_same_later', { count }),
  one_fewer_weekend: () => t('candidates', 'rank_one_fewer_weekend'),
  one_fewer_sooner: () => t('candidates', 'rank_one_fewer_sooner'),
  one_fewer_later: () => t('candidates', 'rank_one_fewer_later'),
  also_n_sooner: (count) => t('candidates', 'rank_also_sooner', { count }),
  also_n_later: (count) => t('candidates', 'rank_also_later', { count }),
  closest: () => t('candidates', 'rank_closest'),
};

function marksOf(data: PlanCandidates, userIds: readonly string[]): Member[] {
  const names = new Map(data.roster.map((m) => [m.userId, m.name]));
  return userIds.map((id) => ({ name: names.get(id) ?? t('candidates', 'someone') }));
}

function namesOf(data: PlanCandidates, userIds: readonly string[]): string[] {
  const names = new Map(data.roster.map((m) => [m.userId, m.name]));
  return userIds.map((id) => names.get(id) ?? t('candidates', 'someone'));
}

/**
 * "you, Priya and 4 others" — a plain list of people, capped by the same
 * names-then-a-count rule as everything else on these screens.
 */
export function listOf(names: readonly string[]): string | undefined {
  return phrase(nameList(names), 'plain');
}

/** The names of some user ids, with the reader written as "you" and put first. */
export function namesWithYou(data: PlanCandidates, userIds: readonly string[]): string[] {
  const mine = data.me !== undefined && userIds.includes(data.me);
  return [
    ...(mine ? [t('candidates', 'you')] : []),
    ...namesOf(
      data,
      userIds.filter((id) => id !== data.me),
    ),
  ];
}

/** Who was asked and has not answered, in roster order. */
export function notAnswered(data: PlanCandidates): string[] {
  if (data.responded === null) return [];
  const replied = new Set(data.responded);
  return data.participants.filter((id) => !replied.has(id));
}

/**
 * The one line under a card that says who is missing and why.
 *
 * Two clauses, not one: "doesn't work for" and "hasn't answered" are different
 * facts about different people, and the manifesto's test asks a reader to tell
 * them apart without tapping. Each is capped by the same names-then-a-count
 * rule (`nameList`).
 */
export function exceptionOf(data: PlanCandidates, row: CandidateRow): string | undefined {
  const available = new Set(row.availableUserIds);
  const missing = data.participants.filter((id) => !available.has(id));
  if (missing.length === 0) return undefined;
  if (data.responded === null) return undefined;

  const replied = new Set(data.responded);
  const unavailable = namesOf(
    data,
    missing.filter((id) => replied.has(id)),
  );
  const unanswered = namesOf(
    data,
    missing.filter((id) => !replied.has(id)),
  );

  const first = unavailable.length === 0 ? undefined : phrase(nameList(unavailable), 'not');
  const second = unanswered.length === 0 ? undefined : phrase(nameList(unanswered), 'waiting');
  if (first === undefined) return second;
  if (second === undefined) return first;
  return t('candidates', 'exception_both', { first, second });
}

function phrase(list: NameList, kind: 'not' | 'waiting' | 'can' | 'plain'): string | undefined {
  const key =
    kind === 'not'
      ? NOT_KEYS
      : kind === 'can'
        ? CAN_KEYS
        : kind === 'plain'
          ? LIST_KEYS
          : WAITING_KEYS;
  switch (list.kind) {
    case 'none':
      return undefined;
    case 'one':
      return t('candidates', key.one, { name: list.a });
    case 'two':
      return t('candidates', key.two, { name: list.a, other: list.b });
    case 'three':
      return t('candidates', key.three, { name: list.a, other: list.b, third: list.c });
    case 'many':
      return t('candidates', key.many, { name: list.a, other: list.b, count: list.rest });
  }
}

const LIST_KEYS = {
  one: 'list_one',
  two: 'list_two',
  three: 'list_three',
  many: 'list_many',
} as const;
const NOT_KEYS = { one: 'not_one', two: 'not_two', three: 'not_three', many: 'not_many' } as const;
const CAN_KEYS = { one: 'can_one', two: 'can_two', three: 'can_three', many: 'can_many' } as const;
const WAITING_KEYS = {
  one: 'waiting_one',
  two: 'waiting_two',
  three: 'waiting_three',
  many: 'waiting_many',
} as const;

export function cardOf(
  data: PlanCandidates,
  row: CandidateRow,
  options: { recommended: boolean },
): CardView {
  const available = row.availableUserIds.length;
  return {
    id: row.id,
    rank:
      row.explanationCode === null ? undefined : RANK[row.explanationCode](row.explanationCount),
    count:
      available === 0
        ? t('candidates', 'nobody_free')
        : t('candidates', 'count', { count: available, total: data.askedCount }),
    date: dateOf(row.startsAt, data.zone),
    time: timeOf(row.startsAt, row.endsAt, data.zone),
    members: marksOf(data, row.availableUserIds),
    membersLabel:
      phrase(nameList(namesOf(data, row.availableUserIds)), 'can') ?? t('candidates', 'can_nobody'),
    exception: exceptionOf(data, row),
    recommended: options.recommended,
  };
}

/** The options on offer. Rank 1 is recommended and gets the accent border. */
export function cardsOf(data: PlanCandidates): CardView[] {
  return data.candidates.map((row) => cardOf(data, row, { recommended: row.rank === 1 }));
}

/** The near-misses. Nothing here is on offer, so nothing is recommended. */
export function nearMissesOf(data: PlanCandidates): CardView[] {
  return data.nearMisses.map((row) => cardOf(data, row, { recommended: false }));
}

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

/** What the organiser can do about the people still to answer, in one line. */
export function leadOf(data: PlanCandidates): string {
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

/** "Nudge Alex", "Nudge 5 people" — absent when everybody has answered. */
export function nudgeOf(data: PlanCandidates): string | undefined {
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
