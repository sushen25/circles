import { describe, expect, it } from 'vitest';

import type { CircleSummary } from '../../data/circles';
import { listLine } from './lines';

/**
 * The line under each circle on the list (spec §5.2): the three the artboard
 * draws, and the ones it does not.
 */
function summary(overrides: Partial<CircleSummary> = {}): CircleSummary {
  return {
    id: 'c',
    name: 'Sunday Crew',
    color: 'clay',
    status: 'active',
    cadence: 'monthly',
    zone: 'Australia/Melbourne',
    // Sunday 2 August 2026, 6:30 pm Melbourne.
    lastMetAt: '2026-08-02T08:30:00Z',
    cadenceSnoozedUntil: null,
    defaultDurationMinutes: 120,
    memberCount: 6,
    isOwner: true,
    activePlan: null,
    lockedIn: null,
    ...overrides,
  };
}

const NOW = new Date('2026-08-10T00:00:00Z');

describe('the circles list line', () => {
  it('counts replies while a plan is finding a time', () => {
    expect(listLine(summary({ activePlan: { replied: 5, asked: 6 } }), NOW)).toBe(
      'Finding a time · 5 of 6 replied',
    );
  });

  // The date order is the device's (manifesto §6), so either is right.
  it('names the day of a meetup locked in', () => {
    expect(listLine(summary({ lockedIn: { startsAt: '2026-09-24T08:30:00Z' } }), NOW)).toMatch(
      /^Locked in · Thu.*(24.*Sep|Sep.*24)/,
    );
  });

  it('says when they last caught up, and that there is no rush', () => {
    expect(listLine(summary(), NOW)).toMatch(/^Last caught up Sun.*(2 Aug|Aug 2) · No rush$/);
  });

  it('says it is about time, without counting anything', () => {
    const line = listLine(summary(), new Date('2026-08-28T00:00:00Z'));
    expect(line).toBe('About time for the next one');
    expect(line).not.toMatch(/\d|overdue/i);
  });

  it('says just you for a circle nobody has joined', () => {
    expect(listLine(summary({ memberCount: 1, lastMetAt: null }), NOW)).toBe('Just you so far');
  });

  it('says a circle with no goal has none, and one that has never met has not', () => {
    expect(listLine(summary({ cadence: 'none' }), NOW)).toMatch(/· No goal set$/);
    expect(listLine(summary({ cadence: 'none', lastMetAt: null }), NOW)).toBe('No goal set');
    expect(listLine(summary({ lastMetAt: null }), NOW)).toBe('Not caught up yet');
  });

  it('says archived before anything else', () => {
    expect(
      listLine(summary({ status: 'archived', activePlan: { replied: 1, asked: 2 } }), NOW),
    ).toBe('Archived');
  });
});
