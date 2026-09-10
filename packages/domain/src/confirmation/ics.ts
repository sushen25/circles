/**
 * The `.ics` a web participant downloads from the confirmed screen (spec §5.7).
 *
 * RFC 5545, and the parts of it that actually break calendars: CRLF line
 * endings, folding at 75 **octets** rather than 75 characters, `\` `;` `,` and
 * newlines escaped inside TEXT values, and a `DTSTAMP` on every event. A file
 * that is nearly right opens in one calendar and silently fails in another,
 * which is the worst outcome available — the person believes they have the
 * event.
 *
 * The product's name, link domain and sender live in `packages/config`
 * (architecture §5.4), which this package may not import, so they arrive as
 * arguments. Nothing here reads a clock: `DTSTAMP` is passed in, because two
 * calls with the same confirmation have to produce the same file.
 */

import { type Instant, toISO } from '../shared/instant.js';
import { isTokenFree } from './links.js';
import type { Confirmation } from './types.js';

/** RFC 5545 §3.1: lines are at most 75 octets, excluding the CRLF. */
const MAX_OCTETS = 75;
const CRLF = '\r\n';

const encoder = new TextEncoder();

export type IcsIdentity = {
  /** The link domain, for the `UID`'s right-hand side. From `brand.domain`. */
  readonly domain: string;
  /** `PRODID`, e.g. `-//Example//Meetups 1.0//EN`. Composed by the caller. */
  readonly prodId: string;
};

export type IcsInput = {
  readonly confirmation: Confirmation;
  readonly circleName: string;
  readonly title: string;
  readonly identity: IcsIdentity;
  /** `DTSTAMP` — when this file was produced. Passed, never read from a clock. */
  readonly stamp: Instant;
  /**
   * The plan's short link, which the description invites people to open.
   *
   * Must be a bare `http(s)` link with **no token**: the invite secret rides in
   * a URL fragment and action tokens ride in query strings (architecture §14),
   * and an `.ics` is forwarded, synced to other devices and indexed by desktop
   * search. Anything else throws rather than being quietly dropped — a silent
   * drop is how the check stops being a check.
   */
  readonly url?: string | undefined;
};

/** `2026-09-17T08:30:00.000Z` → `20260917T083000Z`. */
export function toIcsUtc(value: Instant): string {
  return toISO(value)
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * RFC 5545 §3.3.11. Backslash first, or the escapes escape each other.
 *
 * A carriage return is dropped rather than encoded: `\n` is the only line break
 * the format has, and `\r\n` in a note would otherwise become two.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '\\n');
}

/**
 * Fold one content line to 75 octets, continuation lines beginning with a
 * single space.
 *
 * Counted in octets and cut between characters: a multi-byte character split
 * across a fold is invalid UTF-8, and the calendar that receives it shows
 * mojibake or refuses the file. The leading space of a continuation counts
 * toward that line's 75.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_OCTETS) return line;

  const parts: string[] = [];
  let current = '';
  let octets = 0;
  let limit = MAX_OCTETS;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
      // Every line after the first spends one octet on its leading space.
      limit = MAX_OCTETS - 1;
    }
    current += char;
    octets += size;
  }
  parts.push(current);

  return parts.join(`${CRLF} `);
}

function property(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

function description(confirmation: Confirmation, url: string | undefined): string | undefined {
  const parts = [confirmation.note, confirmation.placeUrl, url].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  return parts.length === 0 ? undefined : parts.join('\n');
}

/** The `VEVENT` for a confirmation, wrapped in a complete `VCALENDAR`. */
export function icsFor(input: IcsInput): string {
  const { confirmation, circleName, title, identity, stamp, url } = input;

  if (url !== undefined && !isTokenFree(url)) {
    // The offending value is deliberately absent: an exception message reaches
    // a log, and a token in a log is the thing this check exists to prevent
    // (non-negotiable 8). The caller knows which URL it passed.
    throw new RangeError('ics: refusing to embed anything but a bare http(s) link');
  }

  const body = description(confirmation, url);

  const lines = [
    'BEGIN:VCALENDAR',
    property('VERSION', '2.0'),
    property('PRODID', identity.prodId),
    // The file is an announcement of a decision already made, not an invitation
    // that expects RSVPs back — replies live in the app (spec §5.7).
    property('METHOD', 'PUBLISH'),
    property('CALSCALE', 'GREGORIAN'),
    'BEGIN:VEVENT',
    property('UID', `${confirmation.id}@${identity.domain}`),
    property('DTSTAMP', toIcsUtc(stamp)),
    property('DTSTART', toIcsUtc(confirmation.candidate.start)),
    property('DTEND', toIcsUtc(confirmation.candidate.end)),
    property('SUMMARY', escapeText(`${circleName} · ${title}`)),
    ...(confirmation.placeName === undefined
      ? []
      : [property('LOCATION', escapeText(confirmation.placeName))]),
    ...(body === undefined ? [] : [property('DESCRIPTION', escapeText(body))]),
    property('STATUS', icsStatus(confirmation.status)),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // A trailing CRLF: the last line needs its terminator like any other.
  return `${lines.join(CRLF)}${CRLF}`;
}

/**
 * `STATUS` for a confirmation's own status.
 *
 * A **superseded** confirmation is cancelled as far as a calendar is concerned:
 * "Thursday is off the table" (spec §5.7), and a file exported for the old time
 * after a reschedule would otherwise import as a live event. Written as an
 * exhaustive map rather than "cancelled or else confirmed", so a fifth status
 * cannot arrive and quietly default to live. A **completed** meetup happened,
 * so it stays on the calendar as what it was.
 */
export function icsStatus(status: Confirmation['status']): 'CONFIRMED' | 'CANCELLED' {
  switch (status) {
    case 'active':
    case 'completed':
      return 'CONFIRMED';
    case 'superseded':
    case 'cancelled':
      return 'CANCELLED';
  }
}

/** The filename to offer the download as. ASCII only, for old browsers. */
export function icsFilename(circleName: string): string {
  const slug = circleName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug.length === 0 ? 'catch-up' : slug}.ics`;
}
