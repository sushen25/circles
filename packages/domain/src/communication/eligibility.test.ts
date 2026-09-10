import { describe, expect, it } from 'vitest';

import { type UserId, userId } from '../circles/types.js';
import { circle, member } from '../circles/fixtures.js';
import { confirmation, sundayCrewPlan } from '../confirmation/fixtures.js';
import { planId } from '../planning/types.js';
import { deriveAttendance } from '../confirmation/attendance.js';
import { ALEX, JESS, NIC, PRIYA, SAM, SUNDAY_CREW, TOM } from '../scheduling/fixtures.js';
import { sundayCrewStoredResponses } from '../confirmation/fixtures.js';
import { fromISO } from '../shared/instant.js';
import { type EligibilityContext, channelFor, recipientsFor } from './eligibility.js';
import { AN_OUTSIDER, NOBODY_HAS_PUSH, eligibilityContext, sundayCrewMembers } from './fixtures.js';
import type { NotificationKind } from './kinds.js';

const ids = (kind: NotificationKind, context: EligibilityContext): readonly UserId[] =>
  recipientsFor(kind, context).map((r) => r.userId);

describe('audiences', () => {
  it('tells the whole circle about a new plan, except whoever made it', () => {
    const context = eligibilityContext({ actorId: SAM });
    expect(ids('new_plan', context)).toEqual([PRIYA, TOM, JESS, NIC, ALEX]);
  });

  it('never sends a quiet ask back to its own initiator', () => {
    // The initiator is not identifiable from anything anyone receives (§8.2),
    // and a push telling them about their own ask is the loudest possible tell.
    const context = eligibilityContext({ quietInitiatorId: PRIYA });
    expect(ids('quiet_ask', context)).not.toContain(PRIYA);
    expect(ids('quiet_ask', context)).toHaveLength(5);
  });

  it('offers the role to the initiator alone at threshold', () => {
    const context = eligibilityContext({ quietInitiatorId: PRIYA });
    expect(ids('threshold_initiator', context)).toEqual([PRIYA]);
    expect(ids('threshold_initiator', eligibilityContext())).toEqual([]);
  });

  it('asks only the keen ones for their times', () => {
    const context = eligibilityContext({ quietInitiatorId: PRIYA, keenMemberIds: [TOM, NIC] });
    expect(ids('threshold_keen', context)).toEqual([TOM, NIC]);
  });

  it('reminds the non-responders about the deadline, and nobody else', () => {
    // Five of six answered; Alex did not.
    expect(ids('deadline_approaching', eligibilityContext())).toEqual([ALEX]);
  });

  it('reminds a member at most once per plan, across revisions', () => {
    // An edit bumps the revision and invalidates the answers, so *everybody*
    // becomes a non-responder. Re-reminding them all is the repeated nagging
    // the spec forbids, and the revision cannot be what stops it.
    const plan = sundayCrewPlan({ revision: 2 });
    const stale = eligibilityContext({ plan });
    expect(ids('deadline_approaching', stale)).toEqual([...SUNDAY_CREW]);
    expect(ids('deadline_approaching', { ...stale, alreadySent: [...SUNDAY_CREW] })).toEqual([]);
  });

  it('takes options ready, did it happen and about time to one person', () => {
    const context = eligibilityContext();
    expect(ids('options_ready', context)).toEqual([SAM]);
    expect(ids('did_it_happen', context)).toEqual([SAM]);
    expect(ids('about_time', context)).toEqual([SAM]);
  });

  it('has nobody for an organiser kind on a plan with no organiser', () => {
    // A quiet ask before anyone accepts. Silence, not a fallback to the owner:
    // the owner has not agreed to organise anything.
    const plan = sundayCrewPlan({ organiserUserId: undefined });
    expect(ids('options_ready', eligibilityContext({ plan }))).toEqual([]);
  });

  it('reminds the people who said they are going, two hours before', () => {
    const confirmed = confirmation();
    const attendance = deriveAttendance(
      confirmed,
      sundayCrewStoredResponses(sundayCrewPlan()),
      SUNDAY_CREW,
    );
    // Five going, Alex still unknown — and "unknown" is not "going".
    expect(ids('reminder', eligibilityContext({ attendance }))).toEqual([
      SAM,
      PRIYA,
      TOM,
      JESS,
      NIC,
    ]);
  });

  it('sends a reminder to nobody when nobody has said they are coming', () => {
    expect(ids('reminder', eligibilityContext({ attendance: [] }))).toEqual([]);
  });

  it('selects nobody for a verification, because an address is not a member', () => {
    expect(ids('verify_email', eligibilityContext())).toEqual([]);
  });
});

