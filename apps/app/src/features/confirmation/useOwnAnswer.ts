import { t } from '../../copy';
import type { PlanConfirmation } from '../../data/confirmation';
import type { AttendanceAction } from './ConfirmedGuestScreen';
import { myAttendanceOf, type LockedIn } from './confirmed';
import { useAttendance } from './useAttendance';

/**
 * The reader's own "Going / Can't make it", on whichever confirmed screen
 * they are on (spec §5.7: "Every member … may correct it").
 *
 * The organiser is a member too, and usually one who is going — so their
 * screen carries the same answer and the same way to change it, not only the
 * member's.
 */
export type OwnAnswer = {
  /** "You're going" — absent for somebody who was never asked. */
  mine: { title: string; detail: string } | undefined;
  actions: AttendanceAction[];
  busy: boolean;
  problem: string | undefined;
};

export function useOwnAnswer(
  data: PlanConfirmation,
  confirmation: LockedIn,
  queryKey: string,
): OwnAnswer {
  const attendance = useAttendance(
    data.me === undefined
      ? undefined
      : {
          circleId: data.circleId,
          planId: data.planId,
          confirmationId: confirmation.id,
          me: data.me,
        },
    queryKey,
  );
  const mine = myAttendanceOf(data, confirmation, new Date());

  const actions: AttendanceAction[] = [];
  if (mine?.canGo === true) {
    actions.push({
      label: t('confirmedGuest', 'i_can_make_it'),
      onPress: () => attendance.change('going'),
    });
  }
  if (mine?.canCant === true) {
    actions.push({
      label:
        mine.status === 'going'
          ? t('confirmedGuest', 'i_cant_make_it_after_all')
          : t('confirmedGuest', 'i_cant_make_it'),
      onPress: () => attendance.change('cant'),
    });
  }

  return {
    mine:
      mine === undefined
        ? undefined
        : mine.status === 'going'
          ? {
              title: t('confirmedGuest', 'youre_going'),
              detail: t('confirmedGuest', 'tap_below_if_that_changes'),
            }
          : mine.status === 'cant'
            ? {
                title: t('confirmedGuest', 'you_cant'),
                detail: t('confirmedGuest', 'tap_below_if_that_changes'),
              }
            : {
                title: t('confirmedGuest', 'you_unsaid'),
                detail: t('confirmedGuest', 'say_below'),
              },
    actions,
    busy: attendance.busy,
    problem: attendance.problem,
  };
}
