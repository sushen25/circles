import { type Instant, type NudgeMoment, type NudgeRecord, fromISO } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { Refusal } from './_shared/problem.ts';
import { recordNudge } from './record-nudge/record.ts';
import type { NudgeStore } from './record-nudge/store.ts';

/**
 * `record-nudge`'s decision, over a store kept in memory (S2-07). What RLS
 * and the constraints refuse is pgTAP's (`250_growth.sql`); what the real
 * function does against the stack is the integration suite's
 * (`nudges.integration.test.ts`). Here: what is read, what is written, and
 * what the caller is told.
 */

const KEY = '00000000-0000-4000-8000-000000000001' as never;
const THURSDAY = '00000000-0000-4000-8000-0000000000a1' as never;
const OCTOBER = '00000000-0000-4000-8000-0000000000a2' as never;
const NOVEMBER = '00000000-0000-4000-8000-0000000000a3' as never;
const NOW = fromISO('2026-09-18T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function memory(
  options: { visible?: boolean; facts?: { attended: boolean; firstInCircle: boolean } } = {},
) {
  const rows: NudgeRecord[] = [];
  const writes: string[] = [];
  const store: NudgeStore = {
    planVisible: () => Promise.resolve(options.visible ?? true),
    history: () => Promise.resolve([...rows]),
    afterAttendance: () => Promise.resolve(options.facts),
    recordShown: (moment, planId) => {
      writes.push(`shown ${moment}`);
      if (rows.some((r) => r.moment === moment && r.planId === planId))
        return Promise.resolve(false);
      rows.push({ moment, planId, shownAt: NOW, answer: null, answeredAt: null });
      return Promise.resolve(true);
    },
    recordAnswer: (moment, planId, answer) => {
      writes.push(`${answer} ${moment}`);
      const row = rows.find((r) => r.moment === moment && r.planId === planId);
      const answered = { answer, answeredAt: NOW };
      if (row === undefined) rows.push({ moment, planId, shownAt: NOW, ...answered });
      else Object.assign(row, answered);
      return Promise.resolve();
    },
  };
  return { store, rows, writes };
}

const ask = (moment: NudgeMoment, plan_id: never | undefined = THURSDAY) =>
  plan_id === undefined
    ? { idempotency_key: KEY, moment }
    : { idempotency_key: KEY, moment, plan_id };

describe('record-nudge', () => {
  it('says yes once and records it, then says no to the same moment and plan', async () => {
    const { store, writes } = memory();
    expect(await recordNudge(store, ask('sent_save_access'), 'guest', NOW)).toEqual({
      suppressed: false,
    });
    expect(await recordNudge(store, ask('sent_save_access'), 'guest', NOW)).toEqual({
      suppressed: true,
      reason: 'already_shown',
    });
    expect(writes).toEqual(['shown sent_save_access']);
  });

  it('writes nothing when the answer is no', async () => {
    const { store, writes } = memory();
    expect(await recordNudge(store, ask('reattached_save_place'), 'saved', NOW)).toEqual({
      suppressed: true,
      reason: 'already_saved',
    });
    expect(writes).toEqual([]);
  });

  it("refuses a plan in somebody else's circle before reading anything", async () => {
    const { store, writes } = memory({ visible: false });
    await expect(recordNudge(store, ask('sent_save_access'), 'guest', NOW)).rejects.toBeInstanceOf(
      Refusal,
    );
    expect(writes).toEqual([]);
  });

  it('asks the database whether "I was there" was the circle\'s first, and holds the prompt if not', async () => {
    const notFirst = memory({ facts: { attended: true, firstInCircle: false } });
    expect(
      await recordNudge(notFirst.store, ask('after_attendance_start_circle'), 'guest', NOW),
    ).toEqual({ suppressed: true, reason: 'not_the_moment' });

    const missed = memory({ facts: { attended: false, firstInCircle: true } });
    expect(
      await recordNudge(missed.store, ask('after_attendance_start_circle'), 'guest', NOW),
    ).toEqual({ suppressed: true, reason: 'not_the_moment' });

    const notTheirs = memory();
    expect(
      await recordNudge(notTheirs.store, ask('after_attendance_start_circle'), 'guest', NOW),
    ).toEqual({ suppressed: true, reason: 'not_the_moment' });

    const first = memory({ facts: { attended: true, firstInCircle: true } });
    expect(
      await recordNudge(first.store, ask('after_attendance_start_circle'), 'saved', NOW),
    ).toEqual({ suppressed: false });
  });

  it('records an answer whatever the caps say, since the prompt was on screen', async () => {
    const { store, rows } = memory();
    await recordNudge(store, ask('sent_save_access'), 'guest', NOW);
    expect(
      await recordNudge(store, { ...ask('sent_save_access'), answer: 'dismissed' }, 'guest', NOW),
    ).toEqual({ suppressed: false });
    expect(rows[0]?.answer).toBe('dismissed');
  });

  it('records the gate with no plan, and lets it through every time', async () => {
    const { store } = memory();
    expect(await recordNudge(store, ask('organiser_gate', undefined), 'guest', NOW)).toEqual({
      suppressed: false,
    });
    // The row exists, so the second is not recorded again; the gate is still a gate.
    expect(await recordNudge(store, ask('organiser_gate', undefined), 'guest', NOW)).toEqual({
      suppressed: false,
    });
  });

  it('holds the app prompts for 30 days after two "not now"s, and only them', async () => {
    const { store } = memory();
    for (const [moment, plan] of [
      ['email_given_app', THURSDAY],
      ['second_response_app', OCTOBER],
    ] as const) {
      expect(await recordNudge(store, ask(moment, plan), 'guest', NOW)).toEqual({
        suppressed: false,
      });
      await recordNudge(store, { ...ask(moment, plan), answer: 'dismissed' }, 'guest', NOW);
    }

    expect(await recordNudge(store, ask('locked_in_app', NOVEMBER), 'guest', NOW)).toEqual({
      suppressed: true,
      reason: 'backed_off',
    });
    const month = (NOW + 30 * DAY) as Instant;
    expect(await recordNudge(store, ask('locked_in_app', NOVEMBER), 'guest', month)).toEqual({
      suppressed: false,
    });
    expect(await recordNudge(store, ask('sent_save_access', NOVEMBER), 'guest', NOW)).toEqual({
      suppressed: false,
    });
  });
});
