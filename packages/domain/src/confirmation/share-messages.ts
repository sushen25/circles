/**
 * The three messages a confirmation produces for the group chat
 * (ShareMessages artboard, spec §5.7).
 *
 * "Generated per state. The organiser never composes." That is the point: the
 * hardest part of telling six people a plan changed is writing the message, and
 * a product that leaves that to the organiser has not removed the work.
 *
 * These are whole sentences, which the rest of the domain deliberately avoids —
 * `availability/format` says so in as many words. They live here anyway because
 * the same sentence goes into the share sheet, an email and a push body, and
 * `apps/app/src/copy` cannot be imported by an Edge Function running on Deno.
 * One sentence in two places is one sentence that will drift. The wording is
 * exported as data so a second locale replaces it rather than reimplementing
 * this module.
 *
 * Dates are formatted by a **passed** formatter for the same reason `format.ts`
 * takes `hour12`: a domain that hard-codes "Thu 17 Sep" cannot be given another
 * language later.
 */

import { type TimeFormat, formatRange } from '../availability/format.js';
import type { Instant } from '../shared/instant.js';
import { type Zone, toLocal } from '../shared/zone.js';
import type { Confirmation } from './types.js';

/**
 * How dates are written. Both take an instant and the plan's zone, because a
 * confirmation is an instant and the chat reads it in the circle's local time.
 */
export type ShareDateFormat = {
  /** "Thu 17 Sep" — the date in a chat message. */
  readonly shortDate: (value: Instant, zone: Zone) => string;
  /** "Thursday" — the day on its own, when the sentence already has the date. */
  readonly weekday: (value: Instant, zone: Zone) => string;
  readonly time?: TimeFormat | undefined;
};

export type LockedInParts = {
  readonly circleName: string;
  readonly date: string;
  readonly time: string;
  readonly place?: string | undefined;
  readonly url: string;
};

export type ChangedParts = {
  readonly weekday: string;
  readonly url: string;
};

export type CancelledParts = {
  readonly circleName: string;
  readonly weekday: string;
  readonly note?: string | undefined;
  readonly url: string;
};

export type ShareTemplates = {
  readonly lockedIn: (parts: LockedInParts) => string;
  readonly changed: (parts: ChangedParts) => string;
  readonly cancelled: (parts: CancelledParts) => string;
};

/**
 * The artboard's wording.
 *
 * One deliberate difference: the artboard's "New times for the week after,
 * please" describes the *particular* new window the organiser picked. Any
 * generated version of that phrase would be wrong for a different window, and
 * the honest general sentence is "New times, please" — the link says which
 * ones. Naming the new window in the message is copy work for the client, which
 * knows the preset that was chosen.
 */
export const EN_SHARE_TEMPLATES: ShareTemplates = {
  lockedIn: ({ circleName, date, time, place, url }) =>
    `Locked in: ${circleName}, ${date}, ${time}${place === undefined ? '' : ` at ${place}`}. ` +
    `Details and add-to-calendar: ${url}`,

  changed: ({ weekday, url }) => `Change of plan: ${weekday} is off. New times, please: ${url}`,

  cancelled: ({ circleName, weekday, note, url }) =>
    `Update: ${weekday}'s ${circleName} catch-up is off. ${note === undefined ? '' : `${note} `}${url}`,
};

export type ShareInput = {
  readonly confirmation: Confirmation;
  readonly circleName: string;
  readonly zone: Zone;
  /** The plan's short link. Carries no secret (architecture §5.2). */
  readonly url: string;
  readonly format: ShareDateFormat;
  readonly templates?: ShareTemplates | undefined;
};

function timeRange(confirmation: Confirmation, zone: Zone, format?: TimeFormat): string {
  const start = toLocal(confirmation.candidate.start, zone);
  const end = toLocal(confirmation.candidate.end, zone);
  // Minutes since midnight, so an event ending at midnight reads 12 am rather
  // than wrapping to 0 and printing a range that runs backwards.
  const endMin = end.date === start.date ? end.minutesOfDay : end.minutesOfDay + 24 * 60;
  return formatRange(start.minutesOfDay, endMin, format);
}

/** "Locked in: Sunday Crew, Thu 17 Sep, 6:30–8:30 pm at Hope St Radio. …" */
export function lockedInMessage(input: ShareInput): string {
  const { confirmation, circleName, zone, url, format } = input;
  const templates = input.templates ?? EN_SHARE_TEMPLATES;
  return templates.lockedIn({
    circleName,
    date: format.shortDate(confirmation.candidate.start, zone),
    time: timeRange(confirmation, zone, format.time),
    place: confirmation.placeName,
    url,
  });
}

/** "Change of plan: Thursday is off. New times, please: …" */
export function changedMessage(input: ShareInput): string {
  const { confirmation, zone, url, format } = input;
  const templates = input.templates ?? EN_SHARE_TEMPLATES;
  return templates.changed({
    weekday: format.weekday(confirmation.candidate.start, zone),
    url,
  });
}

/**
 * "Update: Thursday's Sunday Crew catch-up is off. Sorry all, will try again in
 * October. …"
 *
 * The note is the organiser's own from the CancelPlan screen and is optional;
 * without it the sentence still stands on its own, because "is off" with no
 * explanation is a complete and kind message.
 */
export function cancelledMessage(
  input: ShareInput & { readonly note?: string | undefined },
): string {
  const { confirmation, circleName, zone, url, format, note } = input;
  const templates = input.templates ?? EN_SHARE_TEMPLATES;
  return templates.cancelled({
    circleName,
    weekday: format.weekday(confirmation.candidate.start, zone),
    note,
    url,
  });
}
