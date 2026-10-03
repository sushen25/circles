import { describe, expect, it } from 'vitest';

import type { UserId } from '../circles/types.js';
import type { Actor } from '../planning/state-machine.js';
import { ALEX, JESS, NIC, PRIYA, SAM, SUNDAY_CREW, TOM } from '../scheduling/fixtures.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { addMinutes } from '../shared/instant.js';
import { localDate } from '../shared/local-date.js';
import { fromLocal } from '../shared/zone.js';
import { attendanceCounts, deriveAttendance } from './attendance.js';
import {
  A_CONFIRMATION_ID,
  A_STRANGER,
  CONFIRMED_AT,
  confirmation,
  sundayCrewPlan,
  sundayCrewStoredResponses,
} from './fixtures.js';
import { confirmOwn, editConfirmed, moveConfirmed } from './own.js';
import { confirmationId } from './types.js';

const ORGANISER: Actor = {
  userId: SAM as string,
  isPermanent: true,
  isMember: true,
  isOrganiser: true,
  isOwner: true,
};
const MEMBER: Actor = { ...ORGANISER, userId: A_STRANGER, isOrganiser: false, isOwner: false };

const at = (date: string, hour: number, minute = 0) =>
  fromLocal(localDate(date), hour * 60 + minute, MELBOURNE);
const NEW_ID = confirmationId('confirmation-2');

function base(overrides: Record<string, unknown> = {}) {
  const plan = sundayCrewPlan({ state: 'collecting' });
  return {
    plan,
    responses: sundayCrewStoredResponses(plan),
    members: SUNDAY_CREW,
    start: at('2026-09-17', 19),
    end: at('2026-09-17', 20),
    expectedInputVersion: plan.inputVersion,
    actor: ORGANISER,
    now: CONFIRMED_AT,
    details: { placeName: 'Hope St Radio' },
    confirmationId: A_CONFIRMATION_ID,
    ...overrides,
  };
}

