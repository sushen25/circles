import { CONSENT } from '@circles/config';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { accountFor, readStackConfig, sql, type Stack } from '../testing/stack.integration';

/**
 * Four of the rate-limit families, reached for real (SUS-219).
 *
 * The other suites clear the counters (`make limits`) so that being limited
 * never gets in their way, which leaves "the limit holds, and says so" untested
 * everywhere but redeem. Each test here sends the limit plus one request
 * through the real Edge Function, from the one address every local request
 * shares, and asserts the refusal's status and code. The copy a refusal shows is
 * a screen test in each feature (`planLink.test.tsx`, `availability.test.tsx`,
 * `rateRefusals.test.tsx`).
 *
 * Each test clears the counters of the scopes it touched afterwards, so the
 * live suite that runs next starts from a clean slate (it shares the address).
 *
 * Which limit each family is tested at, and why (ADR 0071):
 *
 * - **join-plan**: ten an hour for one caller on one code (`join_plan`).
 * - **reattach-member**: ten an hour per address (`reattach_ip`). The SQL
 *   per-circle limit (`reattach_circle_sql`, twenty) cannot be reached from a
 *   test: each call that completes moves a membership, and a membership moves
 *   at most three times in seven days.
 * - **request-email-updates**: three a day for one caller and one
 *   address (`email_request`).
 * - **submit-availability**: 120 an hour per caller (`submit_availability`).
 */

let stack: Stack;

const SCOPES = [
  'join_plan',
  'join_plan_caller',
  'join_plan_ip',
  'reattach_ip',
  'reattach_circle',
  'reattach_circle_sql',
  'email_request',
  'email_request_user',
  'email_request_ip',
  'verify_letter_address',
  'submit_availability',
];

function clearCounters(): void {
  const list = SCOPES.map((scope) => `'${scope}'`).join(', ');
  sql(stack, `delete from jobs.rate_counters where scope in (${list})`);
}

interface Answer {
  status: number;
  body: { reason?: string; error?: string };
}

/** One call to an Edge Function as `token`'s holder, read the way the client reads it. */
async function call(token: string, fn: string, body: Record<string, unknown>): Promise<Answer> {
  const response = await fetch(`${stack.url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      apikey: stack.anonKey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ idempotency_key: globalThis.crypto.randomUUID(), ...body }),
  });
  return { status: response.status, body: (await response.json()) as Answer['body'] };
}

/** An anonymous session: what a stranger with a link is. */
async function guestToken(role: string): Promise<string> {
  const client = createClient(stack.url, stack.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `circles.test.rate.${role}`,
    },
  });
  const { data, error } = await client.auth.signInAnonymously();
  expect(error).toBeNull();
  return data.session?.access_token ?? '';
}

/** A saved account with a circle and a plan asking it. */
async function organiserWithPlan(): Promise<{
  token: string;
  circleId: string;
  planId: string;
  code: string;
}> {
  const { accessToken: token } = await accountFor(stack, 'Rate');
  const circle = await call(token, 'create-circle', {
    name: 'Sunday Crew',
    color: 'sky',
    time_zone: 'Australia/Melbourne',
    cadence: 'fortnightly',
  });
  expect(circle.status).toBe(200);
  const circleId = (circle.body as unknown as { circle: { id: string } }).circle.id;
  const plan = await call(token, 'create-plan', {
    circle_id: circleId,
    title: 'Catch up',
    preset: 'next_14_days',
    quorum: 2,
  });
  expect(plan.status).toBe(200);
  const made = plan.body as unknown as { plan_id: string; short_code: string };
  return { token, circleId, planId: made.plan_id, code: made.short_code };
}

/** What a request refused for volume looks like to the client. */
const TOO_MANY = { status: 429, reason: 'too_many_requests' };
const refusal = (answer: Answer) => ({ status: answer.status, reason: answer.body.reason });

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
  clearCounters();
});

afterEach(() => {
  clearCounters();
});

describe('the limits, reached through the real functions (SUS-219)', () => {
  it('join-plan: the eleventh try by one caller on one code is refused for volume', async () => {
    const stranger = await guestToken('joiner');
    // A well-formed code no plan has: each try is a stranger's guess, charged
    // and refused for what it asked (404), until the allowance of ten is spent.
    const code = 'zzzzzzzzzz';
    for (let n = 1; n <= 10; n += 1) {
      const answer = await call(stranger, 'join-plan', { plan_code: code, display_name: 'Ada' });
      expect(refusal(answer)).toEqual({ status: 404, reason: 'invite_inactive' });
    }
    const over = await call(stranger, 'join-plan', { plan_code: code, display_name: 'Ada' });
    expect(refusal(over)).toEqual(TOO_MANY);
  });

  it('reattach-member: the eleventh try from one address is refused for volume', async () => {
    const guest = await guestToken('returner');
    // Nobody to come back as: the database refuses each of these, and the edge
    // counts every one of them before it does.
    const body = {
      circle_id: globalThis.crypto.randomUUID(),
      target_member_user_id: globalThis.crypto.randomUUID(),
    };
    for (let n = 1; n <= 10; n += 1) {
      const answer = await call(guest, 'reattach-member', body);
      expect(answer.status).not.toBe(429);
    }
    const over = await call(guest, 'reattach-member', body);
    expect(refusal(over)).toEqual(TOO_MANY);
  });

  it('request-email-updates: the fourth ask for one address by one caller is refused', async () => {
    const { token, planId } = await organiserWithPlan();
    const ask = () =>
      call(token, 'request-email-updates', {
        plan_id: planId,
        email: 'rate-limit@example.test',
        consent_version: CONSENT.version,
      });
    // Three a day for this person and this address; every answer is the same.
    for (let n = 1; n <= 3; n += 1) {
      const answer = await ask();
      expect(answer.status).toBe(200);
    }
    expect(refusal(await ask())).toEqual(TOO_MANY);
  });

  it('submit-availability: the 121st call in an hour by one caller is refused', async () => {
    const { token, planId } = await organiserWithPlan();
    // A revision the plan is not at: the function refuses each of the first 120
    // as `stale_revision` before it runs the engine, so the test spends the
    // allowance without spending 120 recalculations. The limit is taken first.
    const send = () =>
      call(token, 'submit-availability', {
        plan_id: planId,
        revision: 9999,
        status: 'flexible',
        used_calendar_overlay: false,
      });
    for (let n = 1; n <= 120; n += 1) {
      expect((await send()).body.reason).toBe('stale_revision');
    }
    expect(refusal(await send())).toEqual(TOO_MANY);
  });
});
