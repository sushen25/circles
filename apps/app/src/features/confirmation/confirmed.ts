import { DEEP_LINK_ROUTES } from '@circles/contracts';
import {
  EN_SHARE_TEMPLATES,
  canUpdateAttendance,
  confirmationId,
  fromISO,
  icsFilename,
  lockedInMessage,
  planId,
  toISO,
  toLocal,
  toParts,
  userId,
  zone as toZone,
  type AttendanceStatus,
  type Confirmation,
  type LocalDate,
} from '@circles/domain';

import type { Member } from '../../components';
import { t } from '../../copy';
import type { PlanConfirmation } from '../../data/confirmation';
import { deviceTimeFormat } from '../availability/days';
import { nameList } from '../scheduling/names';
import { listOf } from '../scheduling/sentences';
import { dateOf, timeOf, weekdayOf } from '../scheduling/words';

/**
 * The confirmed screens' words (spec §5.7, manifesto §3.7).
 *
 * Both screens are built from one read and one view, because they describe one
 * meetup to two people: the organiser sees the message to paste and who has
 * still to say, a member sees where to go and their own answer. The counts are
 * the same sentence on both.
 */

export type LockedIn = NonNullable<PlanConfirmation['confirmation']>;

export type ConfirmedView = {
  circleName: string;
  /** "Thursday". */
  weekday: string;
  /** "17 September". */
  dayMonth: string;
  time: string;
  /** "6:30–8:30 pm · Hope St Radio", or the time alone. */
  timePlace: string;
  placeName: string | undefined;
  /** "5 going · 1 to confirm". */
  counts: string;
  /** Going first, then those still to say, dashed. Nobody who can't. */
  members: Member[];
  /** "Maya, Priya and 3 others going · Alex to confirm" — also what the marks announce. */
  names: string;
  /** "Alex hasn't said yet", or that everyone has. */
  unsaid: string;
  /** "Maya says: “…”" — absent without a note. */
  note: string | undefined;
};

function nameOf(data: PlanConfirmation, id: string): string {
  return data.roster.find((m) => m.userId === id)?.name ?? t('candidates', 'someone');
}

function idsWith(data: PlanConfirmation, status: AttendanceStatus): string[] {
  return data.attendance.filter((a) => a.status === status).map((a) => a.userId);
}