describe('confirmOwn', () => {
  it('locks in a time that is not an option, from collecting, and freezes who can make it', () => {
    const result = confirmOwn(base());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { confirmation: c, plan } = result.value;
    expect(plan.state).toBe('confirmed');
    expect(c.ownTime).toBe(true);
    expect(c.belowQuorum).toBe(false);
    // Thursday 7-8 pm sits inside everyone's 6:30-8:30 window but Alex's, who has not answered.
    expect(c.candidate.availableUserIds).toEqual([SAM, PRIYA, TOM, JESS, NIC]);
    expect(c.calendarUid).toBe(A_CONFIRMATION_ID);
    expect(c.calendarSequence).toBe(0);
  });

  it('records below the number and leaves the number alone', () => {
    // Friday 7-9 pm: nobody offered it.
    const result = confirmOwn(base({ start: at('2026-09-18', 19), end: at('2026-09-18', 21) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confirmation.belowQuorum).toBe(true);
    expect(result.value.confirmation.candidate.availableUserIds).toEqual([]);
    expect(result.value.plan.quorum).toBe(4);
  });

  it('refuses a member, a time in the past and a time off the half hour', () => {
    const code = (overrides: Record<string, unknown>) => {
      const result = confirmOwn(base(overrides));
      return result.ok ? 'ok' : result.error.code;
    };
    expect(code({ actor: MEMBER })).toBe('not_the_organiser');
    expect(code({ now: at('2026-09-17', 19) })).toBe('own_time_in_the_past');
    expect(code({ end: addMinutes(at('2026-09-17', 19), 45 + 1) })).toBe(
      'own_time_off_the_half_hour',
    );
  });

  it('refuses on a cancelled plan', () => {
    const result = confirmOwn(base({ plan: sundayCrewPlan({ state: 'cancelled' }) }));
    expect(result.ok ? 'ok' : result.error.code).toBe('plan_is_finished');
  });

  it('is refused when an answer arrived while the screen was open, rather than freezing names nobody saw', () => {
    const plan = sundayCrewPlan({ state: 'collecting', inputVersion: 5 });
    const result = confirmOwn(base({ plan, expectedInputVersion: 4 }));
    expect(result.ok ? 'ok' : result.error.code).toBe('stale_availability');
    if (!result.ok) expect(result.error.inputVersion).toBe(5);
  });

  it('ignores answers from another revision', () => {
    const plan = sundayCrewPlan({ state: 'collecting', revision: 2 });
    const result = confirmOwn(
      base({ plan, responses: sundayCrewStoredResponses(sundayCrewPlan({ revision: 1 })) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.confirmation.candidate.availableUserIds).toEqual([]);
  });

  it('refuses a note that is too long and a place that is not a link', () => {
    const long = confirmOwn(base({ details: { note: 'x'.repeat(281) } }));
    expect(long.ok ? 'ok' : long.error.code).toBe('note_too_long');
    const bad = confirmOwn(base({ details: { placeUrl: 'javascript:alert(1)' } }));
    expect(bad.ok ? 'ok' : bad.error.code).toBe('place_url_not_a_link');
  });
});

describe('who is going after an own time', () => {
  it('has the people whose times cover it going, and everyone else to confirm: nobody is "can\'t make it"', () => {
    // Saturday 7-9 pm: Priya answered other times; Alex did not answer.
    const result = confirmOwn(base({ start: at('2026-09-19', 19), end: at('2026-09-19', 21) }));
    if (!result.ok) throw new Error('refused');
    const attendance = deriveAttendance(
      result.value.confirmation,
      sundayCrewStoredResponses(result.value.plan),
      SUNDAY_CREW,
    );
    const status = (id: UserId) => attendance.find((a) => a.userId === id)?.status;
    expect(status(SAM)).toBe('going');
    expect(status(TOM)).toBe('going');
    expect(status(PRIYA)).toBe('unknown');
    expect(status(ALEX)).toBe('unknown');
    expect(attendanceCounts(attendance).cant).toBe(0);
  });

  it("follows the organiser's own answer, like anybody else's: not always going", () => {
    const plan = sundayCrewPlan({ state: 'collecting' });
    // Friday: nobody, the organiser included, covered it.
    const result = confirmOwn(
      base({ plan, start: at('2026-09-18', 19), end: at('2026-09-18', 21) }),
    );
    if (!result.ok) throw new Error('refused');
    const attendance = deriveAttendance(
      result.value.confirmation,
      sundayCrewStoredResponses(plan),
      SUNDAY_CREW,
    );
    expect(attendance.find((a) => a.userId === SAM)?.status).toBe('unknown');
  });

  it("is unchanged for an offered option: can't make it for somebody who answered other times", () => {
    const attendance = deriveAttendance(
      confirmation({
        candidate: {
          start: at('2026-09-19', 19),
          end: at('2026-09-19', 21),
          availableUserIds: [SAM, TOM, JESS, NIC],
        },
      }),
      sundayCrewStoredResponses(),
      SUNDAY_CREW,
    );
    expect(attendance.find((a) => a.userId === PRIYA)?.status).toBe('cant');
    expect(attendance.find((a) => a.userId === ALEX)?.status).toBe('unknown');
  });
});

describe('moveConfirmed', () => {
  const live = () => {
    const plan = sundayCrewPlan({ state: 'confirmed' });
    return {
      ...base({ plan }),
      confirmation: confirmation({ ownTime: true, calendarUid: 'uid-1', calendarSequence: 2 }),
      confirmationId: NEW_ID,
      start: at('2026-09-19', 19),
      end: at('2026-09-19', 21),
    };
  };

  it('supersedes the old confirmation for a move, writes a new active one and stays in the same revision', () => {
    const result = moveConfirmed(live());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.superseded.status).toBe('superseded');
    expect(result.value.superseded.candidate.start).toBe(live().confirmation.candidate.start);
    expect(result.value.confirmation.status).toBe('active');
    expect(result.value.confirmation.id).toBe(NEW_ID);
    expect(result.value.confirmation.revision).toBe(live().confirmation.revision);
    expect(result.value.plan.state).toBe('confirmed');
    expect(result.value.plan.revision).toBe(live().plan.revision);
  });

  it('remembers where it moved from, and keeps the calendar entry with a higher sequence', () => {
    const result = moveConfirmed(live());
    if (!result.ok) throw new Error('refused');
    const { confirmation: c } = result.value;
    expect(c.movedFrom).toEqual({
      start: live().confirmation.candidate.start,
      end: live().confirmation.candidate.end,
    });
    expect(c.calendarUid).toBe('uid-1');
    expect(c.calendarSequence).toBe(3);
    // The place and note carry over.
    expect(c.placeName).toBe('Hope St Radio');
  });

  it("starts the old confirmation's own calendar uid at its id when it had none", () => {
    const result = moveConfirmed({ ...live(), confirmation: confirmation() });
    if (!result.ok) throw new Error('refused');
    expect(result.value.confirmation.calendarUid).toBe(A_CONFIRMATION_ID);
    expect(result.value.confirmation.calendarSequence).toBe(1);
  });

  it("derives who is going again from this revision's answers: Tom, Jess and Nic going, Priya and Alex to confirm", () => {
    const result = moveConfirmed(live());
    if (!result.ok) throw new Error('refused');
    const attendance = deriveAttendance(
      result.value.confirmation,
      sundayCrewStoredResponses(result.value.plan),
      SUNDAY_CREW,
    );
    expect(attendance.filter((a) => a.status === 'going').map((a) => a.userId)).toEqual([
      SAM,
      TOM,
      JESS,
      NIC,
    ]);
    expect(attendance.filter((a) => a.status === 'unknown').map((a) => a.userId)).toEqual([
      PRIYA,
      ALEX,
    ]);
  });

  it('is refused for a member, for a confirmation that is not active, after it has ended and when the screen is stale', () => {
    const code = (overrides: Record<string, unknown>) => {
      const result = moveConfirmed({ ...live(), ...overrides });
      return result.ok ? 'ok' : result.error.code;
    };
    expect(code({ actor: MEMBER })).toBe('not_the_organiser');
    expect(code({ confirmation: confirmation({ status: 'cancelled' }) })).toBe(
      'confirmation_not_active',
    );
    expect(code({ start: at('2026-09-14', 8), end: at('2026-09-14', 9) })).toBe(
      'own_time_in_the_past',
    );
    expect(code({ expectedInputVersion: 0 })).toBe('stale_availability');
    expect(
      code({
        now: addMinutes(live().confirmation.candidate.end, 1),
        start: at('2026-09-30', 19),
        end: at('2026-09-30', 20),
      }),
    ).toBe('meetup_has_ended');
  });
});

describe('editConfirmed', () => {
  const live = () => ({
    plan: sundayCrewPlan({ state: 'confirmed' }),
    confirmation: confirmation({ ownTime: true }),
    actor: ORGANISER,
    now: CONFIRMED_AT,
    details: { placeName: 'Naked for Satan', note: undefined },
  });

  it('updates the place and clears the note in place, without a new confirmation or a revision', () => {
    const result = editConfirmed(live());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.confirmation.id).toBe(A_CONFIRMATION_ID);
    expect(result.value.confirmation.placeName).toBe('Naked for Satan');
    expect(result.value.confirmation.note).toBeUndefined();
    expect(result.value.confirmation.candidate).toEqual(live().confirmation.candidate);
    expect(result.value.plan.revision).toBe(live().plan.revision);
  });

  it("changes nobody's status: the attendance read for the same confirmation is the same", () => {
    const before = deriveAttendance(live().confirmation, sundayCrewStoredResponses(), SUNDAY_CREW);
    const result = editConfirmed(live());
    if (!result.ok) throw new Error('refused');
    const after = deriveAttendance(
      result.value.confirmation,
      sundayCrewStoredResponses(),
      SUNDAY_CREW,
    );
    expect(after).toEqual(before);
  });

  it('is refused for a member, and once the meetup has ended', () => {
    const member = editConfirmed({ ...live(), actor: MEMBER });
    expect(member.ok ? 'ok' : member.error.code).toBe('not_the_organiser');
    const over = editConfirmed({
      ...live(),
      now: addMinutes(live().confirmation.candidate.end, 1),
    });
    expect(over.ok ? 'ok' : over.error.code).toBe('meetup_has_ended');
    const gone = editConfirmed({ ...live(), plan: sundayCrewPlan({ state: 'cancelled' }) });
    expect(gone.ok ? 'ok' : gone.error.code).toBe('plan_is_finished');
  });
});
