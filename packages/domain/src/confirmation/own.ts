/**
 * The organiser sets the final plan (ADR 0051): lock in any day and time, move
 * a locked-in time, and edit its place and note.
 *
 * The same shape as `confirm`, and for the same reason: whether the organiser is
 * *allowed* is the state machine's, which the SQL mirror is generated from, and
 * these functions are what `planning.transition_plan` does to the confirmation
 * afterwards. Nothing here holds a reference a later answer can change: who can
 * make the time is **copied** into the confirmation, and an answer arriving
 * after lock-in changes nothing (spec §8.2).
 *
 * **"A confirmed time never changes as a side effect of a later response"** is
 * still true. An organiser moving it on purpose is not a side effect of a
 * response, and a move supersedes the confirmation and writes a new one in the
 * same revision, so the record still says Friday was moved and there is still
 * at most one active confirmation.
 */

import type { Response } from '../availability/types.js';
import type { UserId } from '../circles/types.js';
import { type Actor, type TransitionError, canTransition } from '../planning/state-machine.js';
import type { Plan, PlanId } from '../planning/types.js';
import { whoCanMake } from '../scheduling/stretch.js';
import type { MemberResponse } from '../scheduling/types.js';
import { type Instant } from '../shared/instant.js';
import { type Result, err, ok } from '../shared/result.js';
import { type ConfirmationDetails, supersede } from './confirm.js';
import { isLink } from './links.js';
import { ownTimeCautions } from './own-time.js';
import { PLACE_NAME_MAX_LENGTH } from './confirm.js';
import { type Confirmation, type ConfirmationId, NOTE_MAX_LENGTH } from './types.js';

export type OwnConfirmErrorCode =
  | TransitionError['code']
  | 'stale_availability'
  | 'confirmation_not_active'
  | 'meetup_has_ended'
  | 'note_too_long'
  | 'place_name_too_long'
  | 'place_url_not_a_link';

export type OwnConfirmError = {
  readonly code: OwnConfirmErrorCode;
  readonly planId: PlanId;
  /** The plan's input version, which is what a `stale_availability` caller has to catch up to. */
  readonly inputVersion: number;
};

/**
 * The answers to this revision, in the engine's own shape, for the people the
 * plan is asking. Other revisions are ignored, as `deriveAttendance` ignores
 * them: an edit invalidated them.
 */
export function engineResponses(
  responses: readonly Response[],
  planId: PlanId,
  revision: number,
): readonly (readonly [UserId, MemberResponse])[] {
  return responses
    .filter((r) => r.planId === planId && r.revision === revision)
    .map((r) => [r.userId, { status: r.status, windows: r.windows } as MemberResponse] as const);
}

type Common = {
  readonly plan: Plan;
  /** Every answer there is, of any revision; this reads the plan's current one. */
  readonly responses: readonly Response[];
  /** The people the plan is asking, in members-list order. */
  readonly members: readonly UserId[];
  readonly start: Instant;
  readonly end: Instant;
  /**
   * The plan's input version as the screen read it when it showed who the time
   * works for. If an answer has landed since, the names on the screen are not
   * the names that would be frozen, and the request is refused so the screen can
   * update and ask again (ADR 0051 §7). The own-time counterpart of
   * `expected_set_id`.
   */
  readonly expectedInputVersion: number;
  readonly actor: Actor;
  readonly now: Instant;
};

export type ConfirmOwnRequest = Common & {
  readonly details: ConfirmationDetails;
  /** Minted by the caller: a pure function cannot generate an id. */
  readonly confirmationId: ConfirmationId;
};

export type OwnConfirmed = {
  readonly confirmation: Confirmation;
  /** The plan in its `confirmed` state, from the state machine. */
  readonly plan: Plan;
};

function detailProblem(details: ConfirmationDetails): OwnConfirmErrorCode | undefined {
  if ((details.note?.length ?? 0) > NOTE_MAX_LENGTH) return 'note_too_long';
  if ((details.placeName?.length ?? 0) > PLACE_NAME_MAX_LENGTH) return 'place_name_too_long';
  if (details.placeUrl !== undefined && !isLink(details.placeUrl)) return 'place_url_not_a_link';
  return undefined;
}

function refuse(plan: Plan, code: OwnConfirmErrorCode): Result<OwnConfirmError, never> {
  return err({ code, planId: plan.id, inputVersion: plan.inputVersion });
}

/**
 * The frozen set for a stretch: who can make it, read from this revision's
 * answers by the engine's own rule, and whether that is below the plan's number.
 */
function freezeStretch(common: Common) {
  const { plan, responses, members, start, end } = common;
  const { available } = whoCanMake(
    { responses: engineResponses(responses, plan.id, plan.revision), activeMemberIds: members },
    start,
    end,
  );
  const { belowQuorum } = ownTimeCautions(plan, start, available.length);
  return { available, belowQuorum };
}