describe('the rules that cut across every kind', () => {
  it('never tells anyone about their own action', () => {
    const context = eligibilityContext({ actorId: PRIYA });
    for (const kind of ['new_plan', 'locked_in', 'changed', 'cancelled'] as const) {
      expect(ids(kind, context)).not.toContain(PRIYA);
    }
  });

  it('leaves a removed member out of everything', () => {
    const members = sundayCrewMembers({ [TOM]: { status: 'removed' } });
    expect(ids('locked_in', eligibilityContext({ members }))).not.toContain(TOM);
  });

  it('honours mutedAll for every kind', () => {
    const members = sundayCrewMembers({ [NIC]: { mutedAll: true } });
    const context = eligibilityContext({ members, quietInitiatorId: PRIYA, keenMemberIds: [NIC] });
    for (const kind of ['new_plan', 'quiet_ask', 'threshold_keen', 'locked_in'] as const) {
      expect(ids(kind, context)).not.toContain(NIC);
    }
  });

  it('honours mutedQuietAsks for the quiet kinds only', () => {
    // Someone who does not want to be asked "would you be up for something?"
    // every week still wants to know when a plan is confirmed.
    const members = sundayCrewMembers({ [JESS]: { mutedQuietAsks: true } });
    const context = eligibilityContext({ members, quietInitiatorId: PRIYA, keenMemberIds: [JESS] });
    expect(ids('quiet_ask', context)).not.toContain(JESS);
    expect(ids('threshold_keen', context)).not.toContain(JESS);
    expect(ids('locked_in', context)).toContain(JESS);
    expect(ids('new_plan', context)).toContain(JESS);
  });

  it('drops somebody who is not a member of this circle at all', () => {
    const context = eligibilityContext({ keenMemberIds: [AN_OUTSIDER] });
    expect(ids('threshold_keen', context)).toEqual([]);
  });
});

describe('channels', () => {
  it('uses push when there is a device', () => {
    expect(recipientsFor('locked_in', eligibilityContext())[0]?.channel).toBe('push');
  });

  it('falls back to email for the organiser kinds, which is why Slice 1 needs no app', () => {
    const context = eligibilityContext({ hasPushDevice: NOBODY_HAS_PUSH });
    expect(recipientsFor('options_ready', context)).toEqual([{ userId: SAM, channel: 'email' }]);
    expect(recipientsFor('did_it_happen', context)[0]?.channel).toBe('email');
  });

  it('sends nothing at all for a push-only kind when there is no device', () => {
    // Not a fallback to email: a member without the app reaches email through a
    // verified per-plan subscription with its own consent, not by being on a
    // members list.
    const context = eligibilityContext({ hasPushDevice: NOBODY_HAS_PUSH, actorId: SAM });
    expect(recipientsFor('new_plan', context)).toEqual([]);
    expect(recipientsFor('deadline_approaching', context)).toEqual([]);
  });

  it('picks per person, not per kind', () => {
    const hasPushDevice = (id: UserId) => id === PRIYA;
    const context = eligibilityContext({ hasPushDevice, actorId: SAM });
    expect(channelFor('locked_in', PRIYA, context)).toBe('push');
    expect(channelFor('locked_in', TOM, context)).toBe('email');
    expect(channelFor('new_plan', TOM, context)).toBeUndefined();
  });
});

describe('the nudge recipient', () => {
  it('is nobody when the circle has switched cadence off', () => {
    const context = eligibilityContext({ circle: circle({ cadence: 'none', ownerUserId: SAM }) });
    expect(ids('about_time', context)).toEqual([]);
  });

  it('takes its turn from whoever was actually at the last meetup', () => {
    const context = eligibilityContext({
      circle: circle({ ownerUserId: SAM, nudgePolicy: 'take_turns' }),
      nudge: { lastHappenedAttendees: [PRIYA, TOM], lastOrganiserId: PRIYA },
    });
    expect(ids('about_time', context)).toHaveLength(1);
  });

  it('is one person, never the circle', () => {
    // "About time · to one person only" — a nudge sent to six people is six
    // people each assuming somebody else will do it.
    expect(ids('about_time', eligibilityContext())).toHaveLength(1);
  });
});

describe('answers from another revision', () => {
  it('do not count as having replied', () => {
    const plan = sundayCrewPlan({ revision: 2 });
    const context = eligibilityContext({
      plan,
      responses: sundayCrewStoredResponses(sundayCrewPlan()),
    });
    expect(ids('deadline_approaching', context)).toEqual([...SUNDAY_CREW]);
  });

  it('nor do answers to another plan', () => {
    const elsewhere = sundayCrewStoredResponses(sundayCrewPlan()).map((r) => ({
      ...r,
      planId: planId('plan-elsewhere'),
    }));
    expect(ids('deadline_approaching', eligibilityContext({ responses: elsewhere }))).toEqual([
      ...SUNDAY_CREW,
    ]);
  });
});

describe('a circle with nobody left to tell', () => {
  it('answers with silence rather than falling back to somebody', () => {
    const members = sundayCrewMembers(
      Object.fromEntries(SUNDAY_CREW.map((id) => [id, { mutedAll: true }])),
    );
    const context = eligibilityContext({ members });
    expect(recipientsFor('locked_in', context)).toEqual([]);
    expect(recipientsFor('about_time', context)).toEqual([]);
  });
});

describe('a member who joined after the plan', () => {
  it('is told about it, and owes a reply like everyone else', () => {
    // "New members may opt into the active plan" (spec §9). They have not
    // answered, so the deadline reminder is for them too.
    const newcomer = userId('user-newcomer');
    const members = [
      ...sundayCrewMembers(),
      member({ userId: newcomer, displayName: 'Rowan', joinedAt: fromISO('2026-09-15T00:00:00Z') }),
    ];
    const context = eligibilityContext({ members, actorId: SAM });
    expect(ids('deadline_approaching', context)).toEqual([ALEX, newcomer]);
    expect(ids('locked_in', context)).toContain(newcomer);
  });
});
