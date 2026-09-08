import { describe, expect, it } from 'vitest';

import { isErr, isOk } from '../shared/result.js';
import { userId } from '../circles/types.js';
import { plan } from './fixtures.js';
import {
  type Actor,
  type PlanAction,
  TRANSITIONS,
  canTransition,
  transitionsFrom,
} from './state-machine.js';
import { type PlanState, isTerminal } from './types.js';

const ORGANISER: Actor = {
  userId: 'user-owner',
  isPermanent: true,
  isMember: true,
  isOrganiser: true,
  isOwner: true,
};

const MEMBER: Actor = { ...ORGANISER, userId: 'user-2', isOrganiser: false, isOwner: false };
const GUEST: Actor = { ...MEMBER, isPermanent: false };
const STRANGER: Actor = { ...MEMBER, isMember: false };

const ALL_STATES: readonly PlanState[] = [
  'draft',
  'seeking',
  'collecting',
  'ready',
  'confirmed',
  'completed',
  'expired',
  'cancelled',
];

describe('the transition table', () => {
  it('is exported as data so the SQL mirror can be generated from it', () => {
    expect(Array.isArray(TRANSITIONS)).toBe(true);
    expect(TRANSITIONS.length).toBeGreaterThan(0);
  });

  it('has no duplicate (from, action) pairs — one row decides each move', () => {
    const seen = new Set<string>();
    for (const t of TRANSITIONS) {
      const key = `${t.from}:${t.action}`;
      expect(seen.has(key), `duplicate row for ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('never leaves a terminal state', () => {
    for (const t of TRANSITIONS) {
      expect(isTerminal(t.from), `${t.from} is terminal but has an outgoing ${t.action}`).toBe(
        false,
      );
    }
  });

  it('only bumps the revision on an edit or a reopen', () => {
    for (const t of TRANSITIONS.filter((x) => x.bumpsRevision === true)) {
      expect(['edit', 'reopen']).toContain(t.action);
    }
  });
});

describe('every row is reachable and every non-row is refused', () => {
  // The positive half: each row does what it says.
  it.each(TRANSITIONS.map((t) => [t.from, t.action, t.to] as const))(
    '%s + %s -> %s',
    (from, action, to) => {
      const before = plan({
        state: from,
        // `accept_organiser` requires the seat to be empty; every other row is
        // happy with an organiser in place.
        organiserUserId: action === 'accept_organiser' ? undefined : userId('user-owner'),
      });
      const result = canTransition(before, action, { actor: ORGANISER, candidateId: 'cand-1' });

      expect(isOk(result), `${from} + ${action} was refused`).toBe(true);
      if (isOk(result)) {
        expect(result.value.state).toBe(to);
      }
    },
  );

  // The negative half: every (state, action) pair not in the table is refused.
  const legal = new Set(TRANSITIONS.map((t) => `${t.from}:${t.action}`));
  const actions: readonly PlanAction[] = [
    ...new Set(TRANSITIONS.map((t) => t.action)),
  ] as readonly PlanAction[];

  const illegal = ALL_STATES.flatMap((state) =>
    actions
      .filter((action) => !legal.has(`${state}:${action}`))
      .map((action) => [state, action] as const),
  );

  it.each(illegal)('%s refuses %s', (state, action) => {
    const result = canTransition(plan({ state }), action, {
      actor: ORGANISER,
      candidateId: 'cand-1',
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(isTerminal(state) ? 'plan_is_finished' : 'wrong_state');
    }
  });
});

describe('guards', () => {
  it('refuses a stranger', () => {
    const result = canTransition(plan({ state: 'draft' }), 'create_named', { actor: STRANGER });
    expect(isErr(result) && result.error.code).toBe('not_a_member');
  });

  it('refuses an anonymous identity for creation (ADR 0004)', () => {
    const result = canTransition(plan({ state: 'draft' }), 'create_named', { actor: GUEST });
    expect(isErr(result) && result.error.code).toBe('needs_permanent_identity');
  });

  it('lets an anonymous member respond to things that are not creation', () => {
    // `candidates_ready` is the engine's verdict, so it carries no actor guard.
    const result = canTransition(plan({ state: 'collecting' }), 'candidates_ready', {
      actor: GUEST,
    });
    expect(isOk(result)).toBe(true);
  });

  it('refuses a non-organiser the organiser actions', () => {
    for (const action of ['edit', 'cancel'] as const) {
      const result = canTransition(plan({ state: 'collecting' }), action, { actor: MEMBER });
      expect(isErr(result) && result.error.code, action).toBe('not_the_organiser');
    }
  });

  it('refuses a confirm with no candidate chosen', () => {
    const result = canTransition(plan({ state: 'ready' }), 'confirm', { actor: ORGANISER });
    expect(isErr(result) && result.error.code).toBe('needs_candidate');
  });

  it('refuses accepting the organiser role when someone already has it', () => {
    const taken = plan({ state: 'seeking', organiserUserId: userId('user-owner') });
    const result = canTransition(taken, 'accept_organiser', { actor: MEMBER });
    expect(isErr(result) && result.error.code).toBe('already_has_organiser');
  });
});

describe('what a transition changes', () => {
  it('appoints the accepting member as organiser', () => {
    const quiet = plan({ state: 'seeking', mode: 'quiet', organiserUserId: undefined });
    const result = canTransition(quiet, 'accept_organiser', { actor: MEMBER });
    expect(isOk(result) && result.value.organiserUserId).toBe('user-2');
  });

  it('bumps the revision on an edit, and leaves the organiser alone', () => {
    const before = plan({ state: 'collecting', revision: 3 });
    const result = canTransition(before, 'edit', { actor: ORGANISER });
    expect(isOk(result) && result.value.revision).toBe(4);
    expect(isOk(result) && result.value.organiserUserId).toBe(before.organiserUserId);
  });

  it('bumps the revision on a reopen — a changed time is a fresh ask', () => {
    const result = canTransition(plan({ state: 'confirmed', revision: 1 }), 'reopen', {
      actor: ORGANISER,
    });
    expect(isOk(result) && result.value.state).toBe('collecting');
    expect(isOk(result) && result.value.revision).toBe(2);
  });

  it('does not bump the revision on a cancel or a confirm', () => {
    const confirmed = canTransition(plan({ state: 'ready', revision: 2 }), 'confirm', {
      actor: ORGANISER,
      candidateId: 'cand-1',
    });
    expect(isOk(confirmed) && confirmed.value.revision).toBe(2);
  });

  it('never mutates the plan it was given', () => {
    const before = plan({ state: 'collecting', revision: 1 });
    canTransition(before, 'edit', { actor: ORGANISER });
    expect(before.revision).toBe(1);
    expect(before.state).toBe('collecting');
  });
});

describe('transitionsFrom', () => {
  it('lists what a plan can do next, for the UI to enable or hide', () => {
    expect(
      transitionsFrom('confirmed')
        .map((t) => t.action)
        .sort(),
    ).toEqual(['cancel', 'reopen', 'report_outcome']);
  });

  it('is empty for a finished plan', () => {
    for (const state of ['completed', 'expired', 'cancelled'] as const) {
      expect(transitionsFrom(state)).toEqual([]);
    }
  });
});
