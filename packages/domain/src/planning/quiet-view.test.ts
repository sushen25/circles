import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { type UserId, userId } from '../circles/types.js';
import { ALEX, JESS, PRIYA, SAM, SUNDAY_CREW, TOM } from '../scheduling/fixtures.js';
import { addMinutes, instant } from '../shared/instant.js';
import { FRIDAY_MIDDAY, TOM_ASKS, quietAsk, quietPlan } from './fixtures.js';
import { type Interest, keenCount, recordInterest } from './quiet.js';
import { onThreshold } from './quiet-threshold.js';
import { type QuietFacts, type QuietViewer, QUIET_VIEW_KEYS, quietView } from './quiet-view.js';
import type { PlanState } from './types.js';

const STATES: readonly PlanState[] = [
  'draft',
  'seeking',
  'collecting',
  'ready',
  'confirmed',
  'completed',
  'expired',
  'cancelled',
];

const viewer = (overrides: Partial<QuietViewer> = {}): QuietViewer => ({
  userId: PRIYA,
  isMember: true,
  isPermanent: true,
  isOwner: false,
  isInitiator: false,
  myAnswer: null,
  ...overrides,
});
/** The two keys that only ever differ on the initiator's own screen. */
function withoutOwnCapabilities(view: object | undefined): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...view };
  delete rest['mayWithdraw'];
  delete rest['showClosedNotice'];
  return rest;
}

const FACTS: QuietFacts = { now: TOM_ASKS, keenCount: null, organiserName: null };

const arbViewer = fc.record({
  userId: fc.constantFrom(...SUNDAY_CREW),
  isMember: fc.constant(true),
  isPermanent: fc.boolean(),
  isOwner: fc.boolean(),
  isInitiator: fc.boolean(),
  myAnswer: fc.constantFrom<Interest | null>(null, 'keen', 'not_this_time'),
});
const arbFacts = fc.record({
  now: fc.integer({ min: 0, max: 14 * 24 * 60 }).map((m) => addMinutes(TOM_ASKS, m)),
  keenCount: fc.option(fc.integer({ min: 0, max: 20 }), { nil: null }),
  organiserName: fc.option(fc.constantFrom('Priya', 'Tom', 'Sam'), { nil: null }),
  everOpened: fc.option(fc.boolean(), { nil: undefined }),
});
const arbPlan = fc
  .record({
    state: fc.constantFrom(...STATES),
    organiser: fc.option(fc.constantFrom(...SUNDAY_CREW), { nil: undefined }),
  })
  .map(({ state, organiser }) => quietPlan({ state, organiserUserId: organiser }));

describe('quietView never exposes an initiator', () => {
  it('has exactly its phase’s keys, none of them about an initiator, for every viewer and state', () => {
    fc.assert(
      fc.property(arbPlan, arbViewer, arbFacts, (plan, who, facts) => {
        const view = quietView(plan, who, facts);
        if (view === undefined) throw new Error('an active member always gets a view');
        expect(Object.keys(view).sort()).toEqual([...QUIET_VIEW_KEYS[view.phase]].sort());
        for (const key of Object.keys(view)) expect(key).not.toMatch(/initiat/i);
      }),
      { numRuns: 2000 },
    );
  });

  it('enumerates every state for every kind of viewer, exhaustively', () => {
    const kinds: QuietViewer[] = [
      viewer({ userId: TOM, isInitiator: true, myAnswer: 'keen' }),
      viewer({ userId: PRIYA, myAnswer: 'keen' }),
      viewer({ userId: ALEX, myAnswer: 'not_this_time' }),
      viewer({ userId: JESS }),
      viewer({ userId: SAM, isOwner: true }),
      viewer({ userId: userId('guest'), isPermanent: false }),
    ];
    for (const state of STATES) {
      for (const who of kinds) {
        const view = quietView(quietPlan({ state }), who, { ...FACTS, keenCount: 3 });
        expect(view).toBeDefined();
        const serialised = JSON.stringify(view);
        expect(serialised).not.toMatch(/initiat/i);
        // Nobody's id, the viewer's own included, is in what they are shown.
        for (const id of SUNDAY_CREW) expect(serialised).not.toContain(`"${id}"`);
      }
    }
  });

  it('shows no count while seeking — to anybody, the initiator included — whatever the count is', () => {
    fc.assert(
      fc.property(arbViewer, arbFacts, fc.integer({ min: 0, max: 20 }), (who, facts, count) => {
        const plan = quietPlan();
        const a = quietView(plan, who, { ...facts, keenCount: null });
        const b = quietView(plan, who, { ...facts, keenCount: count });
        expect(a).toEqual(b);
        expect(a?.phase).toBe('seeking');
        expect(a).not.toHaveProperty('keenCount');
      }),
    );
  });

  it('depends on who the viewer is only through their own answer and roles, never their id', () => {
    fc.assert(
      fc.property(
        arbPlan,
        arbViewer,
        arbFacts,
        fc.constantFrom(...SUNDAY_CREW),
        (plan, who, facts, other) => {
          expect(quietView(plan, { ...who, userId: other }, facts)).toEqual(
            quietView(plan, who, facts),
          );
        },
      ),
    );
  });

  it('shows the initiator what a keen member sees, bar withdrawing and the expiry notice', () => {
    for (const state of STATES) {
      const plan = quietPlan({ state });
      const facts = { ...FACTS, keenCount: 3, everOpened: false };
      const theirs = quietView(plan, viewer({ isInitiator: true, myAnswer: 'keen' }), facts);
      const keen = quietView(plan, viewer({ myAnswer: 'keen' }), facts);
      expect(withoutOwnCapabilities(theirs)).toEqual(withoutOwnCapabilities(keen));
    }
  });
});

