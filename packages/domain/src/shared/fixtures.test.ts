import { describe, expect, it } from 'vitest';

import { circle, member, plan, response, window } from './fixtures';
import { durationMinutes, isAligned30 } from './interval';
import { localDate } from './local-date';
import { toLocal } from './zone';

describe('fixture builders', () => {
  it('fill in sensible defaults so a test states only what it is about', () => {
    expect(circle().name).toBe('Sunday Crew');
    expect(member().role).toBe('member');
    expect(plan().mode).toBe('named');
    expect(response().status).toBe('windows');
  });

  it('take overrides without losing the rest', () => {
    expect(circle({ quorum: 2 })).toMatchObject({ quorum: 2, name: 'Sunday Crew' });
    expect(member({ name: 'Alex', role: 'owner' }).circleId).toBe('circle-1');
  });

  it('build windows that are aligned and land on the local time asked for', () => {
    const evening = window(localDate('2026-09-17'), 17 * 60 + 30, 22 * 60 + 30);

    expect(isAligned30(evening)).toBe(true);
    expect(durationMinutes(evening)).toBe(300);
    expect(toLocal(evening.start, circle().timeZone).minutesOfDay).toBe(17 * 60 + 30);
  });

  it('are independent — one test cannot alter another test’s data', () => {
    const first = circle();
    first.name = 'Changed';
    expect(circle().name).toBe('Sunday Crew');
  });
});
