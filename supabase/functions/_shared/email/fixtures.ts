import { fixtures, fromLocal, localDate, zone } from '@circles/domain';

import type { EmailInput, EmailKind } from './types.ts';

/**
 * The Sunday Crew, as each email about them would be rendered (AGENTS.md "The
 * scenario"): Thursday 17 September, 6:30–8:30 pm at Hope St Radio, Maya
 * organising, five going.
 *
 * The tokens are **not** token-like on purpose. They are what a snapshot shows,
 * so they have to be the same on every run, and a fixed high-entropy string in
 * the repository is exactly what the secret scanner looks for — so they are
 * long runs of one letter behind a label, which read as what they are.
 */

export const ORIGIN = 'https://meet.example.com';

/** Token-shaped for the contract (`OpaqueToken`), and obviously not a real one. */
export function fixtureToken(label: 'verify' | 'prefs' | 'reentry'): string {
  return `${label}_`.padEnd(43, 'x');
}

const MELBOURNE = zone('Australia/Melbourne');
const START = fixtures.AN_EVENING;
const END = fromLocal(localDate('2026-09-17'), 20 * 60 + 30, MELBOURNE);

const circle = { origin: ORIGIN, circleName: 'Sunday Crew' };
const plan = { ...circle, planCode: 'pnemab' };
const subscriber = {
  ...plan,
  prefsToken: fixtureToken('prefs'),
  reentryToken: fixtureToken('reentry'),
};

export const SUNDAY_CREW: { readonly [K in EmailKind]: Extract<EmailInput, { kind: K }> } = {
  verify_email: { origin: ORIGIN, kind: 'verify_email', verifyToken: fixtureToken('verify') },
  locked_in: {
    ...subscriber,
    kind: 'locked_in',
    start: START,
    end: END,
    zone: MELBOURNE,
    placeName: 'Hope St Radio',
    note: "Table's booked under my name. Come hungry.",
    organiserName: 'Maya',
  },
  changed: {
    ...subscriber,
    kind: 'changed',
    change: 'reopened',
    previousStart: START,
    zone: MELBOURNE,
  },
  cancelled: {
    ...subscriber,
    kind: 'cancelled',
    start: START,
    zone: MELBOURNE,
    note: 'Sorry all, will try again in October.',
    organiserName: 'Maya',
  },
  reminder: {
    ...subscriber,
    kind: 'reminder',
    start: START,
    zone: MELBOURNE,
    placeName: 'Hope St Radio',
    goingCount: 5,
  },
  did_it_happen_participant: {
    ...subscriber,
    kind: 'did_it_happen_participant',
    start: START,
    zone: MELBOURNE,
  },
  options_ready: {
    ...plan,
    kind: 'options_ready',
    bestStart: START,
    zone: MELBOURNE,
    availableCount: 5,
  },
  replies_closed: { ...plan, kind: 'replies_closed' },
  did_it_happen: { ...plan, kind: 'did_it_happen', start: START, zone: MELBOURNE },
  about_time: {
    ...circle,
    kind: 'about_time',
    circleId: '00000000-0000-4000-8000-000000000001',
    weeksSince: 5,
  },
  threshold_initiator: { ...plan, kind: 'threshold_initiator' },
  quiet_expired: {
    ...circle,
    kind: 'quiet_expired',
    circleId: '00000000-0000-4000-8000-000000000001',
  },
};

/** Every member of the Sunday Crew but the circle itself. A subject may name none of them. */
export const MEMBER_NAMES = ['Maya', 'Priya', 'Tom', 'Jess', 'Sam', 'Alex'];

/** The other kind of `changed`: same Thursday, and the venue moved. */
export const CHANGED_PLACE: Extract<EmailInput, { kind: 'changed' }> = {
  ...subscriber,
  kind: 'changed',
  change: 'place',
  start: START,
  end: END,
  zone: MELBOURNE,
  placeName: 'Northcote Social Club',
};