describe('quietView', () => {
  it('while seeking: when it closes, what opens it, and my own answer', () => {
    expect(quietView(quietPlan(), viewer({ myAnswer: 'keen' }), FACTS)).toEqual({
      phase: 'seeking',
      closesAt: FRIDAY_MIDDAY,
      threshold: 3,
      answeredByMe: true,
      myAnswer: 'keen',
      mayWithdraw: false,
    });
    expect(
      quietView(quietPlan(), viewer({ isInitiator: true, myAnswer: 'keen' }), FACTS),
    ).toMatchObject({
      mayWithdraw: true,
    });
  });

  it('once opened: the count, the organiser by name once there is one, and whether I may take the role', () => {
    const open = quietPlan({ state: 'collecting', responseDeadline: FRIDAY_MIDDAY });
    expect(quietView(open, viewer({ myAnswer: 'keen' }), { ...FACTS, keenCount: 3 })).toEqual({
      phase: 'opened',
      keenCount: 3,
      organiser: null,
      mayTakeRole: true,
    });
    const taken = quietPlan({ state: 'collecting', organiserUserId: PRIYA });
    expect(
      quietView(taken, viewer({ userId: JESS }), {
        ...FACTS,
        keenCount: 3,
        organiserName: 'Priya',
      }),
    ).toEqual({ phase: 'opened', keenCount: 3, organiser: 'Priya', mayTakeRole: false });
  });

  it('offers the role to the owner who was not keen only once replies have closed', () => {
    const open = quietPlan({ state: 'ready', responseDeadline: FRIDAY_MIDDAY });
    const owner = viewer({ userId: SAM, isOwner: true });
    expect(quietView(open, owner, FACTS)).toMatchObject({ mayTakeRole: false });
    expect(quietView(open, owner, { ...FACTS, now: FRIDAY_MIDDAY })).toMatchObject({
      mayTakeRole: true,
    });
    const guest = viewer({ myAnswer: 'keen', isPermanent: false });
    expect(quietView(open, guest, FACTS)).toMatchObject({ mayTakeRole: false });
  });

  it('tells only the initiator that an ask closed, and only one that never opened', () => {
    const expired = quietPlan({ state: 'expired' });
    const initiator = viewer({ isInitiator: true, myAnswer: 'keen' });
    expect(quietView(expired, initiator, { ...FACTS, everOpened: false })).toEqual({
      phase: 'closed',
      showClosedNotice: true,
    });
    expect(quietView(expired, initiator, { ...FACTS, everOpened: true })).toMatchObject({
      showClosedNotice: false,
    });
    expect(quietView(expired, initiator, FACTS)).toMatchObject({ showClosedNotice: false });
    expect(quietView(expired, viewer(), { ...FACTS, everOpened: false })).toMatchObject({
      showClosedNotice: false,
    });
  });

  it('shows a withdrawn ask as it shows an expired one, to everybody else', () => {
    const everyone = [viewer(), viewer({ myAnswer: 'keen' }), viewer({ isOwner: true })];
    for (const who of everyone) {
      expect(quietView(quietPlan({ state: 'cancelled' }), who, FACTS)).toEqual(
        quietView(quietPlan({ state: 'expired' }), who, { ...FACTS, everOpened: false }),
      );
    }
  });

  it('shows nothing to somebody outside the circle, and nothing for a named plan', () => {
    expect(quietView(quietPlan(), viewer({ isMember: false }), FACTS)).toBeUndefined();
    expect(quietView(quietPlan({ mode: 'named' }), viewer(), FACTS)).toBeUndefined();
  });
});

describe('the count shown after threshold cannot be differenced', () => {
  it('no answer, by anybody, moves the keen count once the ask has opened', () => {
    const met = quietAsk({
      answers: [
        [TOM, 'keen'],
        [PRIYA, 'keen'],
        [JESS, 'keen'],
      ],
    });
    const opened = onThreshold(met, {
      preset: 'this_weekend',
      now: TOM_ASKS,
      circleHasOpenPlan: false,
    });
    if (!opened.ok) throw new Error(opened.error.code);
    const after = { ...met, plan: opened.value.plan };

    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom<UserId>(...SUNDAY_CREW),
            fc.constantFrom<Interest>('keen', 'not_this_time'),
            fc.integer({ min: 0, max: 7 * 24 * 60 }),
          ),
        ),
        (answers) => {
          let ask = after;
          for (const [who, response, minutes] of answers) {
            const now = instant(TOM_ASKS + minutes * 60_000);
            const result = recordInterest(ask, who, response, { now, circleHasOpenPlan: false });
            expect(result.ok).toBe(false);
            if (result.ok) ask = result.value.ask;
          }
          expect(keenCount(ask)).toBe(3);
        },
      ),
    );
  });
});
