import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

import { codeFor, readStackConfig, someone, sql, type Stack } from '../testing/stack.integration';

/**
 * The plan lifecycle's data layer against the real stack (S1-26): the read
 * EditPlan prefills from, the preview-then-save contract with its version,
 * and a cancellation's note reaching a member through RLS.
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

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
  sql(stack, 'delete from jobs.rate_counters');
});

describe('the plan read', () => {
  it('gives the organiser what EditPlan prefills, with who is asked and who is required', async () => {
    const { owner, ownerId, planId } = await organiserWithPlan();
    const { planDetails } = await import('./read');
    const plan = (await as(owner, () => planDetails({ planId })))!;

    expect(plan.isOrganiser).toBe(true);
    expect(plan.isOwner).toBe(true);
    expect(plan.state).toBe('collecting');
    expect(plan.quorum).toBe(2);
    expect(plan.quorumChosen).toBe(true);
    // The organiser is required by default (spec §5.3), and is the one asked so far.
    expect(plan.required).toEqual([ownerId]);
    expect(plan.participants).toEqual([ownerId]);
    expect(plan.band).toEqual({ startMin: 1050, endMin: 1350 });
    expect(plan.deadlinePassed).toBe(false);
    expect(plan.lastConfirmation).toBeNull();
  });
});

describe('preview, then save with the token', () => {
  it('names exactly who is asked again, and refuses a save once somebody has answered since', async () => {
    const { owner, ownerId, planId, code } = await organiserWithPlan();
    const ren = await joins(code, 'Ren');
    const alex = await joins(code, 'Alex');
    await answers(ren.client, planId);
    await answers(owner, planId);

    const { planDetails } = await import('./read');
    const { previewRevision, saveRevision } = await import('./revise');
    const { newIdempotencyKey } = await import('../functions');
    const before = (await as(owner, () => planDetails({ planId })))!;
    // A day shorter at the front: the deadline three days out still fits.
    const next = new Date(`${before.windowStart}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const later = { start: next.toISOString().slice(0, 10), end: before.windowEnd };
    const edit = { window: later };

    const preview = await as(owner, () => previewRevision(planId, edit));
    expect(preview.bumps_revision).toBe(true);
    expect(new Set(preview.asked_again)).toEqual(new Set([ownerId, ren.id]));
    expect(preview.fresh_ask).toEqual([alex.id]);

    // Alex answers between the preview and the save: the cost has moved.
    await answers(alex.client, planId);
    await expect(
      as(owner, () => saveRevision(planId, edit, preview.version, newIdempotencyKey())),
    ).rejects.toMatchObject({ reason: 'preview_is_stale' });

    const again = await as(owner, () => previewRevision(planId, edit));
    expect(again.fresh_ask).toEqual([]);
    const saved = await as(owner, () =>
      saveRevision(planId, edit, again.version, newIdempotencyKey()),
    );
    expect(saved.revision).toBe(before.revision + 1);
    const after = (await as(owner, () => planDetails({ planId })))!;
    expect({ start: after.windowStart, end: after.windowEnd }).toEqual(later);
  });

  it('adjusts a quorum without a new revision, and refuses an edit that changes nothing', async () => {
    const { owner, planId } = await organiserWithPlan();
    const { previewRevision, saveRevision } = await import('./revise');
    const { newIdempotencyKey } = await import('../functions');

    const preview = await as(owner, () => previewRevision(planId, { quorum: 3 }));
    expect(preview.bumps_revision).toBe(false);
    expect(preview.asked_again).toEqual([]);
    const saved = await as(owner, () =>
      saveRevision(planId, { quorum: 3 }, preview.version, newIdempotencyKey()),
    );
    expect(saved.revision).toBe(1);

    await expect(as(owner, () => previewRevision(planId, { quorum: 3 }))).rejects.toMatchObject({
      reason: 'nothing_to_change',
    });
  });
});

describe('cancelling', () => {
  it("puts the organiser's note where a member can read it, and ends the plan", async () => {
    const { owner, planId, code } = await organiserWithPlan();
    const ren = await joins(code, 'Ren');
    const { cancelPlan } = await import('./revise');
    const { newIdempotencyKey } = await import('../functions');
    await as(owner, () => cancelPlan(planId, '  Next month instead.  ', newIdempotencyKey()));

    const { planDetails } = await import('./read');
    const seen = (await as(ren.client, () => planDetails({ code })))!;
    expect(seen.state).toBe('cancelled');
    expect(seen.cancelNote).toBe('Next month instead.');
    expect(seen.isOrganiser).toBe(false);
    expect(seen.isOwner).toBe(false);
  });
});
