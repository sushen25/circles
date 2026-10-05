import { ProblemReason } from '@circles/contracts';
import { describe, expect, it } from 'vitest';

import { t } from '../../copy';
import { FunctionError } from '../../data/functions';
import { refusalOf } from './problems';
import { quietRefusalOf } from './quietProblems';

function refused(reason: string): FunctionError {
  return new FunctionError(
    { error: 'conflict', reason, message: 'x', reference: 'R1' } as never,
    'x',
  );
}

const GENERIC = t('planSetup', 'problem_generic');

describe('the refusals SUS-142 gave a reason to', () => {
  it('an anonymous caller is sent to save their place, not to a generic', () => {
    expect(refusalOf(refused('needs_permanent_identity')).needsSavedPlace).toBe(true);
    expect(quietRefusalOf(refused('needs_permanent_identity')).needsSavedPlace).toBe(true);
  });

  it('a second organiser is told somebody got there first, and the view is read again', () => {
    const out = quietRefusalOf(refused('already_has_organiser'));
    expect(out.message).toBe(t('quiet', 'refused_taken'));
    expect(out.reread).toBe(true);
    expect(out.conclusive).toBe(true);
  });

  it('somebody who was not keen is told only the keen can pick', () => {
    const out = quietRefusalOf(refused('not_keen_initiator_or_owner'));
    expect(out.message).toBe(t('quiet', 'refused_not_keen'));
    expect(out.reread).toBe(true);
  });

  it('too few keen says so, in the voice of the others, with no exclamation mark', () => {
    const out = quietRefusalOf(refused('threshold_not_reached'));
    expect(out.message).toBe(t('quiet', 'refused_not_enough_keen'));
    expect(out.message).not.toContain('!');
    expect(out.reread).toBe(true);
  });
});

describe('every reason either has a sentence on the planning screens or is listed', () => {
  // Reasons the planning and quiet screens deliberately leave to the generic
  // sentence, because another screen owns them (the join flow, the review
  // screen, the outcome sheet) or the person never meets them. A new reason
  // that is in neither place fails here, so it is a decision, not an accident.
  const OTHER_SCREENS_OWN = new Set<string>([
    'invite_inactive',
    'circle_full',
    'duplicate_name',
    'member_not_found',
    'target_is_permanent',
    'caller_is_permanent',
    'already_member',
    'reattach_limit',
    'token_invalid',
    'source_is_permanent',
    'destination_is_not_permanent',
    'display_name_unusable',
    'idempotency_mismatch',
    'in_progress',
    'not_yet',
    'not_the_owner',
    'cannot_remove_owner',
    'not_the_initiator',
    'link_expired',
    'no_verified_contact',
    'stale_candidates',
    'needs_candidate',
    'candidate_has_passed',
    'chased_answer_required',
    'outcome_already_reported',
    'attendance_too_early',
    'attendance_not_reversible',
    'confirmation_not_found',
    'confirmation_not_active',
    'stale_confirmation',
    'outcome_too_early',
    'attendance_confirmation_missing',
    'attendance_confirmation_not_live',
    'attendance_not_a_participant',
    'stale_revision',
    'replies_closed',
    'windows_do_not_match_status',
    'outside_plan_window',
    'not_a_window',
    'note_not_allowed',
    'already_the_organiser',
    'already_extended',
    'no_time_to_extend',
    'stale_availability',
    'needs_own_time',
    'own_time_off_the_half_hour',
    'own_time_ends_before_it_starts',
    'own_time_too_short',
    'own_time_too_long',
    'own_time_in_the_past',
    'own_time_too_far_ahead',
    'meetup_has_ended',
    'consent_version_unknown',
    'not_quiet',
    'not_a_member',
  ]);

  it.each(ProblemReason.options)('%s', (reason) => {
    if (OTHER_SCREENS_OWN.has(reason)) return;
    const out = quietRefusalOf(refused(reason));
    // The saved-place reasons show the gate, which carries its own words.
    expect(out.message !== GENERIC || out.needsSavedPlace === true).toBe(true);
  });

  it('lists nothing that has gone', () => {
    for (const reason of OTHER_SCREENS_OWN) {
      expect(ProblemReason.options as readonly string[]).toContain(reason);
    }
  });
});
