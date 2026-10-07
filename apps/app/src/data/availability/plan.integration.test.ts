import type { ShortCode } from '@circles/contracts';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

import { codeFor, readStackConfig, someone, sql, type Stack } from '../testing/stack.integration';

/**
 * SUS-130 against the real stack: an edit that moves the revision clears the
 * answers (spec §5.3) but keeps the rows, and somebody whose answer it cleared
 * is told so — by the editor (`planToAnswer`'s `answeredEarlierRevision`) and
 * by circle home (`askedAgain`) — through RLS as themselves, with no draft on
 * any device.
 *
 * What it proves that the screen tests cannot: that `plan_responses_select_own`
 * lets a member read their own row on an earlier revision, and lets nobody
 * else read it.
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

const key = () => globalThis.crypto.randomUUID();

/** Run a read or a write as this person, through the app's own singleton client. */
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

async function organiserWithPlan(): Promise<{
  owner: SupabaseClient;
  circleId: string;
  planId: string;
  code: string;
}> {
  const owner = clientFor(`organiser-${key()}`);
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
      idempotency_key: key(),
      name: 'Sunday Crew',
      color: 'clay',
      time_zone: 'Australia/Melbourne',
      cadence: 'monthly',
    },
  });
  expect(circle.error).toBeNull();
  const circleId = (circle.data as { circle: { id: string } }).circle.id;

  const plan = await owner.functions.invoke('create-plan', {
    body: {
      idempotency_key: key(),
      circle_id: circleId,
      title: 'Catch up',
      preset: 'next_14_days',
      quorum: 2,
    },
  });
  expect(plan.error).toBeNull();
  const created = plan.data as { plan_id: string; short_code: string };
  return { owner, circleId, planId: created.plan_id, code: created.short_code };
}

async function joins(code: string, name: string): Promise<SupabaseClient> {
  const client = clientFor(`${name}-${key()}`);
  expect((await client.auth.signInAnonymously()).error).toBeNull();
  const joined = await client.functions.invoke('join-plan', {
    body: { idempotency_key: key(), plan_code: code, display_name: name },
  });
  expect(joined.error).toBeNull();
  return client;
}

async function answers(client: SupabaseClient, planId: string): Promise<void> {
  const { data: plan } = await client
    .from('plans')
    .select('revision')
    .eq('id', planId)
    .single<{ revision: number }>();
  const sent = await client.functions.invoke('submit-availability', {
    body: {
      idempotency_key: key(),
      plan_id: planId,
      revision: plan?.revision,
      status: 'flexible',
    },
  });
  expect(sent.error).toBeNull();
}

/**
 * A day on the end of the window: a new question, so the answers are cleared.
 * Not a day off the front: an "I'm easy" picks no day, so taking one away
 * that nobody picked is a narrowing and keeps every answer (ADR 0047).
 */
async function organiserWidens(owner: SupabaseClient, planId: string): Promise<void> {
  const { planDetails } = await import('../planning/read');
  const { previewRevision, saveRevision } = await import('../planning/revise');
  const { newIdempotencyKey } = await import('../functions');
  const before = (await as(owner, () => planDetails({ planId })))!;
  const after = new Date(`${before.windowEnd}T12:00:00Z`);
  after.setUTCDate(after.getUTCDate() + 1);
  const edit = { window: { start: before.windowStart, end: after.toISOString().slice(0, 10) } };
  const preview = await as(owner, () => previewRevision(planId, edit));
  expect(preview.bumps_revision).toBe(true);
  const saved = await as(owner, () =>
    saveRevision(planId, edit, preview.version, newIdempotencyKey()),
  );
  expect(saved.revision).toBe(before.revision + 1);
}

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
  sql(stack, 'delete from jobs.rate_counters');
});

