import { describe, expect, it } from 'vitest';

import { userId } from '../circles/types.js';
import type { Actor } from '../planning/state-machine.js';
import { planId } from '../planning/types.js';
import { SCORING_VERSION } from '../scheduling/types.js';
import { SUNDAY_CREW } from '../scheduling/fixtures.js';
import { fromISO } from '../shared/instant.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { toLocal } from '../shared/zone.js';
import {
  type ConfirmErrorCode,
  type ConfirmRequest,
  candidateIdOf,
  confirm,
  isLink,
  supersede,
} from './confirm.js';
import {
  A_CONFIRMATION_ID,
  A_STRANGER,
  CONFIRMED_AT,
  confirmation,
  sundayCrewCandidates,
  sundayCrewPlan,
  thursdayId,
} from './fixtures.js';
import { NOTE_MAX_LENGTH } from './types.js';

const ORGANISER: Actor = {
  userId: SUNDAY_CREW[0] as string,
  isPermanent: true,
  isMember: true,
  isOrganiser: true,
  isOwner: true,
};

const MEMBER: Actor = { ...ORGANISER, userId: A_STRANGER, isOrganiser: false, isOwner: false };

function request(overrides: Partial<ConfirmRequest> = {}): ConfirmRequest {
  const plan = sundayCrewPlan();
  const candidates = sundayCrewCandidates(plan);
  return {
    plan,
    candidates,
    candidateId: thursdayId(candidates),
    details: {},
    actor: ORGANISER,
    now: CONFIRMED_AT,
    confirmationId: A_CONFIRMATION_ID,
    ...overrides,
  };
}

/** The refusal code, so the cases below read as one line each. */
function refusal(overrides: Partial<ConfirmRequest> = {}): ConfirmErrorCode | 'ok' {
  const result = confirm(request(overrides));
  return result.ok ? 'ok' : result.error.code;
}

describe('confirm', () => {
  it('freezes the artboard Thursday, with who could make it', () => {
    const result = confirm(request({ details: { placeName: 'Hope St Radio' } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { start, availableUserIds } = result.value.confirmation.candidate;
    const local = toLocal(start, MELBOURNE);
    expect(local.date).toBe('2026-09-17');
    expect(local.minutesOfDay).toBe(18 * 60 + 30);
    // Five of six: Alex never answered.
    expect(availableUserIds).toHaveLength(5);
    expect(availableUserIds).not.toContain(userId('alex'));
    expect(result.value.confirmation.status).toBe('active');
    expect(result.value.confirmation.placeName).toBe('Hope St Radio');
  });

  it('moves the plan to confirmed, using the state machine rather than its own rule', () => {
    const result = confirm(request());
    expect(result.ok && result.value.plan.state).toBe('confirmed');
    // The revision is untouched: confirming is not an edit.
    expect(result.ok && result.value.plan.revision).toBe(sundayCrewPlan().revision);
  });

  it('is a copy, not a reference: the confirmation does not share the candidate object', () => {
    const candidates = sundayCrewCandidates();
    const result = confirm(request({ candidates }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confirmation.candidate).not.toBe(candidates.set.eligible[0]);
  });

  it('refuses anyone who is not the organiser', () => {
    expect(refusal({ actor: MEMBER })).toBe('not_the_organiser');
  });

  it('refuses a set computed for an earlier revision', () => {
    // The organiser opened the review screen, then edited the plan. Their
    // candidate is a time nobody was asked about under the new question.
    const plan = sundayCrewPlan({ revision: 3 });
    const stale = { ...sundayCrewCandidates(), revision: 2 };
    expect(refusal({ plan, candidates: { ...stale, planId: plan.id } })).toBe('stale_candidates');
  });

  it('refuses a set belonging to a different plan', () => {
    const candidates = { ...sundayCrewCandidates(), planId: planId('plan-someone-else') };
    expect(refusal({ candidates })).toBe('wrong_plan');
  });

  it('refuses a set from an older engine, because the ranking it shows is not ours', () => {
    const candidates = sundayCrewCandidates();
    const set = { ...candidates.set, scoringVersion: SCORING_VERSION - 1 };
    expect(refusal({ candidates: { ...candidates, set } })).toBe('stale_scoring_version');
  });

  it('refuses a candidate that is not on offer', () => {
    expect(
      refusal({ candidateId: candidateIdOf({ start: fromISO('2026-09-18T09:00:00Z') }) }),
    ).toBe('needs_candidate');
  });

  it('refuses a candidate whose start has already gone', () => {
    // Half an hour into the Thursday. The engine would drop it on the next
    // recalculation; until then, confirming it would lock in a time that has
    // begun.
    expect(refusal({ now: fromISO('2026-09-17T09:00:00Z') })).toBe('candidate_has_passed');
  });

  it('refuses a note over the limit, and accepts one exactly on it', () => {
    expect(refusal({ details: { note: 'x'.repeat(NOTE_MAX_LENGTH + 1) } })).toBe('note_too_long');
    expect(refusal({ details: { note: 'x'.repeat(NOTE_MAX_LENGTH) } })).toBe('ok');
  });

  it('refuses a place link that is not a link', () => {
    expect(refusal({ details: { placeUrl: 'javascript:alert(1)' } })).toBe('place_url_not_a_link');
    expect(refusal({ details: { placeUrl: 'hope-st-radio' } })).toBe('place_url_not_a_link');
  });

  it('accepts a map link, query string and all', () => {
    expect(refusal({ details: { placeUrl: 'https://maps.example.com/?q=Hope+St+Radio' } })).toBe(
      'ok',
    );
  });

  it('refuses to confirm a plan that is not ready', () => {
    expect(refusal({ plan: sundayCrewPlan({ state: 'collecting' }) })).toBe('wrong_state');
    expect(refusal({ plan: sundayCrewPlan({ state: 'cancelled' }) })).toBe('plan_is_finished');
  });
});

describe('isLink', () => {
  it('takes http and https and nothing else', () => {
    expect(isLink('https://example.com/a')).toBe(true);
    expect(isLink('http://example.com')).toBe(true);
    expect(isLink('data:text/html,hi')).toBe(false);
    expect(isLink('javascript:alert(1)')).toBe(false);
    expect(isLink('example.com')).toBe(false);
    expect(isLink('')).toBe(false);
  });
});

describe('supersede', () => {
  it('keeps the time it held, because "Thursday is off" has to stay true', () => {
    const before = confirmation();
    const after = supersede(before, 'reopen');
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.status).toBe('superseded');
    expect(after.value.candidate).toEqual(before.candidate);
    expect(before.status).toBe('active');
  });

  it('cancels rather than supersedes when the plan is called off', () => {
    const result = supersede(confirmation(), 'cancel');
    expect(result.ok && result.value.status).toBe('cancelled');
  });

  it('refuses a confirmation that is already finished', () => {
    const result = supersede(confirmation({ status: 'superseded' }), 'cancel');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: 'confirmation_not_active',
      confirmationId: A_CONFIRMATION_ID,
      status: 'superseded',
    });
  });
});
