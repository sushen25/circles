import type { Member } from '../../components';
import { t } from '../../copy';
import type { PlanCandidates } from '../../data/scheduling';
import { nameList, type NameList } from './names';

/**
 * People, written into a sentence (spec §5.6, ADR 0012).
 *
 * One rule — `nameList`'s "up to three, then a count" — and four copy keys per
 * kind of sentence, so that "Not Priya, Tom and 5 others", "Priya, Tom and 5
 * others can make it" and "you, Priya and 4 others" are the same rule wearing
 * different words. They live together because the moment one of them grows a
 * fourth case the others have to as well.
 */

export function marksOf(data: PlanCandidates, userIds: readonly string[]): Member[] {
  const names = new Map(data.roster.map((m) => [m.userId, m.name]));
  return userIds.map((id) => ({ name: names.get(id) ?? t('candidates', 'someone') }));
}

export function namesOf(data: PlanCandidates, userIds: readonly string[]): string[] {
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

export function phrase(
  list: NameList,
  kind: 'not' | 'waiting' | 'can' | 'plain',
): string | undefined {
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
