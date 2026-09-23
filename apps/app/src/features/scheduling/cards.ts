import type { ExplanationCode } from '@circles/domain';

import type { Member } from '../../components';
import { t } from '../../copy';
import type { CandidateRow, PlanCandidates } from '../../data/scheduling';
import { nameList } from './names';
import { marksOf, namesOf, phrase } from './sentences';
import { dateOf, timeOf } from './words';

/**
 * One option, as a card (spec §5.6, manifesto §3.4).
 *
 * The manifesto's test for this screen is that from a card alone a member can
 * say who is coming, who is not, who has not answered and why it ranks where it
 * does — so each of those four is a value on `CardView` rather than something a
 * reader has to infer, and `label` says all of them out loud for a reader who
 * hears the screen rather than sees it.
 *
 * The card vocabulary lives in the `candidates` copy namespace and is read from
 * there by the member and no-quorum screens too: the same option is described
 * on three screens, and three copies of "Best attendance" is one copy that will
 * drift.
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
  /**
   * The whole card in one sentence, for when it is a button.
   *
   * A `Pressable` with an `aria-label` **replaces** the name a screen reader
   * would have built from what is inside it, so a label of only the date and
   * time would have hidden the rank, the count, who can make it and who cannot
   * — which is the entire argument the card exists to make (manifesto §3.4).
   */
  label: string;
  recommended: boolean;
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

export function cardOf(
  data: PlanCandidates,
  row: CandidateRow,
  options: { recommended: boolean },
): CardView {
  const available = row.availableUserIds.length;
  const card: CardView = {
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
    label: '',
    recommended: options.recommended,
  };
  // Sentences the card already says, in the order it says them. Only the
  // separators are written here, and a separator carries no voice.
  return {
    ...card,
    label: [card.rank, `${card.date}, ${card.time}`, card.count, card.membersLabel, card.exception]
      .filter((part): part is string => part !== undefined)
      .join('. '),
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
