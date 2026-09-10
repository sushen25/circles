import { describe, expect, it } from 'vitest';

import { type UserId, circleId, userId } from '../circles/types.js';
import { circle, member } from '../circles/fixtures.js';
import { confirmation, sundayCrewPlan } from '../confirmation/fixtures.js';
import { confirmationId } from '../confirmation/types.js';
import { planId } from '../planning/types.js';
import { deriveAttendance } from '../confirmation/attendance.js';
import { ALEX, JESS, NIC, PRIYA, SAM, SUNDAY_CREW, TOM } from '../scheduling/fixtures.js';
import { sundayCrewStoredResponses } from '../confirmation/fixtures.js';
import { fromISO } from '../shared/instant.js';
import { type EligibilityContext, channelFor, recipientsFor } from './eligibility.js';
import {
  AN_OUTSIDER,
  NOBODY_HAS_PUSH,
  NOBODY_SUBSCRIBED,
  eligibilityContext,
  sundayCrewMembers,
} from './fixtures.js';
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
    const context = eligibilityContext({ attendance, confirmationId: confirmed.id });
    expect(ids('reminder', context)).toEqual([SAM, PRIYA, TOM, JESS, NIC]);
  });

  it('sends a reminder to nobody when nobody has said they are coming', () => {
    const context = eligibilityContext({ attendance: [], confirmationId: confirmation().id });
    expect(ids('reminder', context)).toEqual([]);
  });

  it('ignores a "going" left behind by a confirmation that was superseded', () => {
    // Superseding keeps the old rows — that is what makes "Thursday is off the
    // table" stay true — so a `going` from the evening that was called off must
    // not put somebody on the Saturday's reminder list.
    const current = confirmation();
    const abandoned = deriveAttendance(
      confirmation({ id: confirmationId('confirmation-thursday') }),
      sundayCrewStoredResponses(sundayCrewPlan()),
      SUNDAY_CREW,
    );
    const context = eligibilityContext({ attendance: abandoned, confirmationId: current.id });
    expect(ids('reminder', context)).toEqual([]);
  });

  it('reminds nobody at all until the caller says which confirmation it means', () => {
    const attendance = deriveAttendance(
      confirmation(),
      sundayCrewStoredResponses(sundayCrewPlan()),
      SUNDAY_CREW,
    );
    expect(ids('reminder', eligibilityContext({ attendance }))).toEqual([]);
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

  it('never falls back to email for a member kind on membership alone', () => {
    const context = eligibilityContext({ hasPushDevice: NOBODY_HAS_PUSH, actorId: SAM });
    expect(channelFor('locked_in', TOM, context)).toBeUndefined();
  });

  it('sends nothing at all for a push-only kind when there is no device', () => {
    const context = eligibilityContext({ hasPushDevice: NOBODY_HAS_PUSH, actorId: SAM });
    expect(recipientsFor('new_plan', context)).toEqual([]);
    expect(recipientsFor('deadline_approaching', context)).toEqual([]);
  });

  it('picks per person, not per kind', () => {
    const hasPushDevice = (id: UserId) => id === PRIYA;
    const context = eligibilityContext({
      hasPushDevice,
      actorId: SAM,
      hasPlanEmailSubscription: (id) => id === TOM,
    });
    expect(channelFor('locked_in', PRIYA, context)).toBe('push');
    expect(channelFor('locked_in', TOM, context)).toBe('email');
    expect(channelFor('locked_in', JESS, context)).toBeUndefined();
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
  const newcomer = userId('user-newcomer');
  const members = [
    ...sundayCrewMembers(),
    member({ userId: newcomer, displayName: 'Rowan', joinedAt: fromISO('2026-09-15T00:00:00Z') }),
  ];

  it('hears nothing about it until they opt in', () => {
    // "New members may opt into the active plan" (spec §9) — an opt-in, so
    // joining a circle on Tuesday must not make somebody a non-responder to a
    // question they were never asked.
    const context = eligibilityContext({ members, actorId: SAM });
    expect(ids('deadline_approaching', context)).toEqual([ALEX]);
    expect(ids('locked_in', context)).not.toContain(newcomer);
  });

  it('is in everything once they have', () => {
    const context = eligibilityContext({
      members,
      participantIds: [...SUNDAY_CREW, newcomer],
      actorId: SAM,
    });
    expect(ids('deadline_approaching', context)).toEqual([ALEX, newcomer]);
    expect(ids('locked_in', context)).toContain(newcomer);
  });
});

describe('another circle', () => {
  it('never sees this plan, however the caller assembled the list', () => {
    // "Every plan belongs to one circle; only active members see or act on it"
    // (§8.2) is structural, not a promise about how callers build arrays.
    const stranger = member({ circleId: circleId('circle-2'), userId: AN_OUTSIDER });
    const context = eligibilityContext({
      members: [...sundayCrewMembers(), stranger],
      participantIds: [...SUNDAY_CREW, AN_OUTSIDER],
      actorId: SAM,
    });
    expect(ids('locked_in', context)).not.toContain(AN_OUTSIDER);
    expect(ids('deadline_approaching', context)).toEqual([ALEX]);
  });

  it('gets nothing when the plan does not belong to the circle it was given', () => {
    const context = eligibilityContext({
      plan: sundayCrewPlan({ circleId: circleId('circle-2') }),
    });
    expect(recipientsFor('locked_in', context)).toEqual([]);
  });
});

describe('a removed member', () => {
  it('is not offered the organiser role, even as the quiet initiator', () => {
    // `quiet_initiator` names one person rather than filtering a list, so it is
    // the audience that would otherwise skip every check the others get free.
    const members = sundayCrewMembers({ [PRIYA]: { status: 'removed' } });
    const context = eligibilityContext({ members, quietInitiatorId: PRIYA });
    expect(ids('threshold_initiator', context)).toEqual([]);
  });

  it("cannot have their mute settings read off another circle's row", () => {
    // A map keyed on `userId` alone lets the second row win. If that row is
    // from another circle, the flags come from the wrong membership.
    const elsewhere = member({ circleId: circleId('circle-2'), userId: TOM, mutedAll: false });
    const members = [...sundayCrewMembers({ [TOM]: { mutedAll: true } }), elsewhere];
    expect(ids('locked_in', eligibilityContext({ members, actorId: SAM }))).not.toContain(TOM);
  });
});

describe('the participant half of "did it happen"', () => {
  it('goes to the verified subscribers, by email, and never by push', () => {
    // §5.8 lists it among the five plan-update emails: a subscriber is the one
    // person who can say whether they were actually there.
    const context = eligibilityContext({
      hasPlanEmailSubscription: (id) => id === PRIYA || id === TOM,
    });
    expect(recipientsFor('did_it_happen_participant', context)).toEqual([
      { userId: PRIYA, channel: 'email' },
      { userId: TOM, channel: 'email' },
    ]);
  });

  it('reaches nobody who did not ask for it', () => {
    expect(recipientsFor('did_it_happen_participant', eligibilityContext())).toEqual([]);
  });

  it("leaves the organiser's own version alone", () => {
    const context = eligibilityContext({ hasPlanEmailSubscription: (id) => id === PRIYA });
    expect(ids('did_it_happen', context)).toEqual([SAM]);
  });
});

describe('email consent', () => {
  const noPush = { hasPushDevice: NOBODY_HAS_PUSH };

  it('is required before a member kind may use email', () => {
    // Being in a circle is not consent to be emailed: the subscription is per
    // plan, asked for explicitly and verified (§8.2). Silence is the answer.
    const context = eligibilityContext({ ...noPush, actorId: SAM });
    for (const kind of ['locked_in', 'changed', 'cancelled', 'reminder'] as const) {
      expect(recipientsFor(kind, context)).toEqual([]);
    }
  });

  it('lets the subscribed ones through, and only them', () => {
    const context = eligibilityContext({
      ...noPush,
      actorId: SAM,
      hasPlanEmailSubscription: (id) => id === PRIYA,
    });
    expect(recipientsFor('locked_in', context)).toEqual([{ userId: PRIYA, channel: 'email' }]);
  });

  it('is not required for the organiser kinds', () => {
    // Review C6: the organiser is emailed until they install the app, which is
    // what lets Slice 1 ship without a native build.
    const context = eligibilityContext({ ...noPush, hasPlanEmailSubscription: NOBODY_SUBSCRIBED });
    for (const kind of ['options_ready', 'replies_closed', 'did_it_happen'] as const) {
      expect(recipientsFor(kind, context)).toEqual([{ userId: SAM, channel: 'email' }]);
    }
  });

  it('does not change anything for someone with the app', () => {
    const context = eligibilityContext({
      actorId: SAM,
      hasPlanEmailSubscription: NOBODY_SUBSCRIBED,
    });
    expect(recipientsFor('locked_in', context)[0]?.channel).toBe('push');
  });
});

describe('replies closed with no decision', () => {
  it('reaches the organiser, on paper or on their phone', () => {
    // Spec §5.7's "one reminder at the deadline", and one of the four organiser
    // email kinds in §5.8. It is on no push artboard, and required all the same.
    expect(ids('replies_closed', eligibilityContext())).toEqual([SAM]);
    expect(
      recipientsFor('replies_closed', eligibilityContext({ hasPushDevice: NOBODY_HAS_PUSH })),
    ).toEqual([{ userId: SAM, channel: 'email' }]);
  });
});
