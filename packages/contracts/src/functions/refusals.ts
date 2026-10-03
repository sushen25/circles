import type {
  ConfirmErrorCode,
  ExtensionRefusal,
  OutcomeErrorCode,
  OwnConfirmErrorCode,
  PresetError,
  QuietRefusal,
  TransitionErrorCode,
} from '@circles/domain';
import type { ProblemReason } from './shared.js';

/**
 * Every name the domain gives a refusal, and the same name on the wire.
 *
 * A refusal is named three times: by the domain, by the SQL that mirrors it
 * (`planning.transition_plan` raises the domain's codes as text), and by the
 * wire's `ProblemReason`. Before this table the third was a list somebody kept
 * in step by hand, and a code missing from it reached the person as a 500 with
 * no reason (SUS-142: `needs_permanent_identity`, `already_has_organiser`,
 * `not_keen_initiator_or_owner`, `threshold_not_reached`).
 *
 * The `Record` is total over the union below, so adding a code to any of those
 * types without deciding what the wire calls it fails `pnpm typecheck`.
 *
 * `null` is a decision too: the request schema refuses it first, so the domain
 * is never asked and nothing is raised for the wire to name.
 */
export type DomainRefusal =
  | TransitionErrorCode
  | QuietRefusal
  | PresetError
  | ExtensionRefusal
  | ConfirmErrorCode
  | OwnConfirmErrorCode
  | OutcomeErrorCode
  | 'attendance_not_reversible'
  | 'attendance_too_early'
  | 'attendance_wrong_confirmation';

export const WIRE_REASON_OF: Readonly<Record<DomainRefusal, ProblemReason | null>> = {
  // The state machine's own.
  wrong_state: 'wrong_state',
  not_a_member: 'not_a_member',
  not_the_organiser: 'not_the_organiser',
  not_the_organiser_or_owner: 'not_the_organiser_or_owner',
  not_the_initiator: 'not_the_initiator',
  not_keen_initiator_or_owner: 'not_keen_initiator_or_owner',
  needs_permanent_identity: 'needs_permanent_identity',
  already_has_organiser: 'already_has_organiser',
  needs_candidate: 'needs_candidate',
  threshold_not_reached: 'threshold_not_reached',
  plan_in_progress: 'plan_in_progress',
  plan_is_finished: 'plan_is_finished',
  needs_own_time: 'needs_own_time',
  own_time_off_the_half_hour: 'own_time_off_the_half_hour',
  own_time_ends_before_it_starts: 'own_time_ends_before_it_starts',
  own_time_too_short: 'own_time_too_short',
  own_time_too_long: 'own_time_too_long',
  own_time_in_the_past: 'own_time_in_the_past',
  own_time_too_far_ahead: 'own_time_too_far_ahead',
  already_the_organiser: 'already_the_organiser',
  not_a_participant: 'not_a_participant',
  requires_saved_place: 'requires_saved_place',

  // The quiet ask's. Two are the domain's older spelling of a wire reason.
  needs_saved_place: 'requires_saved_place',
  needs_membership: 'not_a_member',
  circle_archived: 'circle_archived',
  quiet_asks_muted: 'quiet_asks_muted',
  nobody_to_ask: 'nobody_to_ask',
  already_asking: 'already_asking',
  circle_ask_limit: 'circle_ask_limit',
  not_quiet: 'not_quiet',
  interest_closed: 'interest_closed',
  initiator_is_keen: 'initiator_is_keen',
  stop_time_not_reached: 'stop_time_unavailable',
  no_stop_time: 'stop_time_unavailable',
  not_keen: 'not_keen',
  not_the_owner: 'not_the_owner',
  deadline_not_passed: 'deadline_not_passed',

  // Windows and presets.
  window_has_passed: 'window_has_passed',
  too_late_for_tonight: 'too_late_for_tonight',
  window_too_long: 'window_too_long',
  window_backwards: 'window_backwards',
  band_shorter_than_meetup: 'band_shorter_than_meetup',
  days_invalid: 'days_invalid',
  band_backwards: 'band_backwards',
  band_unaligned: 'band_unaligned',
  band_out_of_day: 'band_out_of_day',

  // Extending replies.
  already_extended: 'already_extended',
  no_time_to_extend: 'no_time_to_extend',

  // Confirming. A set built for another plan, or for an older version of this
  // one, is the same thing to the person: what they were shown has moved.
  wrong_plan: 'stale_candidates',
  stale_candidates: 'stale_candidates',
  stale_input_version: 'stale_candidates',
  stale_scoring_version: 'stale_candidates',
  candidate_not_eligible: 'needs_candidate',
  candidate_has_passed: 'candidate_has_passed',
  stale_availability: 'stale_availability',
  confirmation_not_active: 'confirmation_not_active',
  meetup_has_ended: 'meetup_has_ended',
  stale_confirmation: 'stale_confirmation',
  outcome_too_early: 'outcome_too_early',
  attendance_not_reversible: 'attendance_not_reversible',
  attendance_too_early: 'attendance_too_early',
  attendance_wrong_confirmation: 'attendance_confirmation_missing',

  // Refused by the request schema (length, link shape) before the domain runs.
  note_too_long: null,
  place_name_too_long: null,
  place_url_not_a_link: null,
};
