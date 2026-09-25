import { instant, zone } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import type { PlanContext } from './context.ts';
import { type OutboxEvent, intentsFor } from './events.ts';
import { needsQuietAudience, withQuietAudience } from './quiet.ts';

/**
 * The quiet ask in the dispatcher (S2-02): which events speak, and the one
 * place the initiator and the keen members are read — per kind, and only for
 * the four kinds that need them.
 */

const PLAN = '00000000-0000-4000-8000-0000000000b1';
const TOM = '00000000-0000-4000-8000-000000000003';
const PRIYA = '00000000-0000-4000-8000-000000000002';

const context = {
  planId: PLAN,
  circleId: '00000000-0000-4000-8000-0000000000c1',
  circleName: 'Sunday Crew',
  planCode: 'pnsundaycr',
  planState: 'seeking',
  planZone: zone('Australia/Melbourne'),
  revision: 1,
  organiserUserId: undefined,
  eligibility: { participantIds: [] } as unknown as PlanContext['eligibility'],
} as unknown as PlanContext;

const event = (name: string, payload: Record<string, unknown> = {}): OutboxEvent => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  seq: 1,
  event_name: name,
  aggregate_type: 'plan',
  aggregate_id: PLAN,
  payload: { plan_id: PLAN, revision: 1, mode: 'quiet', ...payload },
  attempts: 0,
});

const kinds = (e: OutboxEvent, c: PlanContext = context) =>
  intentsFor(e, c, instant(0)).map((intent) => intent.kind);

describe('what a quiet ask says, and when', () => {
  it('prompts the circle when it is asked, and not once it has stopped asking', () => {
    expect(kinds(event('planning.quiet_ask_created'))).toEqual(['quiet_ask']);
    const withdrawn = { ...context, planState: 'cancelled' } as PlanContext;
    expect(kinds(event('planning.quiet_ask_created'), withdrawn)).toEqual([]);
  });

  it('tells the initiator and the keen members when it opens', () => {
    expect(kinds(event('planning.threshold_reached', { keen_count: 3 }))).toEqual([
      'threshold_initiator',
      'threshold_keen',
    ]);
  });

  it('tells the initiator it closed only when it expired without opening', () => {
    expect(kinds(event('planning.plan_expired', { from_state: 'seeking' }))).toEqual([
      'quiet_expired',
    ]);
    // An opened quiet plan that ran past its last start did not close quietly.
    expect(kinds(event('planning.plan_expired', { from_state: 'collecting' }))).toEqual([]);
    // Nor does a named plan's expiry say anything (it never did).
    expect(
      kinds(event('planning.plan_expired', { mode: 'named', from_state: 'collecting' })),
    ).toEqual([]);
  });

  it('carries no actor on any of them: on a quiet ask the actor is the initiator', () => {
    for (const e of [
      event('planning.quiet_ask_created'),
      event('planning.threshold_reached'),
      event('planning.plan_expired', { from_state: 'seeking' }),
    ]) {
      for (const intent of intentsFor(e, context, instant(0))) {
        expect(intent.actorId).toBeUndefined();
      }
    }
  });
});

describe('the quiet audience', () => {
  it('is read for the four quiet kinds and for nothing else', () => {
    for (const kind of ['quiet_ask', 'threshold_initiator', 'threshold_keen', 'quiet_expired']) {
      expect(needsQuietAudience(kind as never)).toBe(true);
    }
    for (const kind of ['new_plan', 'options_ready', 'locked_in', 'cancelled', 'reminder']) {
      expect(needsQuietAudience(kind as never)).toBe(false);
    }
  });

  it('asks for one kind at a time and puts the answer into that eligibility question only', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const service = {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({
          data: { initiator_user_id: TOM, keen_user_ids: [TOM, PRIYA] },
          error: null,
        });
      },
    };
    const addressed = await withQuietAudience(service as never, context, 'threshold_keen');

    expect(calls).toEqual([
      { fn: 'dispatch_quiet_audience', args: { p_plan_id: PLAN, p_kind: 'threshold_keen' } },
    ]);
    expect(addressed.eligibility.quietInitiatorId).toBe(TOM);
    expect(addressed.eligibility.keenMemberIds).toEqual([TOM, PRIYA]);
    // The context the rest of the run shares is untouched.
    expect(context.eligibility.quietInitiatorId).toBeUndefined();
    expect(context.eligibility.keenMemberIds).toBeUndefined();
  });
});
