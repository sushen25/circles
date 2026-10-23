import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

import { codeFor, readStackConfig, someone, sql, type Stack } from '../testing/stack.integration';

/**
 * S1-23's acceptance criteria, against the running stack: the owner's link
 * shown again, a reset that kills the old link while members stay, and a
 * removal that takes somebody out of the circle and out of the next
 * recalculation.
 *
 * pgTAP proves `live_invite`, `issue_invite` and `remove_member`, and the
 * handler tests prove the three functions' use of them. Neither proves that the
 * derivation in `get-invite-link` agrees with the one in `rotate-invite` and
 * `create-circle` under the stack's real `INVITE_LINK_KEY`, or that a removal
 * reaches the engine — which is what this is for.
 *
 * Needs `pnpm db:start`. **If a function answers `BOOT_ERROR` or 404** on a
 * stack that was up before it existed: `pnpm db:stop && pnpm db:start`.
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

async function refusalOf(error: unknown): Promise<{ status: number; reason?: string }> {
  const response = (error as { context?: Response }).context;
  if (response === undefined) throw new Error(`not an HTTP refusal: ${String(error)}`);
  const body = (await response.json()) as { reason?: string };
  return { status: response.status, ...(body.reason === undefined ? {} : { reason: body.reason }) };
}

const key = () => globalThis.crypto.randomUUID();

async function owner(): Promise<SupabaseClient> {
  const client = clientFor(`owner-${key()}`);
  const address = someone('owner');
  expect((await client.auth.signInWithOtp({ email: address })).error).toBeNull();
  const verified = await client.auth.verifyOtp({
    email: address,
    token: await codeFor(stack.mailpit, address),
    type: 'email',
  });
  expect(verified.error).toBeNull();
  return client;
}

async function circleOf(client: SupabaseClient): Promise<{ circleId: string; secret: string }> {
  const made = await client.functions.invoke('create-circle', {
    body: {
      idempotency_key: key(),
      name: 'Sunday Crew',
      color: 'clay',
      time_zone: 'Australia/Melbourne',
      cadence: 'monthly',
    },
  });
  expect(made.error).toBeNull();
  const data = made.data as { circle: { id: string }; invite_secret: string };
  return { circleId: data.circle.id, secret: data.invite_secret };
}

async function guestJoining(secret: string, name: string): Promise<SupabaseClient> {
  const client = clientFor(`guest-${key()}`);
  expect((await client.auth.signInAnonymously()).error).toBeNull();
  const joined = await client.functions.invoke('redeem-invite', {
    body: { idempotency_key: key(), secret, display_name: name },
  });
  expect(joined.error).toBeNull();
  return client;
}

async function linkOf(client: SupabaseClient, circleId: string): Promise<string | null> {
  const shown = await client.functions.invoke('get-invite-link', { body: { circle_id: circleId } });
  expect(shown.error).toBeNull();
  return (shown.data as { invite_secret: string | null }).invite_secret;
}

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
  sql(stack, 'delete from jobs.rate_counters');
});

describe('the invite link', () => {
  it('is shown to any member of the circle, and to nobody outside it', async () => {
    const maya = await owner();
    const { circleId, secret } = await circleOf(maya);

    expect(await linkOf(maya, circleId)).toBe(secret);

    // A guest member shares it too (SUS-248): anyone in the circle can Add someone.
    const nina = await guestJoining(secret, 'Nina');
    expect(await linkOf(nina, circleId)).toBe(secret);

    const stranger = clientFor(`stranger-${key()}`);
    expect((await stranger.auth.signInAnonymously()).error).toBeNull();
    const refused = await stranger.functions.invoke('get-invite-link', {
      body: { circle_id: circleId },
    });
    expect(await refusalOf(refused.error)).toEqual({ status: 403, reason: 'not_a_member' });
  });

  it('stops working when it is reset, and everybody already in stays in', async () => {
    const maya = await owner();
    const { circleId, secret: old } = await circleOf(maya);
    const nina = await guestJoining(old, 'Nina');

    const rotated = await maya.functions.invoke('rotate-invite', {
      body: { idempotency_key: key(), circle_id: circleId },
    });
    expect(rotated.error).toBeNull();
    const fresh = (rotated.data as { invite_secret: string }).invite_secret;
    expect(fresh).not.toBe(old);
    expect(await linkOf(maya, circleId)).toBe(fresh);

    const late = clientFor(`late-${key()}`);
    expect((await late.auth.signInAnonymously()).error).toBeNull();
    const withOld = await late.functions.invoke('redeem-invite', {
      body: { idempotency_key: key(), secret: old, display_name: 'Tom' },
    });
    expect(await refusalOf(withOld.error)).toEqual({ status: 404, reason: 'invite_inactive' });

    const { data: seen } = await nina.from('circles').select('id').eq('id', circleId);
    expect(seen).toHaveLength(1);

    await guestJoining(fresh, 'Jess');
    expect(
      sql(
        stack,
        `select count(*) from public.circle_members where circle_id = '${circleId}' and status = 'active'`,
      ),
    ).toBe('3');
  });

  it('can be reset only by the owner', async () => {
    const maya = await owner();
    const { circleId, secret } = await circleOf(maya);
    const nina = await guestJoining(secret, 'Nina');

    const refused = await nina.functions.invoke('rotate-invite', {
      body: { idempotency_key: key(), circle_id: circleId },
    });
    expect(await refusalOf(refused.error)).toEqual({ status: 403, reason: 'not_the_owner' });
    expect(await linkOf(maya, circleId)).toBe(secret);
  });
});

describe('removing a member', () => {
  it('takes them out of the circle at once and out of the next recalculation', async () => {
    const maya = await owner();
    const { circleId, secret } = await circleOf(maya);
    const nina = await guestJoining(secret, 'Nina');
    const tom = await guestJoining(secret, 'Tom');
    const tomId = (await tom.auth.getUser()).data.user?.id ?? '';

    const plan = await maya.functions.invoke('create-plan', {
      body: {
        idempotency_key: key(),
        circle_id: circleId,
        title: 'Catch up',
        preset: 'next_14_days',
        quorum: 2,
      },
    });
    expect(plan.error).toBeNull();
    const planId = (plan.data as { plan_id: string }).plan_id;

    for (const member of [maya, nina, tom]) {
      const answered = await member.functions.invoke('submit-availability', {
        body: { idempotency_key: key(), plan_id: planId, revision: 1, status: 'flexible' },
      });
      expect(answered.error).toBeNull();
    }
    const counted = () =>
      sql(
        stack,
        `select responded_count || '/' || active_member_count from public.candidate_sets
         where plan_id = '${planId}' order by generated_at desc limit 1`,
      );
    expect(counted()).toBe('3/3');

    const removed = await maya.functions.invoke('remove-member', {
      body: { idempotency_key: key(), circle_id: circleId, user_id: tomId },
    });
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual({ ok: true, affected_plans: 1 });

    // The engine ran in the same request, without him.
    expect(counted()).toBe('2/2');

    // And he is out: the circle, its plan and a fresh answer are all refused.
    const { data: circles } = await tom.from('circles').select('id').eq('id', circleId);
    expect(circles).toHaveLength(0);
    const { data: plans } = await tom.from('plans').select('id').eq('id', planId);
    expect(plans).toHaveLength(0);
    const again = await tom.functions.invoke('submit-availability', {
      body: { idempotency_key: key(), plan_id: planId, revision: 1, status: 'flexible' },
    });
    expect(again.error).not.toBeNull();
  });

  it('refuses a member, and the owner removing themselves', async () => {
    const maya = await owner();
    const mayaId = (await maya.auth.getUser()).data.user?.id ?? '';
    const { circleId, secret } = await circleOf(maya);
    const nina = await guestJoining(secret, 'Nina');

    const byMember = await nina.functions.invoke('remove-member', {
      body: { idempotency_key: key(), circle_id: circleId, user_id: mayaId },
    });
    expect(await refusalOf(byMember.error)).toEqual({ status: 403, reason: 'not_the_owner' });

    const self = await maya.functions.invoke('remove-member', {
      body: { idempotency_key: key(), circle_id: circleId, user_id: mayaId },
    });
    expect(await refusalOf(self.error)).toEqual({ status: 409, reason: 'cannot_remove_owner' });
  });
});

describe('changing the name a circle calls you (SUS-205)', () => {
  const rename = (client: SupabaseClient, circleId: string, name: string, extra = {}) =>
    client.functions.invoke('rename-in-circle', {
      body: { idempotency_key: key(), circle_id: circleId, display_name: name, ...extra },
    });

  const namesIn = async (client: SupabaseClient, circleId: string): Promise<string[]> => {
    const { data } = await client
      .from('circle_roster')
      .select('display_name_snapshot')
      .eq('circle_id', circleId);
    return (data ?? []).map((row) => row.display_name_snapshot);
  };

  it('renames only the caller, in that circle, and everyone in it reads the new name', async () => {
    const maya = await owner();
    const { circleId, secret } = await circleOf(maya);
    const nina = await guestJoining(secret, 'Nina');
    const second = await circleOf(await owner());
    const joinedSecond = await nina.functions.invoke('redeem-invite', {
      body: { idempotency_key: key(), secret: second.secret, display_name: 'Nina' },
    });
    expect(joinedSecond.error).toBeNull();
    const before = await namesIn(maya, circleId);

    const renamed = await rename(nina, circleId, '  Nina  B ');
    expect(renamed.error).toBeNull();
    expect(renamed.data).toEqual({ ok: true });

    // The owner reads it; nobody else's name moved; the other circle is untouched.
    const after = await namesIn(maya, circleId);
    expect(after).toContain('Nina B');
    expect(after).not.toContain('Nina');
    expect(after.filter((name) => name !== 'Nina B').sort()).toEqual(
      before.filter((name) => name !== 'Nina').sort(),
    );
    expect(await namesIn(nina, second.circleId)).toContain('Nina');
  });

  it('refuses a name another active member has, and lets a member keep their own', async () => {
    const maya = await owner();
    const { circleId, secret } = await circleOf(maya);
    const nina = await guestJoining(secret, 'Nina');
    await guestJoining(secret, 'Tom');

    const taken = await rename(nina, circleId, 'tom');
    expect(await refusalOf(taken.error)).toEqual({ status: 409, reason: 'duplicate_name' });
    expect((await rename(nina, circleId, 'Nina')).error).toBeNull();
    expect(await namesIn(maya, circleId)).toContain('Nina');
  });

  it('has no way to rename somebody else, the owner included', async () => {
    const maya = await owner();
    const { circleId, secret } = await circleOf(maya);
    const nina = await guestJoining(secret, 'Nina');
    const ninaId = (await nina.auth.getUser()).data.user?.id ?? '';

    // A user_id in the body is not a field: the owner's call renames the owner.
    const byOwner = await rename(maya, circleId, 'Maya M', { user_id: ninaId });
    expect(byOwner.error).toBeNull();
    const names = await namesIn(maya, circleId);
    expect(names).toContain('Maya M');
    expect(names).toContain('Nina');
  });

  it('refuses somebody who was removed, and somebody who was never in', async () => {
    const maya = await owner();
    const { circleId, secret } = await circleOf(maya);
    const tom = await guestJoining(secret, 'Tom');
    const tomId = (await tom.auth.getUser()).data.user?.id ?? '';
    const removed = await maya.functions.invoke('remove-member', {
      body: { idempotency_key: key(), circle_id: circleId, user_id: tomId },
    });
    expect(removed.error).toBeNull();

    const byRemoved = await rename(tom, circleId, 'Tom Back');
    expect(await refusalOf(byRemoved.error)).toEqual({ status: 404, reason: 'member_not_found' });
    const stranger = clientFor(`stranger-${key()}`);
    expect((await stranger.auth.signInAnonymously()).error).toBeNull();
    const byStranger = await rename(stranger, circleId, 'Hello');
    expect(await refusalOf(byStranger.error)).toEqual({ status: 404, reason: 'member_not_found' });
  });

  it('writes no event and no audit row, and limits one person to twenty an hour', async () => {
    const maya = await owner();
    const { circleId, secret } = await circleOf(maya);
    const nina = await guestJoining(secret, 'Nina');
    sql(stack, 'delete from jobs.rate_counters');
    const counts = () =>
      sql(
        stack,
        `select (select count(*) from jobs.outbox)::text || '/' ||
                (select count(*) from private.audit_log)::text`,
      );
    const before = counts();

    for (let n = 1; n <= 20; n += 1) {
      expect((await rename(nina, circleId, `Nina ${n}`)).error).toBeNull();
    }
    const over = await rename(nina, circleId, 'Nina 21');
    expect(await refusalOf(over.error)).toEqual({ status: 429, reason: 'too_many_requests' });
    expect(counts()).toBe(before);
  });
});