describe('an answer an edit cleared (SUS-130)', () => {
  it('is known to the person it was, until they answer again, and to nobody else', async () => {
    const { owner, circleId, planId, code } = await organiserWithPlan();
    const ren = await joins(code, 'Ren');
    const alex = await joins(code, 'Alex');
    await answers(ren, planId);
    await organiserWidens(owner, planId);

    const { planToAnswer } = await import('./plan');
    const { circleHome } = await import('../circles/home');
    const read = (who: SupabaseClient) => as(who, () => planToAnswer(code as ShortCode));
    const card = async (who: SupabaseClient) =>
      (await as(who, () => circleHome(circleId)))?.activePlan?.askedAgain;

    // Ren answered the first question and not this one.
    const renSees = (await read(ren))!;
    expect(renSees.plan.revision).toBe(2);
    expect(renSees.answer).toBeNull();
    expect(renSees.answeredEarlierRevision).toBe(true);
    expect(await card(ren)).toBe(true);

    // Alex never answered: a revised plan is just a plan to them.
    const alexSees = (await read(alex))!;
    expect(alexSees.answer).toBeNull();
    expect(alexSees.answeredEarlierRevision).toBe(false);
    expect(await card(alex)).toBe(false);

    // Ren's earlier row is Ren's alone: Alex reads none of the plan's answers.
    const { data: visible, error } = await alex
      .from('plan_responses')
      .select('id')
      .eq('plan_id', planId);
    expect(error).toBeNull();
    expect(visible).toEqual([]);

    // Once Ren answers the question as it is now, nothing more is said.
    await answers(ren, planId);
    const after = (await read(ren))!;
    expect(after.answer).not.toBeNull();
    expect(await card(ren)).toBe(false);
  });

  it('is not said on circle home once replies have closed (review round 1)', async () => {
    const { owner, circleId, planId, code } = await organiserWithPlan();
    const ren = await joins(code, 'Ren');
    await answers(ren, planId);
    await organiserWidens(owner, planId);

    const { circleHome } = await import('../circles/home');
    const card = async () => (await as(ren, () => circleHome(circleId)))?.activePlan?.askedAgain;
    expect(await card()).toBe(true);

    // Past its deadline the plan is still finding a time — the organiser
    // decides (spec §8) — but it is not asking anybody to add anything.
    sql(
      stack,
      `update public.plans set response_deadline = now() - interval '1 minute' where id = '${planId}'`,
    );
    expect(await card()).toBe(false);
  });
});

describe('previous times (SUS-159)', () => {
  it('are read through the function, as the signed-in person alone, and as text', async () => {
    const { owner, circleId, planId, code } = await organiserWithPlan();
    const ren = await joins(code, 'Ren');
    const alex = await joins(code, 'Alex');
    const idOf = async (who: SupabaseClient) => (await who.auth.getUser()).data.user!.id;
    const organiser = await idOf(owner);
    const [earlier, renRow, alexRow] = [key(), key(), key()];
    const shortCode = `p${earlier.replace(/[^2-9a-f]/g, '').slice(0, 8)}`;

    // An earlier plan in the circle, answered with times: Ren on a Thursday
    // evening, Alex on a Saturday morning. Written as the database holds
    // them, since no client may write another plan's answers.
    sql(
      stack,
      `insert into public.plans (id, circle_id, mode, state, organiser_user_id, title, time_zone,
         window_start, window_end, daily_start_local, daily_end_local, duration_minutes, quorum,
         response_deadline, short_code)
       values ('${earlier}', '${circleId}', 'named', 'cancelled',
         '${organiser}', 'Earlier', 'Australia/Melbourne', '2099-08-13', '2099-08-16', 0, 1440, 60, 2,
         timestamptz '2099-08-13T00:00:00+10', '${shortCode}');
       insert into public.plan_responses (id, plan_id, revision, user_id, status) values
         ('${renRow}', '${earlier}', 1, '${await idOf(ren)}', 'windows'),
         ('${alexRow}', '${earlier}', 1, '${await idOf(alex)}', 'windows');
       insert into public.willing_windows (response_id, starts_at, ends_at) values
         ('${renRow}', timestamptz '2099-08-13T18:00:00+10', timestamptz '2099-08-13T20:00:00+10'),
         ('${alexRow}', timestamptz '2099-08-15T09:00:00+10', timestamptz '2099-08-15T11:00:00+10');`,
    );

    const { usualTimes } = await import('./usual');
    // The plan being answered asks about evenings, weekday and weekend.
    expect(await as(ren, () => usualTimes(planId))).toEqual(['weekday_evening']);
    // Alex offered a Saturday morning, which this plan does not ask about,
    // and never sees Ren's Thursday evening.
    expect(await as(alex, () => usualTimes(planId))).toEqual([]);
    // Somebody who answered nothing is offered nothing.
    const sam = await joins(code, 'Sam');
    expect(await as(sam, () => usualTimes(planId))).toEqual([]);
  });
});
