import { describe, expect, it } from 'vitest';

import { type Instant, fromISO, toISO } from '../shared/instant.js';
import { localDate } from '../shared/local-date.js';
import { toLocal } from '../shared/zone.js';
import { MELBOURNE } from '../shared/fixtures.js';
import {
  clampDeadline,
  defaultDeadline,
  extendDeadline,
  isDeadlineAllowed,
  lastPossibleStart,
} from './deadline.js';
import { plan } from './fixtures.js';

describe('lastPossibleStart', () => {
  it('leaves room for the whole meetup before the band closes', () => {
    // Band ends 22:30, duration 120 → the last start is 20:30 on the last day.
    const latest = lastPossibleStart(plan());
    const local = toLocal(latest, MELBOURNE);
    expect(local.date).toBe('2026-09-20');
    expect(local.minutesOfDay).toBe(20 * 60 + 30);
  });

  it('moves with the duration', () => {
    const local = toLocal(lastPossibleStart(plan({ durationMinutes: 180 })), MELBOURNE);
    expect(local.minutesOfDay).toBe(19 * 60 + 30);
  });

  it('is a local time, so it survives a daylight-saving change', () => {
    // Melbourne moves to daylight time on Sunday 4 October 2026. A window
    // ending that day still ends at 20:30 local, not 19:30.
    const across = plan({
      window: { start: localDate('2026-10-02'), end: localDate('2026-10-04') },
    });
    expect(toLocal(lastPossibleStart(across), MELBOURNE).minutesOfDay).toBe(20 * 60 + 30);
    // …which is an hour earlier in UTC than the same wall time in September.
    expect(toISO(lastPossibleStart(across))).toBe('2026-10-04T09:30:00.000Z');
  });

  it('does not go before the band opens when the meetup will not fit', () => {
    const impossible = plan({
      durationMinutes: 180,
      daily: { startMin: 20 * 60, endMin: 21 * 60 },
    });
    const local = toLocal(lastPossibleStart(impossible), MELBOURNE);
    expect(local.minutesOfDay).toBe(20 * 60);
  });
});

describe('defaultDeadline', () => {
  const latest = fromISO('2026-09-20T10:30:00Z'); // 20:30 Melbourne on the last day

  it('gives this weekend and next 7 days a day', () => {
    const created = fromISO('2026-09-17T08:00:00Z');
    for (const preset of ['this_weekend', 'next_7_days'] as const) {
      expect(toISO(defaultDeadline(preset, created, latest))).toBe('2026-09-18T08:00:00.000Z');
    }
  });

  it('gives a fortnight three days', () => {
    const created = fromISO('2026-09-01T08:00:00Z');
    const far = fromISO('2026-09-14T10:30:00Z');
    expect(toISO(defaultDeadline('next_14_days', created, far))).toBe('2026-09-04T08:00:00.000Z');
  });

  it('never runs past the last possible start, however long the default is', () => {
    const created = fromISO('2026-09-20T09:00:00Z'); // 90 min before the last start
    expect(defaultDeadline('next_14_days', created, latest)).toBe(latest);
    expect(defaultDeadline('this_weekend', created, latest)).toBe(latest);
  });

  describe('tonight', () => {
    it('is an hour from now when there is plenty of evening left', () => {
      const created = fromISO('2026-09-17T08:00:00Z'); // 18:00 Melbourne
      const tonightLatest = fromISO('2026-09-17T13:30:00Z'); // 23:30 local
      expect(toISO(defaultDeadline('tonight', created, tonightLatest))).toBe(
        '2026-09-17T09:00:00.000Z',
      );
    });

    it('is half an hour before the last start when the evening is nearly gone', () => {
      // Created 22:50; the last start is 23:00. An hour from now is too late.
      const created = fromISO('2026-09-17T12:50:00Z');
      const tonightLatest = fromISO('2026-09-17T13:00:00Z');
      expect(toISO(defaultDeadline('tonight', created, tonightLatest))).toBe(
        '2026-09-17T12:30:00.000Z',
      );
    });
  });
});

describe('clampDeadline', () => {
  const latest = fromISO('2026-09-20T10:30:00Z');

  it('caps a deadline past the last possible start', () => {
    expect(clampDeadline(fromISO('2026-09-21T00:00:00Z'), latest)).toBe(latest);
  });

  it('leaves an earlier deadline alone', () => {
    const earlier = fromISO('2026-09-18T00:00:00Z');
    expect(clampDeadline(earlier, latest)).toBe(earlier);
  });
});

describe('isDeadlineAllowed', () => {
  const latest = fromISO('2026-09-20T10:30:00Z');

  it('allows exactly the last possible start', () => {
    expect(isDeadlineAllowed(latest, latest)).toBe(true);
  });

  it('refuses a minute later', () => {
    expect(isDeadlineAllowed((latest + 60_000) as Instant, latest)).toBe(false);
  });
});

describe('extendDeadline', () => {
  const latest = fromISO('2026-09-20T10:30:00Z');

  it('gives it one more day', () => {
    expect(toISO(extendDeadline(fromISO('2026-09-18T00:00:00Z'), latest))).toBe(
      '2026-09-19T00:00:00.000Z',
    );
  });

  it('never extends a plan past the point it could still happen', () => {
    expect(extendDeadline(fromISO('2026-09-20T00:00:00Z'), latest)).toBe(latest);
  });
});
