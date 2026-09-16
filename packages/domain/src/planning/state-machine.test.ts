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
import { type PlanState, acceptsAnswers, isTerminal } from './types.js';

/**
 * Everything at once, so the table-driven test below exercises the *rows*
 * rather than the actor: a fixture that satisfies only some guards would make a
 * row's absence and a guard's failure look the same.
 */
const ORGANISER: Actor = {
  userId: 'user-owner',
  isPermanent: true,
  isMember: true,
  isOrganiser: true,
  isOwner: true,
  isInitiator: true,
  isKeen: true,
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

describe("the quiet ask's two guards", () => {
  it('lets the initiator withdraw before threshold, and nobody else', () => {
    // The guard used to be `organiser`, and a seeking plan has no organiser by
    // definition — so the row was in the table and could never fire for anyone.
    const seeking = plan({ state: 'seeking', mode: 'quiet', organiserUserId: undefined });
    const initiator: Actor = { ...MEMBER, isInitiator: true, isKeen: false };
    const other: Actor = { ...MEMBER, isInitiator: false, isKeen: true };

    expect(isOk(canTransition(seeking, 'cancel', { actor: initiator }))).toBe(true);
    const refused = canTransition(seeking, 'cancel', { actor: other });
    expect(isOk(refused)).toBe(false);
    if (!isOk(refused)) expect(refused.error.code).toBe('not_the_initiator');
  });

  it('offers the organiser role to the keen and the initiator only', () => {
    // Architecture §9.1: "accept-organiser | keen member (quiet) or initiator".
    const collecting = plan({ state: 'collecting', mode: 'quiet', organiserUserId: undefined });
    const keen: Actor = { ...MEMBER, isKeen: true, isInitiator: false };
    const initiator: Actor = { ...MEMBER, isKeen: false, isInitiator: true };
    const uninterested: Actor = { ...MEMBER, isKeen: false, isInitiator: false, isOwner: false };

    expect(isOk(canTransition(collecting, 'accept_organiser', { actor: keen }))).toBe(true);
    expect(isOk(canTransition(collecting, 'accept_organiser', { actor: initiator }))).toBe(true);

    const refused = canTransition(collecting, 'accept_organiser', { actor: uninterested });
    expect(isOk(refused)).toBe(false);
    if (!isOk(refused)) expect(refused.error.code).toBe('not_keen_initiator_or_owner');
  });

  it('lets the owner take it when nobody volunteered', () => {
    // "If nobody volunteers before replies close, the circle owner gets a quiet
    // nudge" (§5.4). A nudge to somebody the guard refuses is a dead end, and
    // the dead end leaves a ready plan with no organiser at all.
    const ready = plan({ state: 'ready', mode: 'quiet', organiserUserId: undefined });
    const owner: Actor = { ...MEMBER, isOwner: true, isKeen: false, isInitiator: false };
    expect(isOk(canTransition(ready, 'accept_organiser', { actor: owner }))).toBe(true);
  });

  it('refuses an initiator who has left the circle', () => {
    // The private initiator row outlives the membership, and removal revokes
    // access immediately (§6.2). Being the initiator is not a way back in.
    const seeking = plan({ state: 'seeking', mode: 'quiet', organiserUserId: undefined });
    const gone: Actor = { ...MEMBER, isMember: false, isInitiator: true };
    const refused = canTransition(seeking, 'cancel', { actor: gone });
    expect(isOk(refused)).toBe(false);
    if (!isOk(refused)) expect(refused.error.code).toBe('not_a_member');
  });

  it('crosses the threshold only when the count says so', () => {
    // The row was guardless — "enforcing once is the database's job" — and a
    // guardless row is one any caller can fire, which published a below-threshold
    // count the moment somebody did.
    const seeking = plan({ state: 'seeking', mode: 'quiet', quietThreshold: 3 });
    const short = canTransition(seeking, 'threshold_reached', { actor: MEMBER, keenCount: 2 });
    expect(isOk(short)).toBe(false);
    if (!isOk(short)) expect(short.error.code).toBe('threshold_not_reached');

    expect(isOk(canTransition(seeking, 'threshold_reached', { actor: MEMBER, keenCount: 3 }))).toBe(
      true,
    );
  });

  it('fails closed when the count is unknown', () => {
    const seeking = plan({ state: 'seeking', mode: 'quiet', quietThreshold: 3 });
    expect(isOk(canTransition(seeking, 'threshold_reached', { actor: MEMBER }))).toBe(false);
  });

  it('still requires a saved place, however keen somebody is', () => {
    const collecting = plan({ state: 'collecting', mode: 'quiet', organiserUserId: undefined });
    const keenGuest: Actor = { ...GUEST, isKeen: true };
    const refused = canTransition(collecting, 'accept_organiser', { actor: keenGuest });
    expect(isOk(refused)).toBe(false);
    if (!isOk(refused)) expect(refused.error.code).toBe('needs_permanent_identity');
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
        // `threshold_reached` needs a threshold to have been reached.
        mode: from === 'seeking' ? 'quiet' : 'named',
        quietThreshold: from === 'seeking' ? 3 : undefined,
      });
      const result = canTransition(before, action, {
        actor: ORGANISER,
        candidateId: 'cand-1',
        eligibleCandidateIds: ['cand-1'],
        keenCount: 99,
      });

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
      eligibleCandidateIds: ['cand-1'],
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
    const result = canTransition(plan({ state: 'collecting' }), 'edit', { actor: MEMBER });
    expect(isErr(result) && result.error.code).toBe('not_the_organiser');
  });

  it('lets the circle owner cancel a plan somebody else is organising', () => {
    // Spec §4.5 says so in as many words, and the organiser-only guard said
    // otherwise the moment a plan had an organiser who was not the owner.
    const owner: Actor = { ...MEMBER, isOwner: true };
    for (const state of ['collecting', 'ready', 'confirmed'] as const) {
      expect(isOk(canTransition(plan({ state }), 'cancel', { actor: owner })), state).toBe(true);
    }
  });

  it('offers adjust from exactly the states that offer edit', () => {
    // `revise-plan` asks the mirror whether `edit` exists from a plan's state
    // and lets that answer stand for `adjust` too, because deriving which of the
    // two a request is would be a second copy of the derivation SQL owns. This
    // is what makes the shortcut true rather than convenient.
    const from = (action: PlanAction): string[] =>
      TRANSITIONS.filter((t) => t.action === action)
        .map((t) => t.from)
        .sort();
    expect(from('adjust')).toEqual(from('edit'));
  });

  it('refuses a member who is neither', () => {
    const result = canTransition(plan({ state: 'collecting' }), 'cancel', { actor: MEMBER });
    expect(isErr(result) && result.error.code).toBe('not_the_organiser_or_owner');
  });

  it('refuses an owner who has been removed from their own circle', () => {
    // An id on a row is not membership.
    const departed: Actor = { ...MEMBER, isOwner: true, isMember: false };
    const result = canTransition(plan({ state: 'ready' }), 'cancel', { actor: departed });
    expect(isErr(result) && result.error.code).toBe('not_the_organiser_or_owner');
  });

  it('refuses a confirm with no candidate chosen', () => {
    const result = canTransition(plan({ state: 'ready' }), 'confirm', { actor: ORGANISER });
    expect(isErr(result) && result.error.code).toBe('needs_candidate');
  });

  it('refuses a candidate that is not on offer', () => {
    // The id is well-formed and simply does not exist. Checking only that a
    // string was supplied would confirm a time nobody can make.
    const result = canTransition(plan({ state: 'ready' }), 'confirm', {
      actor: ORGANISER,
      candidateId: 'does-not-exist',
      eligibleCandidateIds: ['cand-1', 'cand-2'],
    });
    expect(isErr(result) && result.error.code).toBe('needs_candidate');
  });

  it('refuses a candidate that stopped being eligible while the organiser was deciding', () => {
    const result = canTransition(plan({ state: 'ready' }), 'confirm', {
      actor: ORGANISER,
      candidateId: 'cand-1',
      eligibleCandidateIds: ['cand-2'],
    });
    expect(isErr(result) && result.error.code).toBe('needs_candidate');
  });

  it('fails closed when the caller did not say what is on offer', () => {
    const result = canTransition(plan({ state: 'ready' }), 'confirm', {
      actor: ORGANISER,
      candidateId: 'cand-1',
    });
    expect(isErr(result) && result.error.code).toBe('needs_candidate');
  });

  it('does not offer the organiser role before the threshold is reached', () => {
    // The ThresholdRole screen opens with "Enough people are keen." Offering
    // the role during `seeking` asks someone to organise a plan nobody yet
    // knows has support.
    const seeking = plan({ state: 'seeking', mode: 'quiet', organiserUserId: undefined });
    const result = canTransition(seeking, 'accept_organiser', { actor: MEMBER });
    expect(isErr(result) && result.error.code).toBe('wrong_state');
  });

  it('still offers the role once candidates are ready, or a quiet plan is stuck', () => {
    // "If nobody volunteers before replies close, the circle owner gets a quiet
    // nudge" — worthless if the role can no longer be accepted by then.
    const ready = plan({ state: 'ready', mode: 'quiet', organiserUserId: undefined });
    const result = canTransition(ready, 'accept_organiser', { actor: MEMBER });
    expect(isOk(result) && result.value.organiserUserId).toBe('user-2');
    expect(isOk(result) && result.value.state).toBe('ready');
  });

  it('refuses accepting the organiser role when someone already has it', () => {
    const taken = plan({ state: 'collecting', organiserUserId: userId('user-owner') });
    const result = canTransition(taken, 'accept_organiser', { actor: MEMBER });
    expect(isErr(result) && result.error.code).toBe('already_has_organiser');
  });
});

describe('what a transition changes', () => {
  it('appoints the accepting member as organiser', () => {
    const quiet = plan({ state: 'collecting', mode: 'quiet', organiserUserId: undefined });
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
      eligibleCandidateIds: ['cand-1'],
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

describe('acceptsAnswers', () => {
  it('is collecting and ready, and nothing else', () => {
    const all: PlanState[] = [
      'draft',
      'seeking',
      'collecting',
      'ready',
      'confirmed',
      'completed',
      'expired',
      'cancelled',
    ];
    // The same two `public.replace_response` accepts. A client that sent somebody
    // to the availability screen of a plan in any other state would send them to
    // a form whose submit the server refuses.
    expect(all.filter(acceptsAnswers)).toEqual(['collecting', 'ready']);
  });
});
