import { t } from '../../copy';
import type { ConfirmationRead } from '../../data/confirmation';
import { nameList } from '../scheduling/names';
import { phrase } from '../scheduling/sentences';
import type { ReviewFields } from './review';

/**
 * The edit screen's words and its one rule about when there is something to
 * save (ADR 0050).
 *
 * What saving does differs by what changed, and the screen says which, before:
 * a new place or note shows for everyone straight away; a moved time says who it
 * still works for and who is asked whether they can come. Neither asks anybody
 * for their times again.
 */

/** Whether the place or note on screen is not what the plan has. */
export function detailsChanged(fields: ReviewFields, confirmation: ConfirmationRead): boolean {
  return (
    fields.placeName !== confirmation.placeName ||
    fields.placeUrl !== confirmation.placeUrl ||
    fields.note !== confirmation.note
  );
}

/**
 * What saving would do, in one sentence.
 *
 * `previousWeekday` is the day the plan is leaving ("with Friday marked as
 * moved"), and `asked` is everyone the new time does not cover: whoever answered
 * otherwise and whoever has not answered, the organiser included when their own
 * times do not cover it, because they follow their own answer like anyone.
 */
export function editNoticeOf(input: {
  moved: boolean;
  previousWeekday: string;
  asked: readonly string[];
}): string {
  if (!input.moved) return t('editLocked', 'notice_place');
  const names = phrase(nameList(input.asked), 'plain');
  const tail =
    names === undefined
      ? t('editLocked', 'tail_nobody')
      : t('editLocked', input.asked.length === 1 ? 'tail_one' : 'tail_many', { names });
  return t('editLocked', 'notice_moved', { weekday: input.previousWeekday, tail });
}
