import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

import { codeFor, readStackConfig, someone, sql, type Stack } from '../testing/stack.integration';

/**
 * ADR 0022's acceptance criterion, against the real thing.
 *
 * "A stranger with only a plan's short code becomes an active guest member and
 * a participant of that plan in one call, and `submit-availability` accepts
 * their answer." pgTAP proves `join_from_plan` and the handler tests prove
 * `join-plan`; neither can prove that the function, the definer, RLS and
 * `replace_response` agree about who a newcomer is — which is the whole of the
 * gap this closes. Before ADR 0022 the last step here was `not_a_participant`.
 *
 * Needs `pnpm db:start`. **If `join-plan` answers `BOOT_ERROR` or 404** on a
 * stack that was up before this function existed, the edge runtime has not
 * seen the new folder: `pnpm db:stop && pnpm db:start`.
 */

let stack: Stack;

function clientFor(role: string): SupabaseClient {
  return createClient(stack.url, stack.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // One storage key per person: two clients on one key race each other's
      // refreshes, which `client.ts` refuses in the app.
      storageKey: `circles.test.${role}`,
    },
  });
}

/** What a refused function call said, as the client would read it. */
async function refusalOf(error: unknown): Promise<{ status: number; reason?: string }> {
  const response = (error as { context?: Response }).context;
  if (response === undefined) throw new Error(`not an HTTP refusal: ${String(error)}`);
  const body = (await response.json()) as { reason?: string };
  return { status: response.status, ...(body.reason === undefined ? {} : { reason: body.reason }) };
}

/** An organiser with an account, a circle, and a plan asking it. */
async function organiserWithPlan(): Promise<{
  owner: SupabaseClient;
  planId: string;
  code: string;
}> {
  const owner = clientFor('organiser');
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
      // Named, not left to the default: a circle of one would default to two.
      quorum: 2,
    },
  });
  expect(plan.error).toBeNull();
  const created = plan.data as { plan_id: string; short_code: string };
  return { owner, planId: created.plan_id, code: created.short_code };
}

async function guest(role: string): Promise<SupabaseClient> {
  const client = clientFor(role);
  expect((await client.auth.signInAnonymously()).error).toBeNull();
  return client;
}

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
  // Ten joins an hour per address, and every run spends several from this one.
  sql(stack, 'delete from jobs.rate_counters');
});

describe('a stranger holding only a plan link', () => {
  it('joins as a guest, is asked by the plan, and can answer it', async () => {
    const { owner, planId, code } = await organiserWithPlan();
    const quorumBefore = sql(stack, `select quorum from public.plans where id = '${planId}'`);

    const ren = await guest('ren');
    const joined = await ren.functions.invoke('join-plan', {
      body: {
        idempotency_key: globalThis.crypto.randomUUID(),
        plan_code: code,
        display_name: 'Ren',
      },
    });
    expect(joined.error).toBeNull();
    const answer = joined.data as {
      plan_code: string;
      member_user_id: string;
      circle: { name: string };
    };
    expect(answer.plan_code).toBe(code);
    expect(answer.circle.name).toBe('Sunday Crew');

    // Through RLS, as Ren: a member reads the plan, which is how the app will
    // find the revision to answer.
    const { data: plan, error } = await ren
      .from('plans')
      .select('id, revision')
      .eq('short_code', code)
      .single();
    expect(error).toBeNull();
    expect(plan?.id).toBe(planId);

    const submitted = await ren.functions.invoke('submit-availability', {
      body: {
        idempotency_key: globalThis.crypto.randomUUID(),
        plan_id: planId,
        revision: plan?.revision,
        status: 'flexible',
      },
    });
    expect(submitted.error).toBeNull();

    expect(
      sql(
        stack,
        `select m.display_name_snapshot || '/' || m.status || '/' || u.is_anonymous
         from public.circle_members m join auth.users u on u.id = m.user_id
         where m.user_id = '${answer.member_user_id}'`,
      ),
    ).toBe('Ren/active/true');
    expect(sql(stack, `select quorum from public.plans where id = '${planId}'`)).toBe(quorumBefore);

    await owner.auth.signOut();
  });

  it('changes nothing when the same person opens the link again', async () => {
    const { planId, code } = await organiserWithPlan();
    const ren = await guest('ren-again');

    const first = await ren.functions.invoke('join-plan', {
      body: {
        idempotency_key: globalThis.crypto.randomUUID(),
        plan_code: code,
        display_name: 'Ren',
      },
    });
    expect(first.error).toBeNull();
    const version = sql(stack, `select input_version from public.plans where id = '${planId}'`);

    // A new key: a second tap on the link, not a network retry.
    const again = await ren.functions.invoke('join-plan', {
      body: { idempotency_key: globalThis.crypto.randomUUID(), plan_code: code },
    });
    expect(again.error).toBeNull();

    const userId = (first.data as { member_user_id: string }).member_user_id;
    expect(
      sql(stack, `select count(*) from public.circle_members where user_id = '${userId}'`),
    ).toBe('1');
    expect(sql(stack, `select input_version from public.plans where id = '${planId}'`)).toBe(
      version,
    );
  });

  it('is refused the same way by a code that does not exist and a plan that has stopped asking', async () => {
    const { owner, planId, code } = await organiserWithPlan();

    const cancelled = await owner.functions.invoke('cancel-plan', {
      body: { idempotency_key: globalThis.crypto.randomUUID(), plan_id: planId },
    });
    expect(cancelled.error).toBeNull();

    const stranger = await guest('stranger');
    const fromCancelled = await stranger.functions.invoke('join-plan', {
      body: {
        idempotency_key: globalThis.crypto.randomUUID(),
        plan_code: code,
        display_name: 'Ada',
      },
    });
    const fromNowhere = await stranger.functions.invoke('join-plan', {
      body: {
        idempotency_key: globalThis.crypto.randomUUID(),
        plan_code: 'zzzzzzzz',
        display_name: 'Ada',
      },
    });

    const refusals = [await refusalOf(fromCancelled.error), await refusalOf(fromNowhere.error)];
    expect(refusals).toEqual([
      { status: 404, reason: 'invite_inactive' },
      { status: 404, reason: 'invite_inactive' },
    ]);
  });
});
