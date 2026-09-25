import { type Instant, fromISO, handOffRefusal, oneMoreDay, toISO, userId } from '@circles/domain';

import { t } from '../../copy';
import type { HandOffCandidate, PlanCandidates } from '../../data/scheduling';
import { numberWord } from './names';
import { deadlineOf, weekdayOf } from './words';

/**
 * What the replies-closed screen says (spec §5.7, S2-05): the headline, the
 * button, and whether each of the two other ways out is open — worked out here
 * rather than in the screen, and from the domain rather than here, so that the
 * button a screen offers is the button the server would honour
 * (non-negotiable 2).
 */

/** Whether the organiser is looking at a plan whose replies closed with options on offer. */
export function isDeadlinePassed(data: PlanCandidates): boolean {
  return data.isOrganiser && data.view === 'ready' && !data.repliesOpen;
}

/** "Replies have closed. Thursday still works for five." */
export function deadlineHeadline(data: PlanCandidates): string {
  const top = data.candidates[0];
  if (top === undefined) return t('candidates', 'headline_waiting');
  return t('deadlinePassed', 'headline', {
    day: weekdayOf(top.startsAt, data.zone),
    count: numberWord(top.availableUserIds.length),
  });
}

export function deadlineLead(data: PlanCandidates): string {
  const top = data.candidates[0];
  if (top === undefined) return t('deadlinePassed', 'lead_none');
  return t('deadlinePassed', 'lead', { day: weekdayOf(top.startsAt, data.zone) });
}

/** "Lock in Thursday", for the option the organiser has selected. */
export function lockInLabel(
  data: PlanCandidates,
  selectedId: string | undefined,
): string | undefined {
  const row = data.candidates.find((c) => c.id === selectedId);
  if (row === undefined) return undefined;
  return t('deadlinePassed', 'lock_in', { day: weekdayOf(row.startsAt, data.zone) });
}

export type ExtensionView =
  | { available: true; title: string; body: string }
  | { available: false; title: string; body: string };

/**
 * "Give it one more day", and until when — or why not.
 *
 * `oneMoreDay` is the rule `public.extend_deadline` holds, asked with this
 * device's clock for the label only: the server works the deadline out again on
 * its own clock when the button is pressed, and a minute's difference is the
 * price of saying something concrete on the button.
 */
export function extensionOf(data: PlanCandidates, now: Instant): ExtensionView {
  const title = t('deadlinePassed', 'extend_title');
  const answer = oneMoreDay({
    current: fromISO(data.responseDeadline),
    latestStart: fromISO(data.latestStart),
    now,
    alreadyExtended: data.extendedThisRevision,
  });
  if (answer.ok) {
    return {
      available: true,
      title,
      body: t('deadlinePassed', 'extend_body', {
        deadline: deadlineOf(toISO(answer.value), data.zone),
      }),
    };
  }
  return {
    available: false,
    title,
    body:
      answer.error === 'already_extended'
        ? t('deadlinePassed', 'extend_used')
        : t('deadlinePassed', 'extend_no_time'),
  };
}

export type HandOffRow = {
  userId: string;
  name: string;
  /** Whether they can take it; a guest is shown, greyed, with the reason. */
  available: boolean;
  detail: string | undefined;
};

/**
 * The sheet's list: everybody who could be asked, the ones who cannot take it
 * greyed with why. `handOffRefusal` is the domain's half of the `hand_off`
 * transition's guard, so a row that is offered is a row the server accepts.
 */
export function handOffRowsOf(
  candidates: readonly HandOffCandidate[],
  organiserUserId: string | null,
): HandOffRow[] {
  const organiser = organiserUserId === null ? undefined : userId(organiserUserId);
  return candidates
    .map((member) => {
      const refusal = handOffRefusal(
        // `hand_off_candidates` lists active members the plan is asking, so
        // those two are true of everybody it returns; the saved place is what
        // varies.
        {
          userId: userId(member.userId),
          isMember: true,
          isParticipant: true,
          isPermanent: member.hasSavedPlace,
        },
        organiser,
      );
      return {
        userId: member.userId,
        name: member.name,
        available: refusal === undefined,
        detail:
          refusal === 'requires_saved_place' ? t('deadlinePassed', 'needs_saved_place') : undefined,
      };
    })
    .filter((row) => row.userId !== organiserUserId);
}
