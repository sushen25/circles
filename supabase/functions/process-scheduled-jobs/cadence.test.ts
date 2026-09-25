import { instant } from '@circles/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../_shared/db.ts';
import { cadenceWork } from './cadence.ts';
import { type DueJob, send } from './send.ts';

/**
 * The cadence nudge through the dispatcher (S2-04), against a fake database.
 *
 * The SQL half — one decision per cycle under the circle lock, the jobs'
 * shape, the sweep and the claim — is `230_cadence.sql` and `190_dispatcher.sql` against a real
 * Postgres. This is the half that is neither SQL nor domain: that the pass asks
 * the domain the right questions, writes what it answers, and that the sender
 * asks again and renders a letter with no plan.
 */

const CIRCLE = '00000000-0000-4000-8000-0000000000c1';
const MAYA = '00000000-0000-4000-8000-000000000001';
const PRIYA = '00000000-0000-4000-8000-000000000002';
const TOM = '00000000-0000-4000-8000-000000000003';
const JESS = '00000000-0000-4000-8000-000000000004';
const CONTACT = '00000000-0000-4000-8000-00000000c002';
const ZONE = 'Australia/Melbourne';

/** Monthly, last met 8 August 18:30 Melbourne: due 8 September, about time from 1 September. */
const LAST_MET = '2026-08-08T08:30:00.000Z';
const ABOUT_TIME = instant(Date.parse('2026-09-03T02:00:00.000Z'));

type Calls = { fn: string; args: Record<string, unknown> }[];

function member(userId: string, index: number, overrides: Record<string, unknown> = {}) {
  return {
    circle_id: CIRCLE,
    user_id: userId,
    display_name: ['Maya', 'Priya', 'Tom', 'Jess'][index] ?? 'Someone',
    role: index === 0 ? 'owner' : 'member',
    status: 'active',
    joined_at: `2026-01-0${index + 1}T00:00:00.000Z`,
    muted_quiet_asks: false,
    muted_all: false,
    muted_nudges: false,
    time_zone: ZONE,
    is_permanent: true,
    muted_organiser_email: false,
    ...overrides,
  };
}

function circleContext(overrides: Record<string, unknown> = {}) {
  return {
    circle: {
      id: CIRCLE,
      owner_user_id: MAYA,
      name: 'Sunday Crew',
      color: 'sky',
      time_zone: ZONE,
      cadence: 'monthly',
      nudge_policy: 'take_turns',
      default_duration_minutes: 120,
      default_quorum: null,
      default_area: null,
      status: 'active',
      last_met_at: LAST_MET,
      cadence_snoozed_until: null,
    },
    members: [MAYA, PRIYA, TOM, JESS].map((id, index) => member(id, index)),
    has_open_plan: false,
    last_organiser_id: MAYA,
    last_happened_attendees: [MAYA, PRIYA, TOM, JESS],
    prompted_for: null,
    push_user_ids: [],
    ...overrides,
  };
}

function fakeDb(answers: (fn: string, args: Record<string, unknown>) => unknown): {
  db: Db;
  calls: Calls;
} {
  const calls: Calls = [];
  const db = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: answers(fn, args) ?? null, error: null });
    },
  } as unknown as Db;
  return { db, calls };
}

const never = () => false;

