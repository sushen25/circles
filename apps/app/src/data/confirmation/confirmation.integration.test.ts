import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { codeFor, readStackConfig, someone, sql, type Stack } from '../testing/stack.integration';

/**
 * Locking a time in and reading it back, against the real database, as the
 * people who do it (S1-28).
 *
 * pgTAP proves the policies and the trigger; the handler tests prove
 * `confirm-meetup` and `generate-ics`. Neither proves what the screens depend
 * on: that the **app's own** calls — the review's `confirmMeetup` with the set
 * it read, the confirmed screen's read, a member's own attendance write and
 * the calendar fetch — do what the screens say, through RLS, and that a member
 * cannot move anybody's answer but their own.
 *
 * Needs `pnpm db:start`.
 */

let stack: Stack;

function clientFor(role: string): SupabaseClient {
  return createClient(stack.url, stack.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `circles.test.${role}`,
    },
  });
}

/** Act as this person, through the app's own singleton client. */
async function as<T>(who: SupabaseClient, act: () => Promise<T>): Promise<T> {
  const { authClient } = await import('../auth/client');
  const { data } = await who.auth.getSession();
  const session = data.session;
  if (session === null) throw new Error('that client has no session');
  const set = await authClient().auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  expect(set.error).toBeNull();
  return act();
}

async function organiserWithPlan() {
  const owner = clientFor(`organiser-${Math.random()}`);
  const address = someone('organiser');
  expect((await owner.auth.signInWithOtp({ email: address })).error).toBeNull();
  const verified = await owner.auth.verifyOtp({
    email: address,
    token: await codeFor(stack.mailpit, address),
    type: 'email',
  });
  expect(verified.error).toBeNull();

  const circle = await owner.functions.invoke('create-circle', {
    body: {
      idempotency_key: globalThis.crypto.randomUUID(),
      name: 'Sunday Crew',
      color: 'sky',
      time_zone: 'Australia/Melbourne',
      cadence: 'fortnightly',
    },
  });
  expect(circle.error).toBeNull();
  const circleId = (circle.data as { circle: { id: string } }).circle.id;

  const plan = await owner.functions.invoke('create-plan', {
    body: {
      idempotency_key: globalThis.crypto.randomUUID(),
      circle_id: circleId,
      title: 'Catch up',
      preset: 'next_14_days',
      quorum: 2,
    },
  });
  expect(plan.error).toBeNull();
  const created = plan.data as { plan_id: string; short_code: string };
  return {
    owner,
    ownerId: verified.data.user?.id ?? '',
    circleId,
    planId: created.plan_id,
    code: created.short_code,
  };
}

async function joins(code: string, name: string): Promise<{ client: SupabaseClient; id: string }> {
  const client = clientFor(`${name}-${Math.random()}`);
  expect((await client.auth.signInAnonymously()).error).toBeNull();
  const joined = await client.functions.invoke('join-plan', {
    body: { idempotency_key: globalThis.crypto.randomUUID(), plan_code: code, display_name: name },
  });
  expect(joined.error).toBeNull();
  return { client, id: (joined.data as { member_user_id: string }).member_user_id };
}

async function answers(client: SupabaseClient, planId: string): Promise<void> {
  const { data: plan } = await client
    .from('plans')
    .select('revision')
    .eq('id', planId)
    .single<{ revision: number }>();
  const sent = await client.functions.invoke('submit-availability', {
    body: {
      idempotency_key: globalThis.crypto.randomUUID(),
      plan_id: planId,
      revision: plan?.revision,
      status: 'flexible',
    },
  });
  expect(sent.error).toBeNull();
}

/** Maya and Ren answer, Alex does not, and Maya locks in the first option. */
async function lockedIn() {
  const plan = await organiserWithPlan();
  const ren = await joins(plan.code, 'Ren');
  const alex = await joins(plan.code, 'Alex');
  await answers(ren.client, plan.planId);
  await answers(plan.owner, plan.planId);

  const { planCandidates } = await import('../scheduling');
  const { confirmMeetup } = await import('./write');
  const options = (await as(plan.owner, () => planCandidates({ planId: plan.planId })))!;
  const first = options.candidates[0]!;
  const confirmed = await as(plan.owner, () =>
    confirmMeetup({
      planId: plan.planId,
      candidateId: first.id,
      expectedSetId: options.set!.id,
      chasedAnswer: 'one',
      placeName: 'Hope St Radio',
      note: 'Come hungry.',
    }),
  );
  return { ...plan, ren, alex, confirmed };
}

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
});

// Every test joins two or three people from one address, which is what the
// join limit exists to stop; it is not what these tests are about.
beforeEach(() => {
  sql(stack, 'delete from jobs.rate_counters');
});

