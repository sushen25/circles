import { describe, expect, it } from 'vitest';

import { MELBOURNE } from '../shared/fixtures.js';
import { fromISO } from '../shared/instant.js';
import { EN_FORMAT, confirmation } from './fixtures.js';
import {
  EN_SHARE_TEMPLATES,
  type ShareInput,
  cancelledMessage,
  changedMessage,
  lockedInMessage,
} from './share-messages.js';

const LINK = 'example.com/p/8k2v';

function input(overrides: Partial<ShareInput> = {}): ShareInput {
  return {
    confirmation: confirmation(),
    circleName: 'Sunday Crew',
    zone: MELBOURNE,
    url: LINK,
    format: EN_FORMAT,
    ...overrides,
  };
}

describe('lockedInMessage', () => {
  it('is the ShareMessages artboard, word for word', () => {
    expect(lockedInMessage(input())).toBe(
      'Locked in: Sunday Crew, Thu 17 Sep, 6:30–8:30 pm at Hope St Radio. ' +
        `Details and add-to-calendar: ${LINK}`,
    );
  });

  it('reads properly when there is no place yet', () => {
    const noPlace = confirmation({ placeName: undefined });
    expect(lockedInMessage(input({ confirmation: noPlace }))).toBe(
      `Locked in: Sunday Crew, Thu 17 Sep, 6:30–8:30 pm. Details and add-to-calendar: ${LINK}`,
    );
  });

  it('writes the time in the circle zone, not in UTC', () => {
    // The confirmation is 08:30Z. Anyone reading the chat in Melbourne sees the
    // evening they agreed to.
    expect(lockedInMessage(input())).toContain('6:30–8:30 pm');
    expect(lockedInMessage(input())).not.toContain('8:30–10:30 am');
  });

  it('does not repeat the meridiem when both ends share it', () => {
    expect(lockedInMessage(input())).not.toContain('6:30 pm–8:30 pm');
  });

  it('writes a meetup running to midnight as 12 am rather than wrapping backwards', () => {
    const lateNight = confirmation({
      candidate: {
        start: fromISO('2026-09-17T12:00:00Z'), // 22:00 Melbourne
        end: fromISO('2026-09-17T14:00:00Z'), // midnight
        availableUserIds: [],
      },
    });
    // 1440 minutes, not 0: a midnight end wrapped to zero would print a range
    // running backwards.
    expect(lockedInMessage(input({ confirmation: lateNight }))).toContain('10 pm–12 am');
  });
});

describe('changedMessage', () => {
  it('names the day that is off, and asks for new times', () => {
    expect(changedMessage(input())).toBe(
      `Change of plan: Thursday is off. New times, please: ${LINK}`,
    );
  });
});

describe('cancelledMessage', () => {
  it('carries the organiser note from the CancelPlan screen', () => {
    expect(cancelledMessage({ ...input(), note: 'Sorry all, will try again in October.' })).toBe(
      "Update: Thursday's Sunday Crew catch-up is off. Sorry all, will try again in October. " +
        LINK,
    );
  });

  it('stands on its own with no note, and does not leave a double space', () => {
    const text = cancelledMessage(input());
    expect(text).toBe(`Update: Thursday's Sunday Crew catch-up is off. ${LINK}`);
    expect(text).not.toContain('  ');
  });
});

describe('the wording is replaceable', () => {
  it('takes a different set of templates without touching the assembly', () => {
    const templates = {
      ...EN_SHARE_TEMPLATES,
      changed: ({ weekday, url }: { weekday: string; url: string }) =>
        `${weekday} tombé à l'eau. Nouvelles disponibilités : ${url}`,
    };
    expect(changedMessage({ ...input(), templates })).toBe(
      `Thursday tombé à l'eau. Nouvelles disponibilités : ${LINK}`,
    );
  });

  it('formats dates through the formatter it was given, not one of its own', () => {
    const iso = {
      shortDate: (value: number) => new Date(value).toISOString().slice(0, 10),
      weekday: () => 'day four',
    };
    expect(lockedInMessage(input({ format: iso }))).toContain('2026-09-17');
    expect(changedMessage(input({ format: iso }))).toContain('day four is off');
  });
});
