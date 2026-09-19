import { brand } from '@circles/config';

/**
 * Every sentence an email says, in English (non-negotiable 6's intent, for the
 * one surface that cannot import `apps/app/src/copy`).
 *
 * **Here, beside the templates, rather than in a shared copy package.** An
 * Edge Function cannot import the app, and moving the app's copy into a package
 * both would share renames something every client ticket imports — so that is
 * left for a ticket that owns the client. What *is* shared is shared from where
 * it already lives: the chat messages and the link preview are
 * `EN_SHARE_TEMPLATES` / `EN_PREVIEW_TEMPLATES` in `@circles/domain`. No email
 * is a chat message — an email is read by one person, a chat message by the
 * whole circle — so none of these reuses one.
 *
 * Three rules hold for every line below, and `render.test.ts` checks the first
 * two against every kind:
 *
 * - **A subject names nobody but the circle** (spec §5.8). The organiser's name
 *   appears in a body only to attribute their own note, as the artboard does.
 * - **No subject or body says anything about a quiet ask** — who started it,
 *   who is keen. None of the kinds that could (`QUIET_SENSITIVE_KINDS`) is ever
 *   emailed.
 * - **Nothing here sells anything.** "Operational only" is the Emails artboard's
 *   own caption, and the manifesto's list of things we never do includes "a
 *   prompt inside an operational email". So no email mentions the app.
 *
 * The verification, locked-in and reminder emails are the Emails artboard's
 * words. The others take their wording from the Pushes artboard's row for the
 * same kind, which is what the person would otherwise have received. Two kinds
 * have no row on either artboard and are written here for the first time:
 * `replies_closed` and `did_it_happen_participant` (SUS-22's note).
 */

export type Button = { readonly label: string };

export type Paragraphs = readonly string[];

/** One email's words, with the dates already written out by the caller. */
export type EmailCopy = {
  readonly subject: string;
  /** The inbox preview line — the artboard's grey line under each subject. */
  readonly preview: string;
  /** A date shown large, in the display face. Only the locked-in email has one. */
  readonly headline?: string | undefined;
  readonly paragraphs: Paragraphs;
  readonly button: Button;
};

const quoted = (note: string, by: string | undefined) =>
  by === undefined ? `“${note}”` : `${by} says: “${note}”`;

