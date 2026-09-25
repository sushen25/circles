import { describe, expect, it } from 'vitest';

import { JESS, PRIYA, SAM, TOM } from '../scheduling/fixtures.js';
import { recipientsFor } from './eligibility.js';
import { NOBODY_HAS_PUSH, eligibilityContext, sundayCrewMembers } from './fixtures.js';

/**
 * Who hears about a quiet ask (spec §5.8, S2-02). The dispatcher reads the
 * initiator and the keen members only for these kinds and hands them in; what
 * they mean is decided here. Tom asked; Priya and Jess were keen.
 */

const quiet = (overrides = {}) =>
  eligibilityContext({ quietInitiatorId: TOM, keenMemberIds: [TOM, PRIYA, JESS], ...overrides });

const ids = (kind: Parameters<typeof recipientsFor>[0], context = quiet()) =>
  recipientsFor(kind, context).map((r) => r.userId);

describe('the quiet kinds', () => {
  it('prompt everybody but the initiator', () => {
    expect(ids('quiet_ask')).not.toContain(TOM);
    expect(ids('quiet_ask')).toContain(SAM);
  });

  it('tell the keen members to choose times, and not the initiator, who has their own message', () => {
    expect(ids('threshold_keen').sort()).toEqual([JESS, PRIYA].sort());
    expect(ids('threshold_initiator')).toEqual([TOM]);
  });

  it('tell the initiator alone that their ask closed, by email since there is no push row', () => {
    const recipients = recipientsFor('quiet_expired', quiet({ hasPushDevice: NOBODY_HAS_PUSH }));
    expect(recipients).toEqual([{ userId: TOM, channel: 'email' }]);
  });

  it('email the initiator at threshold only when they have no app', () => {
    expect(recipientsFor('threshold_initiator', quiet())).toEqual([
      { userId: TOM, channel: 'push' },
    ]);
    expect(recipientsFor('threshold_initiator', quiet({ hasPushDevice: NOBODY_HAS_PUSH }))).toEqual(
      [{ userId: TOM, channel: 'email' }],
    );
  });

  it('say nothing to an initiator who has since muted quiet asks, or left', () => {
    const muted = quiet({
      hasPushDevice: NOBODY_HAS_PUSH,
      members: sundayCrewMembers({ [TOM]: { mutedQuietAsks: true } }),
    });
    expect(recipientsFor('quiet_expired', muted)).toEqual([]);
    const left = quiet({ members: sundayCrewMembers({ [TOM]: { status: 'removed' } }) });
    expect(recipientsFor('quiet_expired', left)).toEqual([]);
  });

  it('reach nobody when the dispatcher did not say who asked', () => {
    expect(ids('quiet_expired', eligibilityContext())).toEqual([]);
    expect(ids('threshold_initiator', eligibilityContext())).toEqual([]);
  });
});