describe('the cadence pass', () => {
  it('asks one person, records why, and writes one email job that belongs to the circle', async () => {
    const { db, calls } = fakeDb((fn) => {
      if (fn === 'dispatch_circle_context') return circleContext();
      if (fn === 'dispatch_organiser_contact') return CONTACT;
      if (fn === 'dispatch_prompt_cadence') return 1;
      if (fn === 'record_events') return 1;
      return null;
    });

    const result = await cadenceWork(db, [CIRCLE], 'req', ABOUT_TIME, never);

    expect(result).toEqual({ prompted: 1, nudgesQueued: 1 });
    const prompt = calls.find((c) => c.fn === 'dispatch_prompt_cadence')?.args;
    // Maya organised last, so the turn is Priya's.
    expect(prompt).toMatchObject({
      p_circle_id: CIRCLE,
      // The cycle, handed back as the database gave it.
      p_last_met_at: LAST_MET,
      p_due_date: '2026-09-08',
      p_user_id: PRIYA,
      p_recipient_role: 'take_turns',
    });
    const jobs = prompt?.['p_jobs'] as Record<string, unknown>[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      channel: 'email',
      kind: 'about_time',
      contact_id: CONTACT,
      user_id: null,
      plan_id: null,
      plan_revision: null,
      circle_id: CIRCLE,
    });
    expect(jobs[0]?.['idempotency_key']).toMatch(/^[0-9a-f]{64}$/);
    // Asked for Priya's address and nobody else's: one person, never the circle.
    expect(calls.filter((c) => c.fn === 'dispatch_organiser_contact')).toEqual([
      { fn: 'dispatch_organiser_contact', args: { p_user_id: PRIYA } },
    ]);

    const tracked = calls.find((c) => c.fn === 'record_events')?.args['p_rows'] as Record<
      string,
      unknown
    >[];
    expect(tracked[0]).toMatchObject({
      event_name: 'cadence_prompt_sent',
      circle_id: CIRCLE,
      user_id: null,
      properties: { recipient_role: 'take_turns' },
    });
  });

  it.each([
    ['a plan is running', { has_open_plan: true }],
    ['the owner snoozed', { cadence_snoozed_until: '2026-09-30T00:00:00.000Z' }],
    ['this cycle is already decided', { prompted_for: '2026-09-08' }],
  ])('writes nothing while %s', async (_why, overrides) => {
    const context = circleContext();
    const shaped =
      'cadence_snoozed_until' in overrides
        ? { ...context, circle: { ...context.circle, ...overrides } }
        : { ...context, ...overrides };
    const { db, calls } = fakeDb((fn) => (fn === 'dispatch_circle_context' ? shaped : null));

    const result = await cadenceWork(db, [CIRCLE], 'req', ABOUT_TIME, never);

    expect(result).toEqual({ prompted: 0, nudgesQueued: 0 });
    expect(calls.map((c) => c.fn)).toEqual(['dispatch_circle_context']);
  });

  it('writes nothing before the lead window opens', async () => {
    const { db, calls } = fakeDb((fn) =>
      fn === 'dispatch_circle_context' ? circleContext() : null,
    );
    const early = instant(Date.parse('2026-08-30T00:00:00.000Z'));

    await cadenceWork(db, [CIRCLE], 'req', early, never);

    expect(calls.map((c) => c.fn)).toEqual(['dispatch_circle_context']);
  });

  it('records a decision for nobody when everyone said no, and measures nothing', async () => {
    const context = circleContext({
      members: [MAYA, PRIYA, TOM, JESS].map((id, index) =>
        member(id, index, { muted_nudges: true }),
      ),
    });
    const { db, calls } = fakeDb((fn) => {
      if (fn === 'dispatch_circle_context') return context;
      if (fn === 'dispatch_prompt_cadence') return 0;
      return null;
    });

    const result = await cadenceWork(db, [CIRCLE], 'req', ABOUT_TIME, never);

    expect(result).toEqual({ prompted: 1, nudgesQueued: 0 });
    expect(calls.find((c) => c.fn === 'dispatch_prompt_cadence')?.args).toMatchObject({
      p_user_id: null,
      p_recipient_role: null,
      p_jobs: [],
    });
    expect(calls.some((c) => c.fn === 'dispatch_organiser_contact')).toBe(false);
    expect(calls.some((c) => c.fn === 'record_events')).toBe(false);
  });

  it('passes the turn on from somebody nothing can reach, and asks them no more', async () => {
    // Review round 2: Priya's turn, but her address bounced. She is not told
    // it is her turn with nothing sent; Tom, next in join order, is asked.
    const { db, calls } = fakeDb((fn, args) => {
      if (fn === 'dispatch_circle_context') return circleContext();
      if (fn === 'dispatch_organiser_contact') return args['p_user_id'] === PRIYA ? null : CONTACT;
      if (fn === 'dispatch_prompt_cadence') return 1;
      return null;
    });

    const result = await cadenceWork(db, [CIRCLE], 'req', ABOUT_TIME, never);

    expect(result).toEqual({ prompted: 1, nudgesQueued: 1 });
    expect(calls.find((c) => c.fn === 'dispatch_prompt_cadence')?.args).toMatchObject({
      p_user_id: TOM,
      p_recipient_role: 'take_turns',
    });
    expect(
      calls.filter((c) => c.fn === 'dispatch_organiser_contact').map((c) => c.args['p_user_id']),
    ).toEqual([PRIYA, TOM]);
  });

  it('decides for nobody when nobody can be reached', async () => {
    const { db, calls } = fakeDb((fn) => {
      if (fn === 'dispatch_circle_context') return circleContext();
      if (fn === 'dispatch_prompt_cadence') return 0;
      return null;
    });

    const result = await cadenceWork(db, [CIRCLE], 'req', ABOUT_TIME, never);

    expect(result).toEqual({ prompted: 1, nudgesQueued: 0 });
    expect(calls.find((c) => c.fn === 'dispatch_prompt_cadence')?.args).toMatchObject({
      p_user_id: null,
      p_jobs: [],
    });
    expect(calls.some((c) => c.fn === 'record_events')).toBe(false);
  });

  it('measures nothing when another run decided the due date first', async () => {
    const { db, calls } = fakeDb((fn) => {
      if (fn === 'dispatch_circle_context') return circleContext();
      if (fn === 'dispatch_organiser_contact') return CONTACT;
      return null; // dispatch_prompt_cadence: already decided
    });

    const result = await cadenceWork(db, [CIRCLE], 'req', ABOUT_TIME, never);

    expect(result).toEqual({ prompted: 0, nudgesQueued: 0 });
    expect(calls.some((c) => c.fn === 'record_events')).toBe(false);
  });

  it('takes turns across three cycles: whoever was asked organises, and the turn moves on', async () => {
    // Three simulated cycles. Each one the person asked organises the next
    // meetup, everybody comes, and the circle falls due again a month on.
    const asked: unknown[] = [];
    let lastOrganiser = MAYA;
    let lastMet = Date.parse(LAST_MET);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const context = circleContext({ last_organiser_id: lastOrganiser });
      context.circle.last_met_at = new Date(lastMet).toISOString();
      const { db, calls } = fakeDb((fn) => {
        if (fn === 'dispatch_circle_context') return context;
        if (fn === 'dispatch_organiser_contact') return CONTACT;
        if (fn === 'dispatch_prompt_cadence') return 1;
        return null;
      });
      // Four weeks after the last meetup: inside a monthly circle's lead window.
      await cadenceWork(db, [CIRCLE], 'req', instant(lastMet + 26 * 86_400_000), never);
      const who = calls.find((c) => c.fn === 'dispatch_prompt_cadence')?.args['p_user_id'];
      asked.push(who);
      lastOrganiser = who as string;
      lastMet += 31 * 86_400_000;
    }

    expect(asked).toEqual([PRIYA, TOM, JESS]);
  });
});

