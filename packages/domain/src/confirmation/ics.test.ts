import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';

import { fromISO } from '../shared/instant.js';
import { confirmation } from './fixtures.js';
import { escapeText, foldLine, icsFilename, icsFor, isTokenFree, toIcsUtc } from './ics.js';
import type { IcsInput } from './ics.js';

const IDENTITY = { domain: 'example.com', prodId: '-//Example//Meetups 1.0//EN' };
const STAMP = fromISO('2026-09-14T09:00:00Z');

const encoder = new TextEncoder();

function build(overrides: Partial<IcsInput> = {}): string {
  return icsFor({
    confirmation: confirmation(),
    circleName: 'Sunday Crew',
    title: 'Catch up',
    identity: IDENTITY,
    stamp: STAMP,
    ...overrides,
  });
}

/** Unfold before assertion: a folded line is still one logical line. */
function unfold(text: string): string {
  return text.replace(/\r\n /g, '');
}

/** The one event in the file, as `ical.js` reads it back. */
function parseEvent(text: string): ICAL.Event {
  const vevent = new ICAL.Component(ICAL.parse(text)).getFirstSubcomponent('vevent');
  if (vevent === null) throw new Error('no VEVENT in the file');
  return new ICAL.Event(vevent);
}

describe('icsFor', () => {
  const text = build();

  it('parses as a calendar with one event', () => {
    const component = new ICAL.Component(ICAL.parse(text));
    expect(component.name).toBe('vcalendar');
    expect(component.getAllSubcomponents('vevent')).toHaveLength(1);
    expect(component.getFirstPropertyValue('method')).toBe('PUBLISH');
    expect(component.getFirstPropertyValue('version')).toBe('2.0');
  });

  it('gives the parser back the times it was given', () => {
    const event = parseEvent(text);
    expect(event.startDate.toJSDate().toISOString()).toBe('2026-09-17T08:30:00.000Z');
    expect(event.endDate.toJSDate().toISOString()).toBe('2026-09-17T10:30:00.000Z');
    expect(event.summary).toBe('Sunday Crew · Catch up');
    expect(event.location).toBe('Hope St Radio');
    expect(event.uid).toBe(`${confirmation().id}@example.com`);
  });

  it('every line ends CRLF, including the last', () => {
    expect(text.endsWith('\r\n')).toBe(true);
    expect(
      text
        .split('\r\n')
        .slice(0, -1)
        .every((line) => !line.endsWith('\r')),
    ).toBe(true);
    // No bare LF anywhere: a lone \n breaks strict parsers.
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('never writes a line longer than 75 octets', () => {
    const long = build({
      confirmation: confirmation({
        note: 'Table is booked under my name; come hungry, and bring cash for the wine, please.',
      }),
    });
    for (const line of long.split('\r\n')) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    // …and folding did not lose anything.
    const event = parseEvent(long);
    expect(event.description).toContain('come hungry, and bring cash for the wine');
  });

  it('escapes a note containing a semicolon and a comma', () => {
    const text = build({
      confirmation: confirmation({ note: 'Booked; come hungry, all of you' }),
    });
    expect(unfold(text)).toContain('DESCRIPTION:Booked\\; come hungry\\, all of you');
    const event = parseEvent(text);
    // The parser gives the original back, which is the whole point of escaping.
    expect(event.description).toBe('Booked; come hungry, all of you');
  });

  it('folds without splitting a multi-byte character', () => {
    // Each of these is three octets, so the fold cannot land on a byte boundary
    // that is also a character boundary by luck.
    const note = '→'.repeat(60);
    const text = build({ confirmation: confirmation({ note }) });
    for (const line of text.split('\r\n')) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    const event = parseEvent(text);
    expect(event.description).toBe(note);
  });

  it('carries no place line when there is no place', () => {
    const text = build({ confirmation: confirmation({ placeName: undefined }) });
    expect(text).not.toContain('LOCATION');
  });

  it('marks a cancelled confirmation as cancelled, so the calendar entry greys out', () => {
    expect(build({ confirmation: confirmation({ status: 'cancelled' }) })).toContain(
      'STATUS:CANCELLED',
    );
    expect(build()).toContain('STATUS:CONFIRMED');
  });

  it('is the same file twice for the same confirmation', () => {
    expect(build()).toBe(build());
  });

  it('refuses to embed a link carrying a token, rather than quietly dropping it', () => {
    expect(() => build({ url: 'https://example.com/j/7f3k#secret' })).toThrow(RangeError);
    expect(() => build({ url: 'https://example.com/p/8k2v?token=abc' })).toThrow(RangeError);
    expect(() => build({ url: 'https://example.com/p/8k2v' })).not.toThrow();
    expect(unfold(build({ url: 'https://example.com/p/8k2v' }))).toContain(
      'https://example.com/p/8k2v',
    );
  });
});

describe('isTokenFree', () => {
  it('is false for anything carrying a query or a fragment', () => {
    expect(isTokenFree('https://example.com/p/8k2v')).toBe(true);
    expect(isTokenFree('https://example.com/p/8k2v?x=1')).toBe(false);
    expect(isTokenFree('https://example.com/join#7f3k')).toBe(false);
    expect(isTokenFree('not a url')).toBe(false);
  });
});

describe('toIcsUtc', () => {
  it('is a basic-format UTC stamp', () => {
    expect(toIcsUtc(fromISO('2026-09-17T08:30:00Z'))).toBe('20260917T083000Z');
    expect(toIcsUtc(fromISO('2026-01-01T00:00:00Z'))).toBe('20260101T000000Z');
  });
});

describe('escapeText', () => {
  it('escapes the backslash first, so the escapes do not escape each other', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b');
    expect(escapeText('a\\,b')).toBe('a\\\\\\,b');
  });

  it('turns every kind of line break into a single \\n', () => {
    expect(escapeText('a\r\nb')).toBe('a\\nb');
    expect(escapeText('a\nb')).toBe('a\\nb');
    expect(escapeText('a\rb')).toBe('a\\nb');
  });
});

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('leaves a line of exactly 75 octets alone', () => {
    const line = 'X'.repeat(75);
    expect(foldLine(line)).toBe(line);
    expect(foldLine('X'.repeat(76))).toContain('\r\n ');
  });

  it('unfolds back to what it was given', () => {
    const line = `DESCRIPTION:${'word '.repeat(40)}`;
    expect(unfold(foldLine(line))).toBe(line);
  });
});

describe('icsFilename', () => {
  it('is a slug of the circle name', () => {
    expect(icsFilename('Sunday Crew')).toBe('sunday-crew.ics');
    expect(icsFilename("Jess & Tom's")).toBe('jess-tom-s.ics');
  });

  it('falls back rather than producing a nameless file', () => {
    expect(icsFilename('☕')).toBe('catch-up.ics');
    expect(icsFilename('')).toBe('catch-up.ics');
  });
});
