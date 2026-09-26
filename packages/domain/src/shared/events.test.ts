import { describe, expect, it } from 'vitest';

import { DOMAIN_EVENT_NAMES, contextOf, domainEvent } from './events';
import { fromISO } from './instant';

describe('domain events', () => {
  it('names every event in architecture §6.3, per context', () => {
    const byContext = DOMAIN_EVENT_NAMES.reduce<Record<string, number>>((counts, name) => {
      const context = contextOf(name);
      return { ...counts, [context]: (counts[context] ?? 0) + 1 };
    }, {});

    // Counting per context rather than in total: a missing event shows up as
    // the context it belongs to, which is the useful thing to be told.
    expect(byContext).toEqual({
      circles: 5,
      planning: 10,
      availability: 2,
      scheduling: 2,
      confirmation: 5,
      communication: 3,
      growth: 4,
    });
    expect(new Set(DOMAIN_EVENT_NAMES).size).toBe(DOMAIN_EVENT_NAMES.length);
  });

  it('is past tense and namespaced by context — a record, not an instruction', () => {
    for (const name of DOMAIN_EVENT_NAMES) {
      expect(name, name).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(contextOf(name), name).toMatch(
        /^(circles|planning|availability|scheduling|confirmation|communication|growth)$/,
      );
    }
  });

  it('stamps when it happened', () => {
    const event = domainEvent('planning.plan_created', fromISO('2026-09-17T08:30:00.000Z'), {
      planId: 'plan-1',
    });
    expect(event.name).toBe('planning.plan_created');
    expect(event.payload).toEqual({ planId: 'plan-1' });
  });
});