describe('sending a cadence nudge', () => {
  const job = (overrides: Partial<DueJob> = {}): DueJob => ({
    id: '00000000-0000-4000-8000-00000000a001',
    kind: 'about_time',
    contact_id: CONTACT,
    user_id: PRIYA,
    plan_id: null,
    plan_revision: null,
    idempotency_key: 'a'.repeat(64),
    attempt_count: 0,
    email: 'priya@example.com',
    contact_status: 'verified',
    subscribed: false,
    member_active: true,
    plan_state: null,
    plan_current_revision: null,
    plan_short_code: null,
    circle_id: CIRCLE,
    circle_name: 'Sunday Crew',
    circle_archived: false,
    organiser_email_muted: false,
    superseded: false,
    ...overrides,
  });

  let fetched: { url: string; body: string }[] = [];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fetched = [];
    process.env.EMAIL_CAPTURE_URL = 'http://capture.test';
    process.env.EXPO_PUBLIC_APP_ORIGIN = 'https://app.test';
    (globalThis as { fetch?: unknown }).fetch = (url: string, init?: { body?: string }) => {
      fetched.push({ url: String(url), body: String(init?.body ?? '') });
      return Promise.resolve(new Response(JSON.stringify({ ID: 'captured' })));
    };
  });

  afterEach(() => {
    delete process.env.EMAIL_CAPTURE_URL;
    delete process.env.EXPO_PUBLIC_APP_ORIGIN;
    globalThis.fetch = realFetch;
  });

  const results = (calls: Calls) =>
    calls.filter((c) => c.fn === 'dispatch_job_result').map((c) => c.args);

  it('sends a job with no plan — the branch that would otherwise say plan_gone', async () => {
    const { db, calls } = fakeDb((fn) =>
      fn === 'dispatch_circle_context' ? circleContext() : null,
    );

    const sent = await send(db, [job()], 'req', never);

    expect(sent.sent).toBe(1);
    expect(results(calls)[0]).toMatchObject({ p_outcome: 'sent' });
    expect(fetched).toHaveLength(1);
    // The circle's home, where the person is signed in; no token anywhere.
    expect(fetched[0]?.body).toContain(`https://app.test/circles/${CIRCLE}`);
    expect(fetched[0]?.body).toContain('Sunday Crew: about time?');
  });

  it.each([
    ['a plan was made since', { has_open_plan: true }, 'no_longer_due'],
    [
      'the person turned nudges off since',
      {
        members: [MAYA, PRIYA].map((id, index) =>
          member(id, index, id === PRIYA ? { muted_nudges: true } : {}),
        ),
      },
      'nudges_off',
    ],
    [
      'the person left',
      {
        members: [MAYA, PRIYA].map((id, index) =>
          member(id, index, id === PRIYA ? { status: 'removed' } : {}),
        ),
      },
      'not_a_member',
    ],
  ])('holds it when %s', async (_why, overrides, reason) => {
    const { db, calls } = fakeDb((fn) =>
      fn === 'dispatch_circle_context' ? circleContext(overrides) : null,
    );

    const sent = await send(db, [job()], 'req', never);

    expect(sent.skipped).toBe(1);
    expect(results(calls)[0]).toMatchObject({ p_outcome: 'skipped', p_error: reason });
    expect(fetched).toHaveLength(0);
  });

  it('holds it once the owner has snoozed', async () => {
    const context = circleContext();
    const far = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const snoozed = { ...context, circle: { ...context.circle, cadence_snoozed_until: far } };
    const { db, calls } = fakeDb((fn) => (fn === 'dispatch_circle_context' ? snoozed : null));

    await send(db, [job()], 'req', never);

    expect(results(calls)[0]).toMatchObject({ p_outcome: 'skipped', p_error: 'no_longer_due' });
  });

  it('stops for an archived circle, found through the job now that it has no plan', async () => {
    const { db, calls } = fakeDb(() => null);

    await send(db, [job({ circle_archived: true })], 'req', never);

    expect(results(calls)[0]).toMatchObject({ p_outcome: 'skipped', p_error: 'circle_archived' });
    expect(calls.some((c) => c.fn === 'dispatch_circle_context')).toBe(false);
  });
});
