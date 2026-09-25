import { describe, expect, it } from 'vitest';

import { PRIYA, SAM, TOM } from '../scheduling/fixtures.js';
import { addMinutes } from '../shared/instant.js';
import { FRIDAY_MIDDAY, TOM_ASKS, quietPlan } from './fixtures.js';
import { acceptOrganiser, expire, withdraw } from './quiet-lifecycle.js';
import type { Actor } from './state-machine.js';

const MEMBER: Actor = {
  userId: PRIYA,
  isPermanent: true,
  isMember: true,
  isOrganiser: false,
  isOwner: false,
  isInitiator: false,
  isKeen: false,
};
const KEEN: Actor = { ...MEMBER, isKeen: true };
const INITIATOR: Actor = { ...MEMBER, userId: TOM, isInitiator: true, isKeen: true };
const OWNER: Actor = { ...MEMBER, userId: SAM, isOwner: true };

const opened = quietPlan({ state: 'collecting', responseDeadline: FRIDAY_MIDDAY });
const beforeDeadline = TOM_ASKS;

describe('acceptOrganiser', () => {
  it('the initiator may take the role once it has opened', () => {
    const result = acceptOrganiser(opened, INITIATOR, 'initiator', beforeDeadline);
    expect(result.ok && result.value.organiserUserId).toBe(TOM);
    expect(result.ok && result.value.state).toBe('collecting');
  });

  it('someone other than the initiator can become organiser: a keen volunteer', () => {
    const result = acceptOrganiser(opened, KEEN, 'volunteer', beforeDeadline);
    expect(result.ok && result.value.organiserUserId).toBe(PRIYA);
  });

  it('a volunteer must be keen', () => {
    expect(acceptOrganiser(opened, MEMBER, 'volunteer', beforeDeadline)).toEqual({
      ok: false,
      error: { code: 'not_keen' },
    });
  });

  it('only the initiator can accept as the initiator', () => {
    const result = acceptOrganiser(opened, KEEN, 'initiator', beforeDeadline);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_the_initiator');
  });

  it('the owner falls back only after replies close with nobody in the role', () => {
    expect(acceptOrganiser(opened, OWNER, 'owner_fallback', beforeDeadline)).toEqual({
      ok: false,
      error: { code: 'deadline_not_passed' },
    });
    const after = acceptOrganiser(opened, OWNER, 'owner_fallback', FRIDAY_MIDDAY);
    expect(after.ok && after.value.organiserUserId).toBe(SAM);
    expect(acceptOrganiser(opened, MEMBER, 'owner_fallback', FRIDAY_MIDDAY)).toEqual({
      ok: false,
      error: { code: 'not_the_owner' },
    });
  });

  it('can still be taken once candidates are ready, so a ready plan is not stuck', () => {
    const ready = quietPlan({ state: 'ready', responseDeadline: FRIDAY_MIDDAY });
    const result = acceptOrganiser(ready, OWNER, 'owner_fallback', FRIDAY_MIDDAY);
    expect(result.ok && result.value.state).toBe('ready');
  });

  it('is not offered before the threshold', () => {
    const result = acceptOrganiser(quietPlan(), INITIATOR, 'initiator', beforeDeadline);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('wrong_state');
  });

  it('first acceptance wins; a second is refused', () => {
    const taken = quietPlan({ state: 'collecting', organiserUserId: PRIYA });
    const result = acceptOrganiser(taken, INITIATOR, 'initiator', beforeDeadline);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('already_has_organiser');
  });

  it('needs a saved place, whoever is asking', () => {
    const result = acceptOrganiser(opened, { ...KEEN, isPermanent: false }, 'volunteer', TOM_ASKS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('needs_permanent_identity');
  });

  it('refuses a named plan', () => {
    const named = quietPlan({ mode: 'named', state: 'collecting' });
    expect(acceptOrganiser(named, KEEN, 'volunteer', TOM_ASKS)).toEqual({
      ok: false,
      error: { code: 'not_quiet' },
    });
  });
});

describe('expire', () => {
  it('closes a seeking ask from its stop time', () => {
    const result = expire(quietPlan(), FRIDAY_MIDDAY);
    expect(result.ok && result.value.state).toBe('expired');
  });

  it('not before it', () => {
    expect(expire(quietPlan(), addMinutes(FRIDAY_MIDDAY, -1))).toEqual({
      ok: false,
      error: { code: 'stop_time_not_reached' },
    });
  });

  it('only from seeking: an opened plan expires by the rule every plan does', () => {
    expect(expire(opened, FRIDAY_MIDDAY)).toEqual({
      ok: false,
      error: { code: 'wrong_state', action: 'expire', from: 'collecting' },
    });
  });

  it('refuses an ask with no stop time rather than closing it at an invented one', () => {
    expect(expire(quietPlan({ quietExpiresAt: undefined }), FRIDAY_MIDDAY)).toEqual({
      ok: false,
      error: { code: 'no_stop_time' },
    });
  });
});

describe('withdraw', () => {
  it('the initiator withdraws before the threshold', () => {
    const result = withdraw(quietPlan(), INITIATOR);
    expect(result.ok && result.value.state).toBe('cancelled');
  });

  it('nobody else can, the owner included', () => {
    for (const actor of [KEEN, OWNER, MEMBER]) {
      const result = withdraw(quietPlan(), actor);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('not_the_initiator');
    }
  });

  it('not after the threshold, when the plan is the circle’s', () => {
    expect(withdraw(opened, INITIATOR)).toEqual({
      ok: false,
      error: { code: 'wrong_state', action: 'cancel', from: 'collecting' },
    });
  });
});