/** "17 September", as the device writes a date without its weekday. */
function dayMonthOf(date: LocalDate): string {
  const { year, month, day } = toParts(date);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function confirmedOf(data: PlanConfirmation, confirmation: LockedIn): ConfirmedView {
  const going = idsWith(data, 'going');
  const cant = idsWith(data, 'cant');
  const unsaid = idsWith(data, 'unknown');
  const time = timeOf(confirmation.startsAt, confirmation.endsAt, data.zone);
  const local = toLocal(fromISO(confirmation.startsAt), toZone(data.zone));

  const goingNames = listOf(going.map((id) => nameOf(data, id)));
  const unsaidNames = listOf(unsaid.map((id) => nameOf(data, id)));
  const names = [
    goingNames === undefined ? undefined : t('confirmedGuest', 'going_names', { name: goingNames }),
    unsaidNames === undefined
      ? undefined
      : t('confirmedGuest', 'to_confirm_names', { name: unsaidNames }),
  ].filter((part): part is string => part !== undefined);

  const organiser = data.organiserUserId === null ? undefined : nameOf(data, data.organiserUserId);

  return {
    circleName: data.circleName,
    weekday: weekdayOf(confirmation.startsAt, data.zone),
    dayMonth: dayMonthOf(local.date),
    time,
    timePlace:
      confirmation.placeName === undefined
        ? time
        : t('confirmedOrg', 'time_place', { time, what: confirmation.placeName }),
    placeName: confirmation.placeName,
    counts: [
      t('confirmedOrg', 'going', { count: going.length }),
      cant.length === 0 ? undefined : t('confirmedOrg', 'cant', { count: cant.length }),
      unsaid.length === 0 ? undefined : t('confirmedOrg', 'to_confirm', { count: unsaid.length }),
    ]
      .filter((part): part is string => part !== undefined)
      // A separator carries no voice.
      .join(' · '),
    members: [
      ...going.map((id) => ({ name: nameOf(data, id) })),
      ...unsaid.map((id) => ({ name: nameOf(data, id), waiting: true })),
    ],
    names:
      names.length === 2
        ? t('confirmedGuest', 'names_line', { first: names[0]!, second: names[1]! })
        : (names[0] ?? t('confirmedOrg', 'going', { count: 0 })),
    unsaid: unsaidOf(unsaid.map((id) => nameOf(data, id))),
    note:
      confirmation.note === undefined
        ? undefined
        : organiser === undefined
          ? confirmation.note
          : t('confirmedGuest', 'says', { name: organiser, what: confirmation.note }),
  };
}

function unsaidOf(names: readonly string[]): string {
  const list = nameList(names);
  switch (list.kind) {
    case 'none':
      return t('confirmedOrg', 'everyone_said');
    case 'one':
      return t('confirmedOrg', 'unsaid_one', { name: list.a });
    case 'two':
      return t('confirmedOrg', 'unsaid_two', { name: list.a, other: list.b });
    case 'three':
      return t('confirmedOrg', 'unsaid_three', { name: list.a, other: list.b, third: list.c });
    case 'many':
      return t('confirmedOrg', 'unsaid_many', { name: list.a, other: list.b, count: list.rest });
  }
}

/** The plan's page: the link the message and the `.ics` both carry. No secret in it. */
export function planPageLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}${DEEP_LINK_ROUTES.plan.replace(':code', code)}`;
}

/** The confirmation as the domain's type, for the domain's sentence and rules. */
export function asDomain(data: PlanConfirmation, confirmation: LockedIn): Confirmation {
  return {
    id: confirmationId(confirmation.id),
    planId: planId(data.planId),
    revision: confirmation.revision,
    candidate: {
      start: fromISO(confirmation.startsAt),
      end: fromISO(confirmation.endsAt),
      availableUserIds: confirmation.going.map(userId),
    },
    placeName: confirmation.placeName,
    placeUrl: confirmation.placeUrl,
    note: confirmation.note,
    confirmedBy: userId(confirmation.confirmedBy),
    status: confirmation.status,
    confirmedAt: fromISO(confirmation.confirmedAt),
  };
}

/**
 * "Locked in: Sunday Crew, Thu 17 Sep, 6:30–8:30 pm at Hope St Radio. …"
 *
 * Built here rather than returned by `confirm-meetup`: the server would have
 * to format a date for somebody whose locale it does not know, and formatting
 * is presentation (§5.4). The sentence is the domain's (`EN_SHARE_TEMPLATES`),
 * so the email and the paste agree.
 */
export function messageOf(data: PlanConfirmation, confirmation: LockedIn, origin: string): string {
  return lockedInMessage({
    confirmation: asDomain(data, confirmation),
    circleName: data.circleName,
    zone: toZone(data.zone),
    url: planPageLink(origin, data.code),
    format: {
      shortDate: (value, zone) => dateOf(toISO(value), zone),
      weekday: (value, zone) => weekdayOf(toISO(value), zone),
      time: deviceTimeFormat(),
    },
    templates: EN_SHARE_TEMPLATES,
  });
}

/** `sunday-crew-2026-09-17.ics` — the name `generate-ics` gives the same file. */
export function calendarFilename(data: PlanConfirmation, confirmation: LockedIn): string {
  const date = toLocal(fromISO(confirmation.startsAt), toZone(data.zone)).date;
  return icsFilename(`${data.circleName} ${date}`);
}

export type MyAttendance = {
  status: AttendanceStatus;
  /** Which way the member may move, as the domain rules it. */
  canGo: boolean;
  canCant: boolean;
};

/** The reader's own row, or nothing when they were never asked. */
export function myAttendanceOf(
  data: PlanConfirmation,
  confirmation: LockedIn,
  now: Date,
): MyAttendance | undefined {
  const mine = data.attendance.find((a) => a.userId === data.me);
  // "I was there" is the morning after's question (S1-29), not this screen's.
  if (mine === undefined || mine.status === 'was_there' || mine.status === 'missed') {
    return undefined;
  }
  const moment = { meetupEnd: fromISO(confirmation.endsAt), now: fromISO(now.toISOString()) };
  return {
    status: mine.status,
    canGo: mine.status !== 'going' && canUpdateAttendance(mine.status, 'going', moment),
    canCant: mine.status !== 'cant' && canUpdateAttendance(mine.status, 'cant', moment),
  };
}
