import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect } from 'vitest';

import { codeFor, someone, type Stack } from './stack.integration';

/**
 * A meetup locked in, made the way people make one — an organiser signs in,
 * creates a circle and a plan, two guests join by its code, two answer, and the
 * organiser locks the first option in — for the suites that start from there:
 * the confirmed screen's (S1-28) and the morning after's (S1-29).
 *
 * Each call makes its own people and circle, so no test sees another's.
 */

export function clientFor(stack: Stack, role: string): SupabaseClient {
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
export async function as<T>(who: SupabaseClient, act: () => Promise<T>): Promise<T> {
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

export async function organiserWithPlan(stack: Stack) {
  const owner = clientFor(stack, `organiser-${Math.random()}`);
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

export async function joins(
  stack: Stack,
  code: string,
  name: string,
): Promise<{ client: SupabaseClient; id: string }> {
  const client = clientFor(stack, `${name}-${Math.random()}`);
  expect((await client.auth.signInAnonymously()).error).toBeNull();
  const joined = await client.functions.invoke('join-plan', {
    body: { idempotency_key: globalThis.crypto.randomUUID(), plan_code: code, display_name: name },
  });
  expect(joined.error).toBeNull();
  return { client, id: (joined.data as { member_user_id: string }).member_user_id };
}

export async function answers(client: SupabaseClient, planId: string): Promise<void> {
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
export async function lockedIn(stack: Stack) {
  const plan = await organiserWithPlan(stack);
  const ren = await joins(stack, plan.code, 'Ren');
  const alex = await joins(stack, plan.code, 'Alex');
  await answers(ren.client, plan.planId);
  await answers(plan.owner, plan.planId);

  const { planCandidates } = await import('../scheduling');
  const { confirmMeetup } = await import('../confirmation/write');
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
