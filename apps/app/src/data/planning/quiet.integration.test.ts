import { beforeAll, describe, expect, it } from 'vitest';

import { accountFor, readStackConfig, sql, type Stack } from '../testing/stack.integration';

/**
 * The quiet ask against the running stack (S2-02): the functions, the
 * database and the dispatcher together, which is where "exactly once" and
 * "only the initiator is told" are true or false.
 *
 * pgTAP proves each SQL function's rules one at a time, and the handler tests
 * what each Edge Function sends. Neither can put fifty answers on the wire at
 * once, or follow an expired ask through the drain to the one mailbox it may
 * reach — which is what this is for.
 *
 * There is no client for any of it yet (S2-03), so it speaks HTTP to the
 * functions directly, as the client will.
 *
 * Needs `pnpm db:start`. **If a function answers `BOOT_ERROR` or 404** on a
 * stack that was up before it existed: `pnpm db:stop && pnpm db:start`.
 */

let stack: Stack;

type Person = { userId: string; accessToken: string; name: string };

const key = () => globalThis.crypto.randomUUID();

async function call(
  fn: string,
  who: Person,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${stack.url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      apikey: stack.anonKey,
      authorization: `Bearer ${who.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ idempotency_key: key(), ...body }),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // The runtime's own answer when it could not start a worker is not ours.
  }
  return { status: response.status, body: parsed };
}

/**
 * An answer as a client sends it: retried with the same idempotency key when
 * the stack could not serve it. Fifty requests at once against a local Edge
 * runtime that is also serving a loaded gate meet "InvalidWorkerCreation:
 * worker did not respond in time" — the runtime's, before any of our code
 * ran. A retry is the same request under the same key, so it cannot count
 * twice, and what is proved is the database's "exactly once", not the local
 * runtime's capacity.
 */
async function answer(
  who: Person,
  planId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = { idempotency_key: key(), plan_id: planId, interested: true };
  let result = await call('answer-interest', who, body);
  for (let attempt = 0; attempt < 5 && result.status >= 500; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    result = await call('answer-interest', who, body);
  }
  return result;
}

async function person(name: string): Promise<Person> {
  return { name, ...(await accountFor(stack, name)) };
}

/** A circle owned by `owner` with `others` in it, written as the seed writes one. */
function circleOf(owner: Person, others: readonly Person[]): string {
  const circleId = globalThis.crypto.randomUUID();
  const code = Array.from(
    { length: 10 },
    () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)],
  ).join('');
  const members = [owner, ...others]
    .map((p, i) => `('${circleId}', '${p.userId}', '${p.name}', '${i === 0 ? 'owner' : 'member'}')`)
    .join(', ');
  sql(
    stack,
    `begin;
     insert into public.circles (id, owner_user_id, name, color, time_zone, cadence, short_code, creation_key)
     values ('${circleId}', '${owner.userId}', 'Sunday Crew', 'sky', 'Australia/Melbourne', 'monthly',
       '${code}', 'quiet-${circleId}');
     insert into public.circle_members (circle_id, user_id, display_name_snapshot, role) values ${members};
     commit;`,
  );
  return circleId;
}

async function askQuietly(who: Person, circleId: string): Promise<string> {
  const made = await call('create-plan', who, {
    circle_id: circleId,
    mode: 'quiet',
    title: 'Catch up',
    preset: 'next_14_days',
    stop_time: 'two_days',
  });
  expect(made.status).toBe(200);
  return made.body['plan_id'] as string;
}

/** The one background worker, once, as `pg_cron` would run it (tests/e2e-live/mail.ts). */
async function runDispatcher(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${stack.url}/functions/v1/process-scheduled-jobs`, {
      method: 'POST',
      headers: { authorization: 'Bearer local', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.ok).toBe(true);
    if (((await response.json()) as { ran?: boolean }).ran !== false) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('the dispatcher never took its lease');
}

async function subjectsTo(address: string): Promise<string[]> {
  const response = await fetch(
    `${stack.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  const listed = ((await response.json()) as { messages?: { Subject: string }[] }).messages ?? [];
  return listed.map((m) => m.Subject);
}

const emailOf = (who: Person) =>
  sql(stack, `select email from auth.users where id = '${who.userId}'`);

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
  sql(stack, 'delete from jobs.rate_counters');
});

describe('a quiet ask', () => {
  it('opens exactly once under fifty answers arriving together', async () => {
    const maya = await person('Maya');
    const keen = [await person('Priya'), await person('Tom'), await person('Jess')];
    const circleId = circleOf(maya, keen);
    const planId = await askQuietly(maya, circleId);
    // Four members: the threshold is three, and Maya counts as one of them.
    expect(sql(stack, `select quiet_threshold from public.plans where id = '${planId}'`)).toBe('3');

    const answers = await Promise.all(
      Array.from({ length: 50 }, (_, i) => answer(keen[i % keen.length]!, planId)),
    );

    const opened = answers.filter((a) => a.status === 200 && a.body['threshold_reached'] === true);
    expect(opened).toHaveLength(1);
    // Everything else was an answer before it opened, or a refusal after.
    for (const answer of answers) {
      if (answer.status === 200) expect(Object.keys(answer.body)).toEqual(['threshold_reached']);
      else
        expect(answer, 'a refusal after it opened').toMatchObject({
          body: { reason: 'interest_closed' },
        });
    }
    expect(
      sql(
        stack,
        `select count(*) from jobs.outbox
         where aggregate_id = '${planId}' and event_name = 'planning.threshold_reached'`,
      ),
    ).toBe('1');
    expect(sql(stack, `select state from public.plans where id = '${planId}'`)).toBe('collecting');
    // Closed at the moment it opened: Maya and the first two keen, nobody after.
    expect(
      sql(
        stack,
        `select count(*) from private.plan_interest where plan_id = '${planId}' and response = 'keen'`,
      ),
    ).toBe('3');
  });

  it('is organised by somebody keen, first come first served, and never by a guest or the uninterested', async () => {
    const maya = await person('Maya');
    const priya = await person('Priya');
    const tom = await person('Tom');
    const sam = await person('Sam');
    const circleId = circleOf(maya, [priya, tom, sam]);
    const planId = await askQuietly(maya, circleId);
    await call('answer-interest', priya, { plan_id: planId, interested: true });
    await call('answer-interest', tom, { plan_id: planId, interested: true });

    const refused = await call('accept-organiser', sam, { plan_id: planId });
    expect(refused).toMatchObject({ status: 403, body: { reason: 'not_keen' } });

    // Priya volunteers; Tom, just as keen, is second.
    const accepted = await call('accept-organiser', priya, { plan_id: planId, role: 'initiator' });
    expect(accepted).toMatchObject({ status: 200, body: { organiser_member_id: priya.userId } });
    const second = await call('accept-organiser', tom, { plan_id: planId });
    expect(second).toMatchObject({ status: 409, body: { reason: 'already_taken' } });

    // The event names the organiser and never how they came to it.
    const payload = sql(
      stack,
      `select payload from jobs.outbox
       where aggregate_id = '${planId}' and event_name = 'planning.organiser_accepted'`,
    );
    expect(payload).toContain(priya.userId);
    expect(payload).not.toMatch(/source|role|initiator|volunteer/);
  });

  it('shows each member only what is theirs to see, built on the server', async () => {
    const maya = await person('Maya');
    const priya = await person('Priya');
    const tom = await person('Tom');
    const circleId = circleOf(maya, [priya, tom]);
    const planId = await askQuietly(maya, circleId);
    await call('answer-interest', priya, { plan_id: planId, interested: false });

    const mine = await call('quiet-view', maya, { plan_id: planId });
    const hers = await call('quiet-view', priya, { plan_id: planId });
    const his = await call('quiet-view', tom, { plan_id: planId });
    expect(mine.body['view']).toMatchObject({ phase: 'seeking', threshold: 3, may_withdraw: true });
    expect(hers.body['view']).toMatchObject({ answered_by_me: true, may_withdraw: false });
    expect(his.body['view']).toMatchObject({ answered_by_me: false, may_withdraw: false });
    // The facts behind them stay on the server.
    for (const view of [mine, hers, his]) {
      expect(JSON.stringify(view.body)).not.toMatch(/initiator|keen|not_this_time|count/);
    }
  });

  it('refuses a guest who volunteers, with the reason that offers a saved place', async () => {
    const maya = await person('Maya');
    const priya = await person('Priya');
    const circleId = circleOf(maya, [priya]);
    const planId = await askQuietly(maya, circleId);
    // A circle of two needs both; Priya's answer opens it.
    await call('answer-interest', priya, { plan_id: planId, interested: true });

    const guestSession = await fetch(`${stack.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: stack.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ data: { display_name: 'Alex' } }),
    });
    const guest = (await guestSession.json()) as { access_token: string; user: { id: string } };
    sql(
      stack,
      `insert into public.circle_members (circle_id, user_id, display_name_snapshot)
       values ('${circleId}', '${guest.user.id}', 'Alex')`,
    );
    const alex = { name: 'Alex', userId: guest.user.id, accessToken: guest.access_token };

    const refused = await call('accept-organiser', alex, { plan_id: planId });
    expect(refused).toMatchObject({ status: 403, body: { reason: 'requires_saved_place' } });
  });

  it('is withdrawn silently, and an ask that runs out of time is told to its initiator alone', async () => {
    const maya = await person('Maya');
    const tom = await person('Tom');
    const priya = await person('Priya');
    const circleId = circleOf(maya, [tom, priya]);

    // Maya withdraws hers: nothing is announced, so nothing is ever sent.
    const withdrawn = await askQuietly(maya, circleId);
    const cancelled = await call('cancel-plan', maya, { plan_id: withdrawn });
    expect(cancelled.status).toBe(200);

    // Tom's runs out of time with only himself keen.
    const expiring = await askQuietly(tom, circleId);
    sql(
      stack,
      `update public.plans set quiet_expires_at = now() - interval '1 minute' where id = '${expiring}'`,
    );
    // Once to expire it, once to turn the event into a letter and send it.
    await runDispatcher();
    await runDispatcher();

    expect(sql(stack, `select state from public.plans where id = '${expiring}'`)).toBe('expired');
    expect(
      sql(stack, `select count(*) from jobs.notification_jobs where plan_id = '${withdrawn}'`),
    ).toBe('0');
    expect(
      sql(
        stack,
        `select string_agg(j.kind || ':' || c.user_id, ',') from jobs.notification_jobs j
         join private.email_contacts c on c.id = j.contact_id where j.plan_id = '${expiring}'`,
      ),
    ).toBe(`quiet_expired:${tom.userId}`);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if ((await subjectsTo(emailOf(tom))).length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(await subjectsTo(emailOf(tom))).toEqual(['Sunday Crew: this one closed quietly']);
    expect(await subjectsTo(emailOf(maya))).toEqual([]);
    expect(await subjectsTo(emailOf(priya))).toEqual([]);
  });
});
