import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { newIdempotencyKey } from '../functions';
import {
  as,
  lockedIn,
  nextOneLockedIn,
  organiserWithPlan,
} from '../testing/meetup.integration';
import { readStackConfig, sql, type Stack } from '../testing/stack.integration';

/**
 * `record-nudge` against the real database, as the guest it asks about
 * (S2-07): the caps hold across requests, the 30-day back-off runs from the
 * second "not now", the after-attendance prompt waits for "I was there", and a
 * plan in somebody else's circle is refused.
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

async function ask(moment: string, planId: string) {
  const { askToShow } = await import('.');
  return askToShow({ moment: moment as never, planId }, newIdempotencyKey());
}

async function answer(moment: string, planId: string, what: 'dismissed' | 'tapped') {
  const { recordAnswer } = await import('.');
  await recordAnswer({ moment: moment as never, planId }, what, newIdempotencyKey());
}

describe('record-nudge', () => {
  it('holds the app prompts for 30 days after two "not now"s, and nothing else', async () => {
    const meetup = await lockedIn(stack);
    const next = await nextOneLockedIn(meetup);
    const ren = meetup.ren.client;

    await as(ren, async () => {
      expect(await ask('second_response_app', meetup.planId)).toEqual({ suppressed: false });
      await answer('second_response_app', meetup.planId, 'dismissed');
      expect(await ask('email_given_app', meetup.planId)).toEqual({ suppressed: false });
      await answer('email_given_app', meetup.planId, 'dismissed');

      expect(await ask('locked_in_app', next.planId)).toEqual({
        suppressed: true,
        reason: 'backed_off',
      });
      // The email card is not an app prompt, and is not held.
      expect(await ask('sent_save_access', next.planId)).toEqual({ suppressed: false });
    });

    // A month on: the back-off counts from when the second answer was given.
    sql(
      stack,
      `alter table public.nudge_states disable trigger nudge_states_stamp_answer;
       update public.nudge_states set answered_at = answered_at - interval '30 days'
       where plan_id = '${meetup.planId}';
       alter table public.nudge_states enable trigger nudge_states_stamp_answer;`,
    );
    await as(ren, async () => {
      expect(await ask('locked_in_app', next.planId)).toEqual({ suppressed: false });
    });
  });

  it('says yes once per moment and plan, whichever request asks second', async () => {
    const meetup = await lockedIn(stack);
    await as(meetup.ren.client, async () => {
      const [first, second] = await Promise.all([
        ask('sent_save_access', meetup.planId),
        ask('sent_save_access', meetup.planId),
      ]);
      expect([first.suppressed, second.suppressed].sort()).toEqual([false, true]);
    });
    expect(
      sql(
        stack,
        `select count(*) from public.nudge_states where plan_id = '${meetup.planId}' and moment = 'sent_save_access'`,
      ),
    ).toBe('1');
  });

  it('asks to start a circle only after "I was there", on the circle\'s first meetup', async () => {
    const meetup = await lockedIn(stack);
    sql(
      stack,
      `update public.meetup_confirmations set starts_at = now() - interval '50 hours', ends_at = now() - interval '48 hours' where id = '${meetup.confirmed.confirmation_id}'`,
    );

    await as(meetup.ren.client, async () => {
      expect(await ask('after_attendance_start_circle', meetup.planId)).toEqual({
        suppressed: true,
        reason: 'not_the_moment',
      });

      const { reportAttendance } = await import('../confirmation/outcome');
      await reportAttendance({
        confirmationId: meetup.confirmed.confirmation_id,
        attendance: 'was_there',
        key: newIdempotencyKey(),
      });

      expect(await ask('after_attendance_start_circle', meetup.planId)).toEqual({
        suppressed: false,
      });
      expect(await ask('after_attendance_start_circle', meetup.planId)).toEqual({
        suppressed: true,
        reason: 'already_shown',
      });
    });
  });

  it('refuses a plan in a circle the caller is not in', async () => {
    const mine = await lockedIn(stack);
    const theirs = await organiserWithPlan(stack);
    await as(mine.ren.client, async () => {
      await expect(ask('sent_save_access', theirs.planId)).rejects.toMatchObject({
        problem: expect.objectContaining({ reason: 'not_a_member' }),
      });
    });
  });
});
