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

/** A day off the front of the window: a new question, so the answers are cleared. */
async function organiserNarrows(owner: SupabaseClient, planId: string): Promise<void> {
  const { planDetails } = await import('../planning/read');
  const { previewRevision, saveRevision } = await import('../planning/revise');
  const { newIdempotencyKey } = await import('../functions');
  const before = (await as(owner, () => planDetails({ planId })))!;
  const next = new Date(`${before.windowStart}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const edit = { window: { start: next.toISOString().slice(0, 10), end: before.windowEnd } };
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
    await organiserNarrows(owner, planId);

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
    await organiserNarrows(owner, planId);

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
