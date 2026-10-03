import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ProblemReason, WIRE_REASON_OF } from '@circles/contracts';

import { problemFor, reasonOf } from './problem.ts';

const TRANSITION_SQL = fileURLToPath(
  new URL('../../sql/functions/planning/transition_plan.sql', import.meta.url),
);

/**
 * What `transition_plan` raises that is deliberately not a refusal: a caller
 * that sent a payload the function does not read is a bug in the caller, and
 * the 500 is the right answer to it.
 */
const NOT_A_REFUSAL: readonly string[] = ['unexpected_payload'];

/** Every literal the function raises: `raise exception 'name'`. */
function raisedBy(source: string): string[] {
  const names = [...source.matchAll(/raise exception\s+'([a-z_]+)'/g)].map((m) => m[1] ?? '');
  return [...new Set(names)].sort();
}

describe('every refusal the database raises reaches the person as a reason', () => {
  const raised = raisedBy(readFileSync(TRANSITION_SQL, 'utf8'));

  it('reads the source it is guarding', () => {
    // A pattern that stops matching would pass every case below with nothing in it.
    expect(raised).toContain('needs_permanent_identity');
    expect(raised.length).toBeGreaterThan(15);
  });

  it.each(raised.filter((name) => !NOT_A_REFUSAL.includes(name)))(
    '%s has a reason, and is not a 500',
    (name) => {
      const reason = reasonOf({ message: name });
      expect(reason).toBeDefined();
      expect(ProblemReason.safeParse(reason).success).toBe(true);
      expect(problemFor(reason!, 'x', 'ref').status).toBeLessThan(500);
    },
  );

  it('the four that used to be a 500 each get a status and a reason', () => {
    expect(problemFor(reasonOf({ message: 'needs_permanent_identity' })!, 'x', 'r').status).toBe(
      403,
    );
    expect(problemFor(reasonOf({ message: 'already_has_organiser' })!, 'x', 'r').status).toBe(409);
    expect(problemFor(reasonOf({ message: 'not_keen_initiator_or_owner' })!, 'x', 'r').status).toBe(
      403,
    );
    expect(problemFor(reasonOf({ message: 'threshold_not_reached' })!, 'x', 'r').status).toBe(409);
  });
});

describe('the domain table', () => {
  it('names only reasons that exist', () => {
    for (const reason of Object.values(WIRE_REASON_OF)) {
      if (reason !== null) expect(ProblemReason.safeParse(reason).success).toBe(true);
    }
  });

  it("gives the domain's older spelling the wire's reason", () => {
    expect(reasonOf({ message: 'needs_saved_place' })).toBe('requires_saved_place');
    expect(reasonOf({ message: 'candidate_not_eligible' })).toBe('needs_candidate');
  });

  it('leaves a refusal the request schema owns without a reason, and a stray name too', () => {
    expect(reasonOf({ message: 'note_too_long' })).toBeUndefined();
    expect(reasonOf({ message: 'toString' })).toBeUndefined();
    expect(reasonOf({ message: 'constructor' })).toBeUndefined();
  });
});
