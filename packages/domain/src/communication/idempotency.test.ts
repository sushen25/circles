import { describe, expect, it } from 'vitest';

import { userId } from '../circles/types.js';
import { planId } from '../planning/types.js';
import { type IdempotencyParts, idempotencyInput, idempotencyKey } from './idempotency.js';

const BASE: IdempotencyParts = {
  channel: 'push',
  recipientId: userId('user-priya'),
  planId: planId('plan-1'),
  revision: 1,
  kind: 'locked_in',
  occurrence: 'confirmation-1',
};

describe('idempotencyKey', () => {
  it('is the same for the same send, every time', async () => {
    expect(await idempotencyKey(BASE)).toBe(await idempotencyKey(BASE));
  });

  it('is sha-256, in lower-case hex', async () => {
    expect(await idempotencyKey(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when any single part differs', async () => {
    const variants: readonly IdempotencyParts[] = [
      { ...BASE, channel: 'email' },
      { ...BASE, recipientId: userId('user-tom') },
      { ...BASE, planId: planId('plan-2') },
      { ...BASE, revision: 2 },
      { ...BASE, kind: 'reminder' },
      { ...BASE, occurrence: 'confirmation-2' },
    ];
    const keys = await Promise.all([BASE, ...variants].map(idempotencyKey));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('separates a missing plan from a plan that is there', async () => {
    // The cadence nudge belongs to a circle, not a plan. An absent plan has to
    // be distinct from every present one, which the length prefix gives it.
    const withoutPlan: IdempotencyParts = {
      channel: BASE.channel,
      recipientId: BASE.recipientId,
      kind: 'about_time',
      occurrence: '2026-10-08',
    };
    // An empty plan id cannot be constructed — `planId` refuses one — so the
    // only way an absent plan could collide is through the join, and the length
    // prefix is what stops it.
    expect(await idempotencyKey(withoutPlan)).not.toBe(await idempotencyKey(BASE));
    expect(await idempotencyKey(withoutPlan)).not.toBe(
      await idempotencyKey({ ...withoutPlan, planId: planId('plan-1') }),
    );
    expect(() => planId('')).toThrow(RangeError);
  });
});

describe('idempotencyInput', () => {
  it('cannot be confused by a value that looks like a boundary', () => {
    // Length-prefixed, so ("ab", "c") and ("a", "bc") are different strings. A
    // plain separator would let two different sends collide — and a collision
    // here is a notification that silently never arrives.
    const left = idempotencyInput({ ...BASE, recipientId: 'ab', occurrence: 'c' });
    const right = idempotencyInput({ ...BASE, recipientId: 'a', occurrence: 'bc' });
    expect(left).not.toBe(right);
  });

  it('is not fooled by a separator inside a value', () => {
    const left = idempotencyInput({ ...BASE, occurrence: 'a:b' });
    const right = idempotencyInput({ ...BASE, occurrence: 'a', kind: 'reminder' });
    expect(left).not.toBe(right);
  });

  it('carries every part', () => {
    const input = idempotencyInput(BASE);
    for (const part of ['push', 'user-priya', 'plan-1', '1', 'locked_in', 'confirmation-1']) {
      expect(input).toContain(part);
    }
  });
});
