import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  answers,
  as,
  joins as joinsOn,
  organiserWithPlan as organiserOn,
} from '../testing/meetup.integration';
import { readStackConfig, sql, type Stack } from '../testing/stack.integration';

/**
 * The organiser sets the final plan, against the real stack, through the app's
 * own calls (SUS-138, ADR 0051): who a stretch works for, locking in a time no
 * option offered, moving it, and changing the place, as the people who do it.
 *
 * pgTAP proves the database and the handler tests prove the endpoints; this
 * proves the data layer the screens call, through RLS and the Edge Functions.
 *
 * Needs `pnpm db:start`.
 */

let stack: Stack;
const joins = (code: string, name: string) => joinsOn(stack, code, name);
const organiserWithPlan = () => organiserOn(stack);

beforeAll(async () => {
  stack = readStackConfig();
  const health = await fetch(`${stack.url}/auth/v1/health`, { headers: { apikey: stack.anonKey } });
  if (!health.ok) throw new Error('local stack is not up — run `pnpm db:start`');
});

beforeEach(() => {
  sql(stack, 'delete from jobs.rate_counters');
});

/** An evening, `days` from today in Melbourne: 7 to 9 pm, as ISO instants. */
function evening(days: number): { startsAt: string; endsAt: string } {
  const at = (hour: number) =>
    sql(
      stack,
      `select to_char(((current_date + ${days})::timestamp + interval '${hour} hours')
        at time zone 'Australia/Melbourne' at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    ).trim();
  return { startsAt: at(19), endsAt: at(21) };
}

/** Maya's plan, Ren (easy) and Alex (not answered) in it. */
async function crew() {
  const plan = await organiserWithPlan();
  const ren = await joins(plan.code, 'Ren');
  const alex = await joins(plan.code, 'Alex');
  await answers(ren.client, plan.planId);
  return { ...plan, ren, alex };
}

describe('who a stretch works for', () => {
  it('is said to the organiser by id: Ren, who is easy, can; Alex has not answered', async () => {
    const { owner, ownerId, planId, ren, alex } = await crew();
    const { stretchOf } = await import('./own');
    const when = evening(3);

    const read = await as(owner, () => stretchOf(planId, when.startsAt, when.endsAt));
    expect(read.available).toEqual([ren.id]);
    expect(read.awaiting).toEqual(expect.arrayContaining([alex.id, ownerId]));
    expect(read.cannot).toEqual([]);
    expect(read.inputVersion).toBeGreaterThan(0);
  });

  it('is not said to a member, who is told nothing of it', async () => {
    const { planId, ren } = await crew();
    const { stretchOf } = await import('./own');
    const when = evening(3);
    await expect(
      as(ren.client, () => stretchOf(planId, when.startsAt, when.endsAt)),
    ).rejects.toThrow('stretch_availability failed');
  });
});

describe("a time of the organiser's own", () => {
  it('is locked in below the number, moved without asking anybody again, and edited in place', async () => {
    const { owner, planId, ren, alex } = await crew();
    const { stretchOf, confirmOwnTime, editConfirmation, planConfirmation } =
      await import('./index');
    const first = evening(3);

    // Quorum two, one can make it: below the number, which the plan keeps.
    const read = await as(owner, () => stretchOf(planId, first.startsAt, first.endsAt));
    const confirmed = await as(owner, () =>
      confirmOwnTime({
        planId,
        ...first,
        expectedInputVersion: read.inputVersion,
        chasedAnswer: 'none',
        placeName: 'Hope St Radio',
      }),
    );
    expect(confirmed.going).toEqual([ren.id]);

    let seen = (await as(owner, () => planConfirmation({ planId })))!;
    expect(seen.view).toBe('confirmed');
    expect(seen.confirmation).toMatchObject({
      ownTime: true,
      belowQuorum: true,
      movedFrom: undefined,
    });
    let status = new Map(seen.attendance.map((a) => [a.userId, a.status]));
    expect(status.get(ren.id)).toBe('going');
    // Not "can't make it": Alex never answered, and nobody said no to this.
    expect(status.get(alex.id)).toBe('unknown');
    expect([...status.values()]).not.toContain('cant');

    // A place edit: the same confirmation, in place, and nobody's status moves.
    const edited = await as(owner, () =>
      editConfirmation({ planId, placeName: 'Naked for Satan' }),
    );
    expect(edited.confirmation_id).toBe(confirmed.confirmation_id);
    seen = (await as(owner, () => planConfirmation({ planId })))!;
    expect(seen.confirmation?.placeName).toBe('Naked for Satan');
    expect(seen.confirmation?.id).toBe(confirmed.confirmation_id);

    // A move: a new confirmation in the same revision, saying where it came from.
    const next = evening(4);
    const again = await as(owner, () => stretchOf(planId, next.startsAt, next.endsAt));
    const moved = await as(owner, () =>
      editConfirmation({
        planId,
        ...next,
        expectedInputVersion: again.inputVersion,
        placeName: 'Naked for Satan',
      }),
    );
    expect(moved.confirmation_id).not.toBe(confirmed.confirmation_id);
    seen = (await as(owner, () => planConfirmation({ planId })))!;
    expect(seen.confirmation?.id).toBe(moved.confirmation_id);
    expect(Date.parse(seen.confirmation?.movedFrom?.startsAt ?? '')).toBe(
      Date.parse(first.startsAt),
    );
    status = new Map(seen.attendance.map((a) => [a.userId, a.status]));
    expect(status.get(ren.id)).toBe('going');
    expect(
      sql(
        stack,
        `select count(*) from public.meetup_confirmations where plan_id = '${planId}' and status = 'active'`,
      ).trim(),
    ).toBe('1');
  });

  it('is refused when somebody answered while the organiser was looking', async () => {
    const { owner, planId, code } = await crew();
    const { stretchOf, confirmOwnTime } = await import('./index');
    const when = evening(3);
    const read = await as(owner, () => stretchOf(planId, when.startsAt, when.endsAt));

    // Tom answers: the names the organiser saw are no longer the names.
    const tom = await joins(code, 'Tom');
    await answers(tom.client, planId);

    await expect(
      as(owner, () =>
        confirmOwnTime({
          planId,
          ...when,
          expectedInputVersion: read.inputVersion,
          chasedAnswer: 'none',
        }),
      ),
    ).rejects.toMatchObject({ reason: 'stale_availability' });
  });

  it('is refused for a member, a time in the past and a time off the half hour', async () => {
    const { owner, planId, ren } = await crew();
    const { stretchOf, confirmOwnTime } = await import('./index');
    const when = evening(3);
    const read = await as(owner, () => stretchOf(planId, when.startsAt, when.endsAt));
    const send = (who: typeof owner, startsAt: string, endsAt: string) =>
      as(who, () =>
        confirmOwnTime({
          planId,
          startsAt,
          endsAt,
          expectedInputVersion: read.inputVersion,
          chasedAnswer: 'none',
        }),
      );

    await expect(send(ren.client, when.startsAt, when.endsAt)).rejects.toMatchObject({
      reason: 'not_the_organiser',
    });
    const past = evening(-1);
    await expect(send(owner, past.startsAt, past.endsAt)).rejects.toMatchObject({
      reason: 'own_time_in_the_past',
    });
    const off = new Date(Date.parse(when.startsAt) + 10 * 60_000).toISOString();
    await expect(send(owner, off, when.endsAt)).rejects.toMatchObject({
      reason: 'own_time_off_the_half_hour',
    });
  });
});
