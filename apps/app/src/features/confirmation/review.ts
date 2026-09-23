import { ConfirmMeetupRequest } from '@circles/contracts';
import {
  NOTE_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
  fromISO,
  toLocal,
  zone as toZone,
} from '@circles/domain';

import type { Member } from '../../components';
import { t } from '../../copy';
import type { CandidateRow, PlanCandidates } from '../../data/scheduling';
import { dateWords } from '../availability/days';
import { exceptionOf } from '../scheduling/cards';
import { nameList } from '../scheduling/names';
import { marksOf, namesOf, notAnswered, phrase } from '../scheduling/sentences';
import { timeOf, zoneNoteOf } from '../scheduling/words';

/**
 * The review screen's words, from the same read the options came from
 * (spec §5.7).
 *
 * Everything the organiser is about to freeze is on this screen in the words
 * the candidate card used, so the option they tapped and the option they lock
 * in cannot read differently: the count, who can make it, who is missing and
 * why, and who has not answered at all.
 */

export type ReviewView = {
  /** "Thursday 17 September". */
  date: string;
  time: string;
  /** Who can make it — never a non-responder (§5.6). */
  members: Member[];
  membersLabel: string;
  /** "5 of 6 can make it · Alex hasn't answered". */
  summary: string;
  zoneNote: string | undefined;
  /**
   * Who has not replied, as a warning. The reader is left out: an organiser
   * who has not answered their own plan does not need telling, and "you
   * haven't" is a sentence the voice rules forbid.
   */
  warning: string | undefined;
};

/** The option the organiser picked, if it is still one on offer. */
export function candidateIn(data: PlanCandidates, candidateId: string): CandidateRow | undefined {
  if (data.view !== 'ready') return undefined;
  return data.candidates.find((c) => c.id === candidateId || sameInstant(c.id, candidateId));
}

/** The param is ISO, and ISO has more than one spelling of the same instant. */
function sameInstant(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return !Number.isNaN(x) && x === y;
}

export function reviewOf(data: PlanCandidates, row: CandidateRow): ReviewView {
  const available = row.availableUserIds.length;
  const exception = exceptionOf(data, row);
  const waiting = namesOf(
    data,
    notAnswered(data).filter((id) => id !== data.me),
  );
  return {
    date: dateWords(toLocal(fromISO(row.startsAt), toZone(data.zone)).date, 'long'),
    time: timeOf(row.startsAt, row.endsAt, data.zone),
    members: marksOf(data, row.availableUserIds),
    membersLabel:
      phrase(nameList(namesOf(data, row.availableUserIds)), 'can') ?? t('candidates', 'can_nobody'),
    summary:
      exception === undefined
        ? t('confirmReview', 'summary', { count: available, total: data.askedCount })
        : t('confirmReview', 'summary_with', {
            count: available,
            total: data.askedCount,
            first: exception,
          }),
    zoneNote: zoneNoteOf(data.zone),
    warning: warningOf(waiting),
  };
}

function warningOf(names: readonly string[]): string | undefined {
  const list = nameList(names);
  switch (list.kind) {
    case 'none':
      return undefined;
    case 'one':
      return t('confirmReview', 'warn_one', { name: list.a });
    case 'two':
      return t('confirmReview', 'warn_two', { name: list.a, other: list.b });
    case 'three':
      return t('confirmReview', 'warn_three', { name: list.a, other: list.b, third: list.c });
    case 'many':
      return t('confirmReview', 'warn_many', { name: list.a, other: list.b, count: list.rest });
  }
}

export type ReviewForm = {
  placeName: string;
  placeUrl: string;
  note: string;
};

export type ReviewFields = {
  placeName: string | undefined;
  placeUrl: string | undefined;
  note: string | undefined;
  /** Why the map link would be refused, before it is sent. */
  placeUrlError: string | undefined;
  /** "12 of 280". */
  noteCount: string;
  valid: boolean;
};

/**
 * What the form would send, and whether `confirm-meetup` would take it.
 *
 * Judged by **the request schema's own fields**, not a second copy of their
 * rules: the link check, the 2,048 a link may run to, the 280 of a note. A
 * rule restated here is a rule that drifts, and a value the screen allows and
 * the contract refuses fails as a generic error with no field named.
 */
export function fieldsOf(form: ReviewForm): ReviewFields {
  const placeName = form.placeName.trim();
  const placeUrl = form.placeUrl.trim();
  const note = form.note.trim();
  const fields = ConfirmMeetupRequest.shape;
  const urlBad = placeUrl !== '' && !fields.place_url.safeParse(placeUrl).success;
  return {
    placeName: placeName === '' ? undefined : placeName,
    placeUrl: placeUrl === '' ? undefined : placeUrl,
    note: note === '' ? undefined : note,
    placeUrlError: urlBad ? t('confirmReview', 'place_url_invalid') : undefined,
    noteCount: t('confirmReview', 'note_count', {
      count: form.note.length,
      total: NOTE_MAX_LENGTH,
    }),
    valid:
      !urlBad &&
      (note === '' || fields.note.safeParse(note).success) &&
      (placeName === '' || fields.place_name.safeParse(placeName).success),
  };
}

/** The longest map link the request takes — read from the schema, not restated. */
export const PLACE_URL_MAX_LENGTH: number | undefined =
  ConfirmMeetupRequest.shape.place_url.unwrap().maxLength ?? undefined;

export { NOTE_MAX_LENGTH, PLACE_NAME_MAX_LENGTH };
