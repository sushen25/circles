import { describe, expect, it } from 'vitest';

import { circle, member } from '../circles/fixtures';
import { response } from '../availability/fixtures';
import { plan } from '../planning/fixtures';
import { MELBOURNE, window } from './fixtures';
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
    expect(circle({ defaultQuorum: 2 })).toMatchObject({ defaultQuorum: 2, name: 'Sunday Crew' });
    expect(member({ displayName: 'Alex', role: 'owner' }).circleId).toBe('circle-1');
  });

  it('build windows that are aligned and land on the local time asked for', () => {
    const evening = window(localDate('2026-09-17'), 17 * 60 + 30, 22 * 60 + 30);

    expect(isAligned30(evening)).toBe(true);
    expect(durationMinutes(evening)).toBe(300);
    expect(toLocal(evening.start, MELBOURNE).minutesOfDay).toBe(17 * 60 + 30);
  });

  it('are independent — one test cannot alter another test’s data', () => {
    // Circle is readonly now, so mutating it is a type error rather than a
    // runtime hazard. The builder still returns a fresh object each call.
    expect(circle()).not.toBe(circle());
    expect(circle({ name: 'Changed' }).name).toBe('Changed');
    expect(circle().name).toBe('Sunday Crew');
  });
});