describe('the confirmed meetup', () => {
  it('reads back as locked in, with who is going and who has still to say', async () => {
    const { owner, ownerId, planId, ren, alex, confirmed } = await lockedIn();
    const { planConfirmation } = await import('./read');

    const seen = (await as(owner, () => planConfirmation({ planId })))!;
    expect(seen.view).toBe('confirmed');
    expect(seen.isOrganiser).toBe(true);
    expect(seen.confirmation?.id).toBe(confirmed.confirmation_id);
    expect(seen.confirmation?.placeName).toBe('Hope St Radio');
    const status = new Map(seen.attendance.map((a) => [a.userId, a.status]));
    expect(status.get(ownerId)).toBe('going');
    expect(status.get(ren.id)).toBe('going');
    // Alex never answered: "to confirm", never inside "going" (§5.6).
    expect(status.get(alex.id)).toBe('unknown');
  });

  it("is past once it has ended by the database's clock, whatever the phone says", async () => {
    const { owner, planId, confirmed } = await lockedIn();
    sql(
      stack,
      `update public.meetup_confirmations set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = '${confirmed.confirmation_id}'`,
    );
    const { planConfirmation } = await import('./read');
    const seen = (await as(owner, () => planConfirmation({ planId })))!;
    expect(seen.view).toBe('past');
  });

  it('is past, not off, when the organiser reports that it did not happen', async () => {
    const { owner, planId, confirmed } = await lockedIn();
    sql(
      stack,
      `update public.meetup_confirmations set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = '${confirmed.confirmation_id}'`,
    );
    const reported = await owner.functions.invoke('report-outcome', {
      body: {
        idempotency_key: globalThis.crypto.randomUUID(),
        confirmation_id: confirmed.confirmation_id,
        outcome: 'cancelled',
        moved_outside: false,
      },
    });
    expect(reported.error).toBeNull();
    const { planConfirmation } = await import('./read');
    const seen = (await as(owner, () => planConfirmation({ planId })))!;
    expect(seen.state).toBe('completed');
    expect(seen.confirmation?.status).toBe('cancelled');
    expect(seen.view).toBe('past');
  });

  it("is the same meetup to a member, on the plan's code", async () => {
    const { code, ren, confirmed } = await lockedIn();
    const { planConfirmation } = await import('./read');
    const seen = (await as(ren.client, () => planConfirmation({ code })))!;
    expect(seen.isOrganiser).toBe(false);
    expect(seen.confirmation?.id).toBe(confirmed.confirmation_id);
  });

  it('refuses a second confirmation from a set that has been replaced', async () => {
    const plan = await organiserWithPlan();
    const ren = await joins(plan.code, 'Ren');
    await answers(ren.client, plan.planId);
    await answers(plan.owner, plan.planId);
    const { planCandidates } = await import('../scheduling');
    const { confirmMeetup } = await import('./write');
    const options = (await as(plan.owner, () => planCandidates({ planId: plan.planId })))!;

    // Somebody answers while the review screen is open: a new set.
    const tom = await joins(plan.code, 'Tom');
    await answers(tom.client, plan.planId);

    await expect(
      as(plan.owner, () =>
        confirmMeetup({
          planId: plan.planId,
          candidateId: options.candidates[0]!.id,
          expectedSetId: options.set!.id,
          chasedAnswer: 'none',
        }),
      ),
    ).rejects.toMatchObject({ reason: 'stale_candidates' });
  });
});

describe('attendance', () => {
  it("lets a member change their own answer and back, and nobody else's", async () => {
    const { ownerId, planId, ren, confirmed } = await lockedIn();
    const { setAttendance, AttendanceError } = await import('./write');
    const { planConfirmation } = await import('./read');

    await as(ren.client, () => setAttendance(confirmed.confirmation_id, ren.id, 'cant'));
    let seen = (await as(ren.client, () => planConfirmation({ planId })))!;
    expect(seen.attendance.find((a) => a.userId === ren.id)?.status).toBe('cant');

    await as(ren.client, () => setAttendance(confirmed.confirmation_id, ren.id, 'going'));
    seen = (await as(ren.client, () => planConfirmation({ planId })))!;
    expect(seen.attendance.find((a) => a.userId === ren.id)?.status).toBe('going');

    // The organiser's row is not Ren's to move; RLS finds nothing to update.
    await expect(
      as(ren.client, () => setAttendance(confirmed.confirmation_id, ownerId, 'cant')),
    ).rejects.toBeInstanceOf(AttendanceError);
    seen = (await as(ren.client, () => planConfirmation({ planId })))!;
    expect(seen.attendance.find((a) => a.userId === ownerId)?.status).toBe('going');
  });
});

describe('the calendar file', () => {
  it('comes back as a calendar for a member, with no secret in it', async () => {
    const { ren, confirmed } = await lockedIn();
    const { calendarFile } = await import('./write');
    const file = await as(ren.client, () => calendarFile(confirmed.confirmation_id));
    expect(file.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(file).toContain('STATUS:CONFIRMED');
    expect(file).not.toMatch(/#|token=/);
  });

  it('is nothing to somebody outside the circle', async () => {
    const { confirmed } = await lockedIn();
    const stranger = clientFor(`stranger-${Math.random()}`);
    expect((await stranger.auth.signInAnonymously()).error).toBeNull();
    const { calendarFile } = await import('./write');
    await expect(as(stranger, () => calendarFile(confirmed.confirmation_id))).rejects.toMatchObject(
      { reason: 'confirmation_not_found' },
    );
  });
});