export const EN_EMAIL = {
  verify: ({ circleName }: { circleName: string }): EmailCopy => ({
    subject: `Turn on updates for ${circleName}'s catch-up`,
    preview: 'One tap. Works for 24 hours.',
    paragraphs: [
      'Tap below to get the confirmed time, changes and one reminder for this meetup by email. ' +
        "If this wasn't you, ignore it and nothing happens.",
    ],
    button: { label: 'Turn on updates' },
  }),

  /** The small line under the verification button. */
  verifyFootnote: "This is the only email you'll get unless you tap. No news, no offers.",

  lockedIn: (p: {
    circleName: string;
    shortDate: string;
    longDate: string;
    time: string;
    placeName?: string | undefined;
    note?: string | undefined;
    organiserName?: string | undefined;
  }): EmailCopy => ({
    subject: `Locked in: ${p.circleName}, ${p.shortDate}`,
    preview: p.placeName === undefined ? p.time : `${p.time} at ${p.placeName}`,
    headline: p.longDate,
    paragraphs: [
      p.placeName === undefined ? p.time : `${p.time} · ${p.placeName}`,
      ...(p.note === undefined ? [] : [quoted(p.note, p.organiserName)]),
    ],
    button: { label: 'Add to calendar' },
  }),

  reminder: (p: {
    circleName: string;
    when: 'today' | 'tonight';
    time: string;
    placeName?: string | undefined;
    goingCount: number;
  }): EmailCopy => ({
    subject: `Reminder: ${p.circleName} ${p.when}, ${p.time}`,
    preview: p.placeName ?? `${p.goingCount} going`,
    paragraphs: [
      `See you ${p.placeName === undefined ? '' : `at ${p.placeName} `}at ${p.time}. ` +
        `${p.goingCount} going. If plans change, the link below is the place.`,
    ],
    button: { label: 'Open the plan' },
  }),

  changed: (p: { circleName: string; shortDate: string; weekday: string }): EmailCopy => ({
    subject: `Change of plan: ${p.circleName}, ${p.shortDate} is off`,
    preview: 'New times, please.',
    paragraphs: [
      `Change of plan: ${p.weekday}'s catch-up is off, and ${p.circleName} is finding a new time. ` +
        "Mark the times you'd be up for. Takes a minute.",
    ],
    button: { label: 'Choose new times' },
  }),

  cancelled: (p: {
    circleName: string;
    weekday?: string | undefined;
    note?: string | undefined;
    organiserName?: string | undefined;
  }): EmailCopy => ({
    subject:
      p.weekday === undefined
        ? `Update: ${p.circleName}'s catch-up is off`
        : `Update: ${p.weekday}'s ${p.circleName} catch-up is off`,
    preview: 'Nothing for you to do.',
    paragraphs: [
      p.weekday === undefined
        ? `${p.circleName}'s catch-up is off. Nothing for you to do.`
        : `${p.weekday}'s catch-up is off. Nothing for you to do.`,
      ...(p.note === undefined ? [] : [quoted(p.note, p.organiserName)]),
    ],
    button: { label: 'Open the plan' },
  }),

  didItHappenParticipant: (p: { circleName: string; weekday: string }): EmailCopy => ({
    subject: `Were you at ${p.circleName}'s catch-up?`,
    preview: 'One tap.',
    paragraphs: [`${p.circleName} planned to meet on ${p.weekday}. Were you there? One tap.`],
    button: { label: 'Answer' },
  }),

  optionsReady: (p: { circleName: string; weekday: string; count: string }): EmailCopy => ({
    subject: `${p.circleName}: options are ready`,
    preview: `${p.weekday} looks good for ${p.count} of you.`,
    paragraphs: [`${p.weekday} looks good for ${p.count} of you. Have a look.`],
    button: { label: 'See the options' },
  }),

  repliesClosed: ({ circleName }: { circleName: string }): EmailCopy => ({
    subject: `${circleName}: replies are closed`,
    preview: 'No time is locked in yet.',
    paragraphs: [
      'Replies have closed and no time is locked in yet. ' +
        'Lock in the top option, hand it to someone else, or give it one more day.',
    ],
    button: { label: 'Decide' },
  }),

  didItHappen: (p: { circleName: string; weekday: string }): EmailCopy => ({
    subject: `Did ${p.circleName}'s catch-up happen?`,
    preview: 'One tap.',
    paragraphs: [`Did ${p.weekday}'s catch-up happen? One tap.`],
    button: { label: 'Answer' },
  }),

  aboutTime: (p: { circleName: string; since: string }): EmailCopy => ({
    subject: `${p.circleName}: about time?`,
    preview: "Your turn to plan, if you're keen.",
    paragraphs: [
      `It's been ${p.since} since ${p.circleName} got together. ` +
        "Your turn to plan, if you're keen. No rush.",
    ],
    button: { label: 'Plan a catch-up' },
  }),

  /** "about a month" — how long since a circle last met, in the push's words. */
  since: (weeks: number): string => {
    if (weeks < 3) return 'a couple of weeks';
    if (weeks < 6) return 'about a month';
    return `about ${Math.round(weeks / 4.35)} months`;
  },

  footer: {
    stopPlan: 'Stop emails for this meetup',
    manage: 'Manage email preferences',
    /** Every event email to a guest carries one (spec §5.8, §5.11). */
    reentry: (circleName: string) =>
      `On another phone or browser? This link gets you back into ${circleName}. It works once.`,
    reentryLabel: 'Get back in',
    organiser: (circleName: string) =>
      `You're getting this because you're organising a catch-up for ${circleName}.`,
    nudge: (circleName: string) => `You're getting this because you're in ${circleName}.`,
    sender: brand.name,
  },
} as const;
