import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { as, lockedIn as lockedInOn, nextOneLockedIn } from '../testing/meetup.integration';
import { readStackConfig, sql, type Stack } from '../testing/stack.integration';

/**
 * The morning after, against the real database, as the people who answer it
 * (S1-29): who is asked what and when, what each answer moves, and that a
 * member's "I was there" goes through `report-outcome` and comes back as
 * counts the member could not have read themselves.
 *
 * Needs `pnpm db:start`.
 */

let stack: Stack;

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
});

beforeEach(() => {
  sql(stack, 'delete from jobs.rate_counters');
});

/**
 * Locked in, and then the evening happens: the time moves into the past. Two
 * days back, so that "the morning after" (nine the next morning, where the
 * reader is) has come whatever the hour the suite runs at.
 */
async function theMorningAfter(hoursAgo = 48) {
  const meetup = await lockedInOn(stack);
  sql(
    stack,
    `update public.meetup_confirmations set starts_at = now() - interval '${hoursAgo + 2} hours', ends_at = now() - interval '${hoursAgo} hours' where id = '${meetup.confirmed.confirmation_id}'`,
  );
  return meetup;
}

function lastMetAt(circleId: string): string {
  return sql(
    stack,
    `select coalesce(last_met_at::text, 'never') from public.circles where id = '${circleId}'`,
  );
}

describe('who is asked', () => {
  it('nobody, while the meetup is still ahead', async () => {
    const { owner, ren, circleId } = await lockedInOn(stack);
    const { morningAfterOf } = await import('./morning');
    expect(await as(owner, () => morningAfterOf(circleId))).toBeNull();
    expect(await as(ren.client, () => morningAfterOf(circleId))).toBeNull();
  });

  // Review round 5: "the morning after" (§5.10), the moment the email goes —
  // not the moment the evening ends. The answer is taken from the end.
  it('nobody on the night itself, though an answer is already taken', async () => {
    const { owner, ren, circleId, confirmed } = await theMorningAfter(0.5);
    const { morningAfterOf } = await import('./morning');
    const { reportAttendance } = await import('./outcome');
    expect(await as(owner, () => morningAfterOf(circleId))).toBeNull();
    expect(await as(ren.client, () => morningAfterOf(circleId))).toBeNull();
    await expect(
      as(ren.client, () =>
        reportAttendance({
          confirmationId: confirmed.confirmation_id,
          attendance: 'was_there',
          key: globalThis.crypto.randomUUID() as never,
        }),
      ),
    ).resolves.toEqual({ was_there: 1, missed: 0 });
  });

  it('the organiser whether it happened, and each member asked whether they were there', async () => {
    const { owner, ren, alex, circleId, planId, code, confirmed } = await theMorningAfter();
    const { morningAfterOf } = await import('./morning');
    expect(await as(owner, () => morningAfterOf(circleId))).toMatchObject({
      ask: 'outcome',
      planId,
      code,
      confirmationId: confirmed.confirmation_id,
    });
    expect(await as(ren.client, () => morningAfterOf(circleId))).toMatchObject({
      ask: 'attendance',
    });
    // Alex never answered the plan; he was still asked it, so he is asked this.
    expect(await as(alex.client, () => morningAfterOf(circleId))).toMatchObject({
      ask: 'attendance',
    });
  });
});

describe('an unanswered meetup, once the next one is locked in', () => {
  // Review round 1: reading only the circle's newest plan hid last night's
  // question the moment the next catch-up was locked in — and with it the one
  // answer that moves "Last caught up".
  it('is still asked about, of the organiser and of a member', async () => {
    const meetup = await theMorningAfter();
    const next = await nextOneLockedIn(meetup);
    const { morningAfterOf } = await import('./morning');

    expect(await as(meetup.owner, () => morningAfterOf(meetup.circleId))).toMatchObject({
      ask: 'outcome',
      planId: meetup.planId,
      confirmationId: meetup.confirmed.confirmation_id,
    });
    expect(await as(meetup.ren.client, () => morningAfterOf(meetup.circleId))).toMatchObject({
      ask: 'attendance',
      planId: meetup.planId,
    });
    expect(next.planId).not.toBe(meetup.planId);
  });
});