/**
 * Lock in any day and time. From `collecting` or `ready`.
 *
 * Order matters only for which refusal is reported first: the machine's (who,
 * what state, whether the time is a valid one), then whether the screen was
 * current, then the details.
 */
export function confirmOwn(request: ConfirmOwnRequest): Result<OwnConfirmError, OwnConfirmed> {
  const { plan, start, end, actor, now, details, confirmationId } = request;

  const transition = canTransition(plan, 'confirm_own', {
    actor,
    ownTime: { start, end, now },
  });
  if (!transition.ok) return refuse(plan, transition.error.code);
  if (request.expectedInputVersion !== plan.inputVersion) {
    return refuse(plan, 'stale_availability');
  }
  const problem = detailProblem(details);
  if (problem !== undefined) return refuse(plan, problem);

  const { available, belowQuorum } = freezeStretch(request);
  return ok({
    confirmation: {
      id: confirmationId,
      planId: plan.id,
      revision: plan.revision,
      candidate: { start, end, availableUserIds: available },
      placeName: details.placeName,
      placeUrl: details.placeUrl,
      note: details.note,
      confirmedBy: actor.userId as UserId,
      status: 'active',
      confirmedAt: now,
      ownTime: true,
      belowQuorum,
      calendarUid: confirmationId,
      calendarSequence: 0,
    },
    plan: transition.value,
  });
}

export type MoveRequest = Common & {
  /** The active confirmation being moved. */
  readonly confirmation: Confirmation;
  /** Minted by the caller, for the confirmation the move writes. */
  readonly confirmationId: ConfirmationId;
};

export type Moved = OwnConfirmed & {
  /** The confirmation that was active, now superseded and still holding the time it had. */
  readonly superseded: Confirmation;
};

/** Whether the meetup has already finished: past that, there is nothing to edit (ADR 0051). */
function hasEnded(confirmation: Confirmation, now: Instant): boolean {
  return confirmation.candidate.end <= now;
}

/**
 * Move a locked-in time. The plan stays `confirmed` in the same revision; the
 * active confirmation is superseded for the reason `move` and a new one is
 * written, so "Friday was moved" stays true in the record.
 *
 * Who is going is derived again from this revision's answers by the own-time
 * rule (`deriveAttendance` on the new confirmation): whoever's times cover the
 * new stretch is going with nothing to do, everyone else is to confirm, and a
 * status somebody set by hand for the old time does not carry over. The calendar
 * entry keeps its identity and its sequence rises, so a calendar moves it.
 */
export function moveConfirmed(request: MoveRequest): Result<OwnConfirmError, Moved> {
  const { plan, confirmation, start, end, actor, now, confirmationId } = request;

  const transition = canTransition(plan, 'move_confirmed', {
    actor,
    ownTime: { start, end, now },
  });
  if (!transition.ok) return refuse(plan, transition.error.code);
  if (confirmation.status !== 'active') return refuse(plan, 'confirmation_not_active');
  if (hasEnded(confirmation, now)) return refuse(plan, 'meetup_has_ended');
  if (request.expectedInputVersion !== plan.inputVersion) {
    return refuse(plan, 'stale_availability');
  }

  const replaced = supersede(confirmation, 'move');
  if (!replaced.ok) return refuse(plan, 'confirmation_not_active');

  const { available, belowQuorum } = freezeStretch(request);
  return ok({
    superseded: replaced.value,
    confirmation: {
      ...confirmation,
      id: confirmationId,
      candidate: { start, end, availableUserIds: available },
      confirmedBy: actor.userId as UserId,
      status: 'active',
      confirmedAt: now,
      ownTime: true,
      belowQuorum,
      movedFrom: { start: confirmation.candidate.start, end: confirmation.candidate.end },
      calendarUid: confirmation.calendarUid ?? confirmation.id,
      calendarSequence: (confirmation.calendarSequence ?? 0) + 1,
    },
    plan: transition.value,
  });
}

export type EditRequest = {
  readonly plan: Plan;
  readonly confirmation: Confirmation;
  /** The whole of what the place and note should now say; absent clears it. */
  readonly details: ConfirmationDetails;
  readonly actor: Actor;
  readonly now: Instant;
};

/**
 * Change only the place or the note. The active confirmation is updated in
 * place: nobody's status changes, and nothing is sent.
 */
export function editConfirmed(request: EditRequest): Result<OwnConfirmError, OwnConfirmed> {
  const { plan, confirmation, details, actor, now } = request;

  const transition = canTransition(plan, 'edit_confirmed', { actor });
  if (!transition.ok) return refuse(plan, transition.error.code);
  if (confirmation.status !== 'active') return refuse(plan, 'confirmation_not_active');
  if (hasEnded(confirmation, now)) return refuse(plan, 'meetup_has_ended');
  const problem = detailProblem(details);
  if (problem !== undefined) return refuse(plan, problem);

  return ok({
    confirmation: {
      ...confirmation,
      placeName: details.placeName,
      placeUrl: details.placeUrl,
      note: details.note,
    },
    plan: transition.value,
  });
}
