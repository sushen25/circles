/**
 * The messages the organiser pastes into the group chat (ShareMessages
 * artboard, spec §5.8).
 *
 * "Generated per state. The organiser never composes." That is the point: the
 * hardest part of telling six people a plan changed is writing the message, and
 * a product that leaves that to the organiser has not removed the work.
 *
 * These are whole sentences, which the rest of the domain deliberately avoids —
 * `availability/format` says so in as many words. What lives here is the
 * *assembly*: which parts go in what order, the time in the circle's zone, the
 * note that may or may not be there. The wording itself is an argument, and
 * there is **no default** — a caller that forgets to pass one does not get
 * English, it gets a type error, which is the only version of non-negotiable 6
 * that a package outside `apps/app` can enforce.
 *
 * `EN_SHARE_TEMPLATES` is the artboard's wording, exported so that the client's
 * copy layer and the email templates read the same sentence. S1-05 left where
 * it should finally live as an open question and this is the answer: here. The
 * templates run on Deno and cannot import `apps/app/src/copy`; the app cannot
 * import a Deno function; the domain is the one place both already depend on,
 * and one sentence in two places is one sentence that will drift.
 *
 * Dates are formatted by a **passed** formatter for the same reason `format.ts`
 * takes `hour12`: a domain that hard-codes "Thu 17 Sep" cannot be given another
 * language later.
 */

import { type TimeFormat, formatRange } from '../availability/format.js';
import type { Instant } from '../shared/instant.js';
import { type Zone, toLocal } from '../shared/zone.js';
import type { Confirmation } from '../confirmation/types.js';

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

export type InviteParts = {
  readonly circleName: string;
  readonly url: string;
};

export type NewPlanParts = {
  readonly circleName: string;
  /**
   * "in the next two weeks" — the window the organiser chose, in words.
   *
   * Optional, and supplied rather than derived: the artboard's phrase describes
   * one particular fortnight, and a generated version would be wrong for any
   * other window. The client knows which preset was picked; the sentence still
   * stands without it.
   */
  readonly windowPhrase?: string | undefined;
  readonly url: string;
};

export type WaitingParts = {
  readonly remaining: number;
  readonly url: string;
};

export type LockedInParts = {
  readonly circleName: string;
  readonly date: string;
  readonly time: string;
  readonly place?: string | undefined;
  readonly url: string;
};

export type ChangedParts = {
  /**
   * The day that is off, after "Change the time". Absent for an edit to a plan
   * that was never locked in: the question changed, and there is no day to
   * name.
   */
  readonly weekday?: string | undefined;
  readonly url: string;
};

export type CancelledParts = {
  readonly circleName: string;
  /**
   * The day that is off, when there was one. A plan cancelled while it was
   * still asking was never on a day, so there is nothing to name: "Sunday
   * Crew's catch-up is off", as the cancellation email says it, rather than a
   * weekday somebody would have to invent.
   */
  readonly weekday?: string | undefined;
  readonly note?: string | undefined;
  readonly url: string;
};

export type ShareTemplates = {
  readonly invite: (parts: InviteParts) => string;
  readonly newPlan: (parts: NewPlanParts) => string;
  readonly waiting: (parts: WaitingParts) => string;
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
  invite: ({ circleName, url }) =>
    `Made a ${circleName} circle so we stop losing catch-ups in the chat. ` +
    `Join here, no app needed: ${url}`,

  newPlan: ({ circleName, windowPhrase, url }) =>
    `When can ${circleName} actually catch up? Mark the times you'd be up for` +
    `${windowPhrase === undefined ? '' : ` ${windowPhrase}`}. Takes a minute: ${url}`,

  waiting: ({ remaining, url }) =>
    `We're waiting on ${remaining} ${remaining === 1 ? 'reply' : 'replies'} ` +
    `before picking a time: ${url}`,

  lockedIn: ({ circleName, date, time, place, url }) =>
    `Locked in: ${circleName}, ${date}, ${time}${place === undefined ? '' : ` at ${place}`}. ` +
    `Details and add-to-calendar: ${url}`,

  changed: ({ weekday, url }) =>
    weekday === undefined
      ? `Change of plan. New times, please: ${url}`
      : `Change of plan: ${weekday} is off. New times, please: ${url}`,

  cancelled: ({ circleName, weekday, note, url }) =>
    `Update: ${weekday === undefined ? `${circleName}'s` : `${weekday}'s ${circleName}`} ` +
    `catch-up is off. ${note === undefined ? '' : `${note} `}${url}`,
};

/** What every message needs: where to send people, and in whose words. */
export type ShareBase = {
  readonly url: string;
  readonly templates: ShareTemplates;
};

/** "Made a Sunday Crew circle so we stop losing catch-ups in the chat. …" */
export function inviteMessage(input: ShareBase & { readonly circleName: string }): string {
  return input.templates.invite({ circleName: input.circleName, url: input.url });
}

/** "When can Sunday Crew actually catch up? …" */
export function newPlanMessage(
  input: ShareBase & { readonly circleName: string; readonly windowPhrase?: string | undefined },
): string {
  return input.templates.newPlan({
    circleName: input.circleName,
    windowPhrase: input.windowPhrase,
    url: input.url,
  });
}

/**
 * The same message with its link taken off, for a screen that draws the link
 * itself.
 *
 * A chat shows the sentence and then draws a card from the URL inside it, so a
 * share screen that repeated the raw URL under the message would be showing the
 * organiser something no chat will. The message that is *sent* is unchanged —
 * the link has to be in it, or there is nothing for the chat to unfurl — and
 * this is only how it is displayed.
 *
 * Here rather than in the screen because the separator is part of the wording:
 * `newPlan` ends "Takes a minute: <url>", and a screen slicing that apart would
 * be a second place that knows the sentence's shape.
 */
export function withoutLink(message: string, url: string): string {
  return message.replace(url, '').replace(/[\s:]+$/u, '');
}

/**
 * "We're waiting on 4 replies before picking a time: …"
 *
 * A count, never names: the waiting screen shows who has answered to the
 * circle, but a message pasted into a chat is read by everyone and naming the
 * four who have not replied is a nudge with an audience.
 */
export function waitingMessage(input: ShareBase & { readonly remaining: number }): string {
  return input.templates.waiting({ remaining: input.remaining, url: input.url });
}

export type ShareInput = {
  readonly confirmation: Confirmation;
  readonly circleName: string;
  readonly zone: Zone;
  /** The plan's short link. Carries no secret (architecture §5.2). */
  readonly url: string;
  readonly format: ShareDateFormat;
  /** Required. See the note at the top: there is no default wording. */
  readonly templates: ShareTemplates;
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
  const { confirmation, circleName, zone, url, format, templates } = input;
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
  const { confirmation, zone, url, format, templates } = input;
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
  const { confirmation, circleName, zone, url, format, templates, note } = input;
  return templates.cancelled({
    circleName,
    weekday: format.weekday(confirmation.candidate.start, zone),
    note,
    url,
  });
}
