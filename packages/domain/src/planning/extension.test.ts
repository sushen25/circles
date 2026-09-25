import { describe, expect, it } from 'vitest';

import { type Instant, addMinutes, fromISO, toISO } from '../shared/instant.js';
import { isErr, isOk } from '../shared/result.js';
import { EXTENSION_MARGIN_MINUTES, extensionCutoff, oneMoreDay } from './extension.js';

/** Sunday 20 September, 8:30 pm Melbourne: Sunday Crew's last possible start. */
const LATEST = fromISO('2026-09-20T10:30:00Z');
/** Tuesday 15 September, 6 pm Melbourne: when replies closed. */
const CLOSED = fromISO('2026-09-15T08:00:00Z');

const value = (result: ReturnType<typeof oneMoreDay>): string | undefined =>
  isOk(result) ? toISO(result.value) : undefined;

describe('oneMoreDay', () => {
  it('gives a day from now when the deadline has already gone', () => {
    // Opened two hours after replies closed: a day from the deadline would be
    // twenty-two hours, and "one more day" should mean one.
    const now = addMinutes(CLOSED, 120);
    expect(
      value(oneMoreDay({ current: CLOSED, latestStart: LATEST, now, alreadyExtended: false })),
    ).toBe('2026-09-16T10:00:00.000Z');
  });

  it('gives a day from the deadline when that is still ahead', () => {
    const now = addMinutes(CLOSED, -60);
    expect(
      value(oneMoreDay({ current: CLOSED, latestStart: LATEST, now, alreadyExtended: false })),
    ).toBe('2026-09-16T08:00:00.000Z');
  });

  it(`never runs later than ${EXTENSION_MARGIN_MINUTES} minutes before the last possible start`, () => {
    // Sweep a day's worth of moments up to the last start: whatever the clock
    // says, the answer is never past the cut-off.
    const cutoff = extensionCutoff(LATEST);
    for (let minutes = -48 * 60; minutes < 0; minutes += 17) {
      const now = addMinutes(LATEST, minutes);
      const current = addMinutes(now, -5) as Instant;
      const result = oneMoreDay({ current, latestStart: LATEST, now, alreadyExtended: false });
      if (isOk(result)) expect(result.value <= cutoff, toISO(now)).toBe(true);
    }
    const late = addMinutes(LATEST, -10 * 60);
    expect(
      value(oneMoreDay({ current: late, latestStart: LATEST, now: late, alreadyExtended: false })),
    ).toBe(toISO(cutoff));
  });

  it('refuses a second extension', () => {
    const result = oneMoreDay({
      current: CLOSED,
      latestStart: LATEST,
      now: CLOSED,
      alreadyExtended: true,
    });
    expect(isErr(result) && result.error).toBe('already_extended');
  });

  it('says so when there is nothing left to extend into (ADR 0010)', () => {
    // A tonight deadline may sit at the last possible start itself; the
    // cut-off is then before it, and a button would do nothing.
    const atLatest = oneMoreDay({
      current: LATEST,
      latestStart: LATEST,
      now: LATEST,
      alreadyExtended: false,
    });
    expect(isErr(atLatest) && atLatest.error).toBe('no_time_to_extend');
    // And inside the margin, with the deadline behind it.
    const inside = addMinutes(LATEST, -20);
    const late = oneMoreDay({
      current: addMinutes(inside, -60),
      latestStart: LATEST,
      now: inside,
      alreadyExtended: false,
    });
    expect(isErr(late) && late.error).toBe('no_time_to_extend');
  });
});
