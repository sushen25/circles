import { describe, expect, it } from 'vitest';

import { MELBOURNE } from '../shared/fixtures.js';
import { fromISO } from '../shared/instant.js';
import { EN_FORMAT, confirmation } from '../confirmation/fixtures.js';
import {
  EN_SHARE_TEMPLATES,
  type ShareInput,
  cancelledMessage,
  changedMessage,
  inviteMessage,
  lockedInMessage,
  newPlanMessage,
  waitingMessage,
  withoutLink,
} from './share-messages.js';

const LINK = 'example.com/p/8k2v';

function input(overrides: Partial<ShareInput> = {}): ShareInput {
  return {
    confirmation: confirmation(),
    circleName: 'Sunday Crew',
    zone: MELBOURNE,
    url: LINK,
    format: EN_FORMAT,
    templates: EN_SHARE_TEMPLATES,
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

  it('asks for new times after an edit, when there was no day to call off', () => {
    expect(EN_SHARE_TEMPLATES.changed({ url: LINK })).toBe(
      `Change of plan. New times, please: ${LINK}`,
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

  it('names no day for a plan that was never locked in', () => {
    // Cancelled while it was still asking: there is no Thursday to call off.
    expect(
      EN_SHARE_TEMPLATES.cancelled({ circleName: 'Sunday Crew', note: 'Next month.', url: LINK }),
    ).toBe(`Update: Sunday Crew's catch-up is off. Next month. ${LINK}`);
  });
});

describe("the wording is the caller's", () => {
  it('has no default: a caller cannot get English by forgetting', () => {
    // The type is the enforcement — `templates` is required, so the client
    // passes ones built from its copy keys and the email templates pass their
    // own. Non-negotiable 6 has no other reach into a package `apps/app` does
    // not own.
    // @ts-expect-error `templates` is required, which is the point of this test.
    expect(() => lockedInMessage({ ...input(), templates: undefined })).toThrow();
  });

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

describe('inviteMessage', () => {
  it('is the artboard, word for word', () => {
    expect(
      inviteMessage({ circleName: 'Sunday Crew', url: LINK, templates: EN_SHARE_TEMPLATES }),
    ).toBe(
      'Made a Sunday Crew circle so we stop losing catch-ups in the chat. ' +
        `Join here, no app needed: ${LINK}`,
    );
  });
});

describe('newPlanMessage', () => {
  const base = { circleName: 'Sunday Crew', url: LINK, templates: EN_SHARE_TEMPLATES };

  it('is the artboard when the window is described', () => {
    expect(newPlanMessage({ ...base, windowPhrase: 'in the next two weeks' })).toBe(
      "When can Sunday Crew actually catch up? Mark the times you'd be up for " +
        `in the next two weeks. Takes a minute: ${LINK}`,
    );
  });

  it('still reads as a sentence without one', () => {
    // The artboard's phrase describes one particular fortnight. Generating it
    // would be wrong for any other window, so it is the client's to supply.
    expect(newPlanMessage(base)).toBe(
      "When can Sunday Crew actually catch up? Mark the times you'd be up for. " +
        `Takes a minute: ${LINK}`,
    );
  });
});

describe('waitingMessage', () => {
  it('is the artboard, word for word', () => {
    expect(waitingMessage({ remaining: 4, url: LINK, templates: EN_SHARE_TEMPLATES })).toBe(
      `We're waiting on 4 replies before picking a time: ${LINK}`,
    );
  });

  it('says "reply" when there is one left', () => {
    expect(waitingMessage({ remaining: 1, url: LINK, templates: EN_SHARE_TEMPLATES })).toContain(
      'on 1 reply before',
    );
  });

  it('counts, and never names', () => {
    // Pasted into a chat everyone reads. Naming the four who have not replied
    // is a nudge with an audience.
    const text = waitingMessage({ remaining: 4, url: LINK, templates: EN_SHARE_TEMPLATES });
    for (const name of ['Alex', 'Priya', 'Tom', 'Jess', 'Sam', 'Nic']) {
      expect(text).not.toContain(name);
    }
  });
});

describe('a message with its link taken off, for a screen that draws the link', () => {
  it('leaves the sentence and takes the separator with it', () => {
    const url = 'https://circles.test/j/abcdefgh';
    const message = newPlanMessage({
      circleName: 'Sunday Crew',
      windowPhrase: 'in the next two weeks',
      url,
      templates: EN_SHARE_TEMPLATES,
    });
    expect(message).toContain(url);
    const shown = withoutLink(message, url);
    expect(shown).not.toContain(url);
    expect(shown).toBe(
      "When can Sunday Crew actually catch up? Mark the times you'd be up for in the next two weeks. Takes a minute",
    );
  });

  it('leaves a message that never had the link alone', () => {
    expect(withoutLink('No link here.', 'https://circles.test/j/abcdefgh')).toBe('No link here.');
  });
});
