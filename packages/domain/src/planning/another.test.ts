import { describe, expect, it } from 'vitest';

import { localDate } from '../shared/local-date.js';
import { type LastPlan, planAnotherDefaults } from './another.js';

/** The Sunday Crew's September plan: the fortnight from Mon 14, evenings, two hours. */
const september: LastPlan = {
  category: 'dinner',
  durationMinutes: 120,
  quorum: 4,
  quorumChosen: false,
  window: { start: localDate('2026-09-14'), end: localDate('2026-09-27') },
  daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
};

describe('planAnotherDefaults', () => {
  it('carries what it was, and leaves a defaulted quorum and suggested hours to the new plan', () => {
    expect(planAnotherDefaults(september)).toEqual({
      category: 'dinner',
      durationMinutes: 120,
      quorum: undefined,
      preset: 'next_14_days',
      daily: undefined,
    });
  });

  it('carries a quorum the organiser chose', () => {
    expect(planAnotherDefaults({ ...september, quorumChosen: true }).quorum).toBe(4);
  });

  it('carries hours the organiser chose', () => {
    const daily = { startMin: 16 * 60, endMin: 21 * 60 };
    expect(planAnotherDefaults({ ...september, daily }).daily).toEqual(daily);
  });

  it('reads the window back as the same kind of window', () => {
    const weekend = { start: localDate('2026-09-19'), end: localDate('2026-09-20') };
    const week = { start: localDate('2026-09-15'), end: localDate('2026-09-21') };
    expect(planAnotherDefaults({ ...september, window: weekend }).preset).toBe('this_weekend');
    expect(planAnotherDefaults({ ...september, window: week }).preset).toBe('next_7_days');
  });

  it('never asks about tonight again, nor carries tonight’s hours', () => {
    const tonight = { start: localDate('2026-09-17'), end: localDate('2026-09-17') };
    const got = planAnotherDefaults({
      ...september,
      window: tonight,
      daily: { startMin: 20 * 60, endMin: 23 * 60 + 30 },
    });
    expect(got.preset).toBe('next_7_days');
    expect(got.daily).toBeUndefined();
  });
});