describe("the organiser's answer", () => {
  it('"it happened" sets when the circle last met to the evening, and stops asking', async () => {
    const { owner, ren, circleId, confirmed } = await theMorningAfter();
    const { morningAfterOf } = await import('./morning');
    const { reportOutcome } = await import('./outcome');
    const { circleHome } = await import('../circles/home');
    expect(lastMetAt(circleId)).toBe('never');

    await as(owner, () =>
      reportOutcome({
        confirmationId: confirmed.confirmation_id,
        outcome: 'happened',
        movedOutside: false,
        note: '  Great night  ',
        key: globalThis.crypto.randomUUID() as never,
      }),
    );

    const startsAt = sql(
      stack,
      `select starts_at::text from public.meetup_confirmations where id = '${confirmed.confirmation_id}'`,
    );
    expect(lastMetAt(circleId)).toBe(startsAt);
    const home = (await as(owner, () => circleHome(circleId)))!;
    expect(home.lastMetAt).not.toBeNull();
    expect(home.morningAfter).toBeNull();
    // The note is trimmed, and "did the plan change outside?" is the answer's.
    expect(
      sql(
        stack,
        `select note || '|' || moved_outside from public.outcome_reports where confirmation_id = '${confirmed.confirmation_id}'`,
      ),
    ).toBe('Great night|false');
    // A member may still say they were there: that is the corroboration.
    expect(await as(ren.client, () => morningAfterOf(circleId))).toMatchObject({
      ask: 'attendance',
    });
  });

  it('"not sure" leaves when the circle last met alone', async () => {
    const { owner, circleId, confirmed } = await theMorningAfter();
    const { reportOutcome } = await import('./outcome');
    await as(owner, () =>
      reportOutcome({
        confirmationId: confirmed.confirmation_id,
        outcome: 'not_sure',
        movedOutside: false,
        key: globalThis.crypto.randomUUID() as never,
      }),
    );
    expect(lastMetAt(circleId)).toBe('never');
  });

  // Review round 2: the survey is its own tap. A catch-up that happened at a
  // time the chat settled on changed outside the app, and says so.
  it("stores the survey's own answer, not one read off the outcome", async () => {
    const { owner, confirmed } = await theMorningAfter();
    const { reportOutcome } = await import('./outcome');
    await as(owner, () =>
      reportOutcome({
        confirmationId: confirmed.confirmation_id,
        outcome: 'happened',
        movedOutside: true,
        key: globalThis.crypto.randomUUID() as never,
      }),
    );
    expect(
      sql(
        stack,
        `select moved_outside from public.outcome_reports where confirmation_id = '${confirmed.confirmation_id}'`,
      ),
    ).toBe('t');
  });

  it('"it was cancelled" stops asking members too', async () => {
    const { owner, ren, circleId, confirmed } = await theMorningAfter();
    const { morningAfterOf } = await import('./morning');
    const { reportOutcome } = await import('./outcome');
    await as(owner, () =>
      reportOutcome({
        confirmationId: confirmed.confirmation_id,
        outcome: 'cancelled',
        movedOutside: false,
        key: globalThis.crypto.randomUUID() as never,
      }),
    );
    expect(await as(ren.client, () => morningAfterOf(circleId))).toBeNull();
  });

  it('is refused before the evening has finished', async () => {
    const { owner, confirmed } = await lockedInOn(stack);
    const { reportOutcome } = await import('./outcome');
    await expect(
      as(owner, () =>
        reportOutcome({
          confirmationId: confirmed.confirmation_id,
          outcome: 'happened',
          movedOutside: false,
          key: globalThis.crypto.randomUUID() as never,
        }),
      ),
    ).rejects.toMatchObject({ reason: 'outcome_too_early' });
  });
});

describe("a member's answer", () => {
  it('goes through report-outcome and comes back as counts, never names', async () => {
    const { owner, ren, alex, circleId, confirmed } = await theMorningAfter();
    const { morningAfterOf } = await import('./morning');
    const { reportAttendance, reportOutcome } = await import('./outcome');

    const first = await as(ren.client, () =>
      reportAttendance({
        confirmationId: confirmed.confirmation_id,
        attendance: 'was_there',
        key: globalThis.crypto.randomUUID() as never,
      }),
    );
    // Nothing to corroborate until the organiser has said anything.
    expect(first).toEqual({ was_there: 1, missed: 0 });
    expect(await as(ren.client, () => morningAfterOf(circleId))).toBeNull();

    const second = await as(alex.client, () =>
      reportAttendance({
        confirmationId: confirmed.confirmation_id,
        attendance: 'missed',
        key: globalThis.crypto.randomUUID() as never,
      }),
    );
    // Alex can see how many, and could not have read Ren's row to count it.
    expect(second).toEqual({ was_there: 1, missed: 1 });

    const reported = await as(owner, () =>
      reportOutcome({
        confirmationId: confirmed.confirmation_id,
        outcome: 'happened',
        movedOutside: false,
        key: globalThis.crypto.randomUUID() as never,
      }),
    );
    expect(reported).toEqual({ corroboration: 'corroborated', was_there: 1, missed: 1 });
  });

  it('"Not now" stops the asking on this device', async () => {
    const { ren, circleId, confirmed } = await theMorningAfter();
    const { morningAfterOf, setAttendanceDismissed } = await import('./morning');
    await setAttendanceDismissed(ren.id, confirmed.confirmation_id);
    expect(await as(ren.client, () => morningAfterOf(circleId))).toBeNull();
  });
});
