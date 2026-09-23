import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

import { codeFor, readStackConfig, someone, sql, type Stack } from '../testing/stack.integration';

/**
 * `planCandidates` against the real database, as the people who read it.
 *
 * pgTAP proves the policies allow and deny; the handler tests prove the engine.
 * Neither can prove the thing this screen depends on: that **one read through
 * RLS** gives a member the options, the roster, who was asked and who has
 * answered — and gives them nothing about anybody's windows. Two of the
 * ticket's acceptance criteria are about exactly that:
 *
 * - a non-responder never appears inside the available set, and
 * - who has answered is the organiser's to see before options exist, not the
 *   circle's (`response_summaries`).
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

/** Read the plan as this person, through the app's own singleton client. */
async function reading<T>(who: SupabaseClient, read: () => Promise<T>): Promise<T> {
  const { authClient } = await import('../auth/client');
  const { data } = await who.auth.getSession();
  const session = data.session;
  if (session === null) throw new Error('that client has no session');
  const set = await authClient().auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  expect(set.error).toBeNull();
  return read();
}

async function organiserWithPlan(): Promise<{
  owner: SupabaseClient;
  ownerId: string;
  circleId: string;
  planId: string;
  code: string;
}> {
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
      // Named, so a join does not move it (ADR 0026) and the test is about
      // the read rather than about the quorum.
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
    body: {
      idempotency_key: globalThis.crypto.randomUUID(),
      plan_code: code,
      display_name: name,
    },
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

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
  sql(stack, 'delete from jobs.rate_counters');
});

describe('the candidates read', () => {
  it('gives the organiser the options, the roster and who has answered', async () => {
    const { owner, ownerId, planId, code } = await organiserWithPlan();
    const ren = await joins(code, 'Ren');
    const alex = await joins(code, 'Alex');

    await answers(ren.client, planId);
    await answers(owner, planId);

    const { planCandidates } = await import('./candidates');
    const seen = await reading(owner, () => planCandidates({ planId }));
    expect(seen).not.toBeNull();
    const data = seen as NonNullable<typeof seen>;

    expect(data.view).toBe('ready');
    expect(data.isOrganiser).toBe(true);
    expect(data.code).toBe(code);
    expect(data.askedCount).toBe(3);
    expect(data.repliedCount).toBe(2);
    expect(new Set(data.responded ?? [])).toEqual(new Set([ownerId, ren.id]));
    expect(data.candidates.length).toBeGreaterThan(0);
    expect(data.stale).toBe(false);

    // The acceptance criterion: Alex never appears inside "can make it".
    for (const candidate of data.candidates) {
      expect(candidate.availableUserIds).not.toContain(alex.id);
      expect(candidate.availableUserIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives a member the same options, and no windows of anybody else', async () => {
    const { owner, planId, code } = await organiserWithPlan();
    const ren = await joins(code, 'Ren');
    await answers(ren.client, planId);
    await answers(owner, planId);

    const { planCandidates } = await import('./candidates');
    const seen = await reading(ren.client, () => planCandidates({ code }));
    const data = seen as NonNullable<typeof seen>;

    expect(data.view).toBe('ready');
    expect(data.isOrganiser).toBe(false);
    expect(data.planId).toBe(planId);
    expect(data.candidates.length).toBeGreaterThan(0);
    // Options exist, so the summaries have opened to the circle (§5.6).
    expect(data.responded).not.toBeNull();
    expect(Object.keys(data.candidates[0] ?? {})).not.toContain('windows');
  });

  it('shows the organiser what has come in, and a member nothing, before options exist', async () => {
    const { owner, planId, code } = await organiserWithPlan();
    const ren = await joins(code, 'Ren');

    const { planCandidates } = await import('./candidates');
    const asOrganiser = (await reading(owner, () => planCandidates({ planId })))!;
    expect(asOrganiser.view).toBe('collecting');
    expect(asOrganiser.responded).toEqual([]);
    expect(asOrganiser.repliedCount).toBe(0);
    expect(asOrganiser.askedCount).toBe(2);

    const asMember = (await reading(ren.client, () => planCandidates({ code })))!;
    expect(asMember.view).toBe('collecting');
    expect(asMember.responded).toBeNull();
  });

  it('is nothing at all to somebody who is not in the circle', async () => {
    const { planId } = await organiserWithPlan();
    const stranger = clientFor(`stranger-${Math.random()}`);
    expect((await stranger.auth.signInAnonymously()).error).toBeNull();

    const { planCandidates } = await import('./candidates');
    expect(await reading(stranger, () => planCandidates({ planId }))).toBeNull();
  });
});
