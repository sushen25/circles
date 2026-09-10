import { describe, expect, it } from 'vitest';

import { fromISO, toISO } from '../shared/instant.js';
import { MELBOURNE } from '../shared/fixtures.js';
import { toLocal, zone } from '../shared/zone.js';
import {
  QUIET_END_MIN,
  QUIET_START_MIN,
  isQuietMinute,
  scheduleFor,
  wasHeld,
} from './quiet-hours.js';

const KATHMANDU = zone('Asia/Kathmandu'); // UTC+05:45 — a half-hour zone, and 45 at that
const LONDON = zone('Europe/London');

const localOf = (iso: string, z = MELBOURNE) => toLocal(fromISO(iso), z);

describe('isQuietMinute', () => {
  it('wraps midnight, so it is an "or" and not a range', () => {
    expect(isQuietMinute(QUIET_START_MIN)).toBe(true);
    expect(isQuietMinute(23 * 60 + 59)).toBe(true);
    expect(isQuietMinute(0)).toBe(true);
    expect(isQuietMinute(QUIET_END_MIN - 1)).toBe(true);
  });

  it('leaves the waking day alone, boundaries included', () => {
    expect(isQuietMinute(QUIET_END_MIN)).toBe(false);
    expect(isQuietMinute(QUIET_START_MIN - 1)).toBe(false);
    expect(isQuietMinute(12 * 60)).toBe(false);
  });
});

describe('scheduleFor', () => {
  it('leaves a message alone in the middle of the day', () => {
    const noon = fromISO('2026-09-17T02:00:00Z'); // 12:00 Melbourne
    expect(scheduleFor('new_plan', noon, MELBOURNE)).toBe(noon);
    expect(wasHeld('new_plan', noon, MELBOURNE)).toBe(false);
  });

  it('holds an evening message until the next morning', () => {
    const lateEvening = fromISO('2026-09-17T12:30:00Z'); // 22:30 Melbourne
    const held = scheduleFor('new_plan', lateEvening, MELBOURNE);
    expect(localOf(toISO(held))).toEqual({ date: '2026-09-18', minutesOfDay: QUIET_END_MIN });
  });

  it('holds an after-midnight message until the same morning, not the next', () => {
    const smallHours = fromISO('2026-09-16T16:00:00Z'); // 02:00 Melbourne on the 17th
    const held = scheduleFor('new_plan', smallHours, MELBOURNE);
    expect(localOf(toISO(held))).toEqual({ date: '2026-09-17', minutesOfDay: QUIET_END_MIN });
  });

  it('never moves a message earlier', () => {
    for (const hour of [0, 3, 7, 8, 12, 20, 21, 23]) {
      const desired = fromISO(`2026-09-17T${String(hour).padStart(2, '0')}:00:00Z`);
      expect(scheduleFor('new_plan', desired, MELBOURNE)).toBeGreaterThanOrEqual(desired);
    }
  });

  it('sends a locked-in and a cancellation straight through', () => {
    // Spec §5.8: quiet hours "except confirmed and cancelled". A plan that just
    // changed is news you need before you leave the house.
    const midnight = fromISO('2026-09-17T13:00:00Z'); // 23:00 Melbourne
    expect(scheduleFor('locked_in', midnight, MELBOURNE)).toBe(midnight);
    expect(scheduleFor('cancelled', midnight, MELBOURNE)).toBe(midnight);
    expect(scheduleFor('verify_email', midnight, MELBOURNE)).toBe(midnight);
  });

  it('holds a "changed" like everything else', () => {
    const midnight = fromISO('2026-09-17T13:00:00Z');
    expect(wasHeld('changed', midnight, MELBOURNE)).toBe(true);
  });

  it('is measured in the recipient zone, not the plan zone', () => {
    // 22:30 in Melbourne is 13:30 in London: the same instant is quiet for one
    // member and the middle of the afternoon for another.
    const instant = fromISO('2026-09-17T12:30:00Z');
    expect(wasHeld('new_plan', instant, MELBOURNE)).toBe(true);
    expect(wasHeld('new_plan', instant, LONDON)).toBe(false);
  });

  it('lands on 08:00 in a zone offset by three quarters of an hour', () => {
    // Kathmandu is UTC+05:45. Anything computed by rounding an epoch instant to
    // a whole hour arrives at 07:15 or 08:45 here.
    const nightThere = fromISO('2026-09-17T18:00:00Z'); // 23:45 Kathmandu
    const held = scheduleFor('new_plan', nightThere, KATHMANDU);
    expect(toLocal(held, KATHMANDU)).toEqual({ date: '2026-09-18', minutesOfDay: QUIET_END_MIN });
  });

  it('lands on the 08:00 people read on the day the clocks go forward', () => {
    // Melbourne springs forward at 02:00 on 4 October 2026: an hour disappears
    // between midnight and morning, so an offset-arithmetic answer is an hour out.
    const beforeTheJump = fromISO('2026-10-03T15:00:00Z'); // 02:00 local, 4 Oct
    const held = scheduleFor('new_plan', beforeTheJump, MELBOURNE);
    expect(toLocal(held, MELBOURNE)).toEqual({ date: '2026-10-04', minutesOfDay: QUIET_END_MIN });
  });

  it('lands on the 08:00 people read on the day the clocks go back', () => {
    // 5 April 2026: an hour repeats. 08:00 is still 08:00.
    const nightBefore = fromISO('2026-04-04T13:00:00Z'); // 00:00 local, 5 Apr (AEDT)
    const held = scheduleFor('new_plan', nightBefore, MELBOURNE);
    expect(toLocal(held, MELBOURNE)).toEqual({ date: '2026-04-05', minutesOfDay: QUIET_END_MIN });
  });

  it('is idempotent: scheduling an already-scheduled message changes nothing', () => {
    const lateEvening = fromISO('2026-09-17T12:30:00Z');
    const once = scheduleFor('new_plan', lateEvening, MELBOURNE);
    expect(scheduleFor('new_plan', once, MELBOURNE)).toBe(once);
  });
});
