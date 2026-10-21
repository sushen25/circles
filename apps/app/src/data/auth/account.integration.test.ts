import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';

import { codeFor, readStackConfig, someone, sql, type Stack } from '../testing/stack.integration';

/**
 * S4-05's acceptance criteria, against the running stack: a deleted user cannot
 * sign in, the circle still works, the export holds only the requester's data,
 * and leaving a circle takes a guest out.
 *
 * pgTAP proves the functions and the handler tests prove the Edge wrappers.
 * What neither can prove is that the auth server itself refuses the person
 * afterwards, which is the whole promise of "deleted".
 *
 * Needs `pnpm db:start`; new functions need a restart of the stack.
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

async function refusalOf(error: unknown): Promise<{ status: number; reason?: string }> {
  const response = (error as { context?: Response }).context;
  if (response === undefined) throw new Error(`not an HTTP refusal: ${String(error)}`);
  const body = (await response.json()) as { reason?: string };
  return { status: response.status, ...(body.reason === undefined ? {} : { reason: body.reason }) };
}

async function signedIn(address: string): Promise<SupabaseClient> {
  const client = clientFor(`account-${key()}`);
  expect((await client.auth.signInWithOtp({ email: address })).error).toBeNull();
  const verified = await client.auth.verifyOtp({
    email: address,
    token: await codeFor(stack.mailpit, address),
    type: 'email',
  });
  expect(verified.error).toBeNull();
  return client;
}

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
  sql(stack, 'delete from jobs.rate_counters');
});

describe('a circle with an owner and a guest', () => {
  it('lets the guest leave, hands the circle on when the owner deletes, and refuses the owner afterwards', async () => {
    const address = someone('owner');
    const maya = await signedIn(address);
    const made = await maya.functions.invoke('create-circle', {
      body: {
        idempotency_key: key(),
        name: 'Sunday Crew',
        color: 'clay',
        time_zone: 'Australia/Melbourne',
        cadence: 'monthly',
      },
    });
    expect(made.error).toBeNull();
    const { circle, invite_secret: secret } = made.data as {
      circle: { id: string };
      invite_secret: string;
    };

    // A second saved place, so the circle has an heir.
    const nina = await signedIn(someone('heir'));
    expect(
      (
        await nina.functions.invoke('redeem-invite', {
          body: { idempotency_key: key(), secret, display_name: 'Nina' },
        })
      ).error,
    ).toBeNull();
    const tom = clientFor(`guest-${key()}`);
    expect((await tom.auth.signInAnonymously()).error).toBeNull();
    expect(
      (
        await tom.functions.invoke('redeem-invite', {
          body: { idempotency_key: key(), secret, display_name: 'Tom' },
        })
      ).error,
    ).toBeNull();

    // The owner cannot just leave.
    const stay = await maya.functions.invoke('leave-circle', {
      body: { idempotency_key: key(), circle_id: circle.id },
    });
    expect(await refusalOf(stay.error)).toEqual({ status: 409, reason: 'owner_cannot_leave' });

    // A guest can, and then cannot see the circle.
    expect(
      (
        await tom.functions.invoke('leave-circle', {
          body: { idempotency_key: key(), circle_id: circle.id },
        })
      ).error,
    ).toBeNull();
    expect((await tom.from('circles').select('id').eq('id', circle.id)).data).toEqual([]);

    // The export is Maya's own, holds nobody else, and comes once a day.
    const exported = await maya.functions.invoke('export-my-data', { body: {} });
    expect(exported.error).toBeNull();
    const doc = JSON.stringify((exported.data as { data: unknown }).data);
    expect(doc).toContain('Sunday Crew');
    expect(doc).not.toMatch(/Nina|Tom/);
    const again = await maya.functions.invoke('export-my-data', { body: {} });
    expect(await refusalOf(again.error)).toEqual({ status: 429, reason: 'too_many_requests' });

    // She deletes. The circle goes to Nina, and Maya is signed out for good.
    const deleted = await maya.functions.invoke('delete-account', {
      body: { idempotency_key: key(), confirm: true },
    });
    expect(deleted.error).toBeNull();
    expect(deleted.data).toMatchObject({ ok: true, circles_handed_on: 1, circles_archived: 0 });

    expect((await maya.auth.getUser()).error).not.toBeNull();
    expect((await maya.from('circles').select('id').eq('id', circle.id)).data ?? []).toEqual([]);

    const home = await nina.from('circles').select('owner_user_id').eq('id', circle.id);
    expect(home.data).toHaveLength(1);
    const names = await nina
      .from('circle_roster')
      .select('display_name_snapshot')
      .eq('circle_id', circle.id);
    expect((names.data ?? []).map((row) => row.display_name_snapshot)).toEqual(['Nina']);

    // And she cannot come back: the code is sent, and the verify, or the send, is refused.
    const returning = clientFor(`returning-${key()}`);
    const sent = await returning.auth.signInWithOtp({ email: address });
    if (sent.error === null) {
      const verified = await returning.auth.verifyOtp({
        email: address,
        token: await codeFor(stack.mailpit, address).catch(() => '000000'),
        type: 'email',
      });
      expect(verified.error).not.toBeNull();
      expect(verified.data.session).toBeNull();
    }
    expect((await returning.auth.getSession()).data.session).toBeNull();
  });
});
