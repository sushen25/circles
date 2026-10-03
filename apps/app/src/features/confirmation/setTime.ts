import {
  addDays,
  formatMinutesOfDay,
  freeFor,
  fromLocal,
  interval,
  localDate,
  othersShown,
  toLocal,
  zone as toZone,
  type Instant,
  type OthersSaid,
} from '@circles/domain';

import type { GridDay } from '../../components';
import { t } from '../../copy';
import type { PlanCandidates } from '../../data/scheduling';
import {
  dateWords,
  dayName,
  dayNumber,
  deviceTimeFormat,
  weekdayHeadings,
} from '../availability/days';
import { monthDays } from '../planning/calendar';
import { dateOf, timeOf } from '../scheduling/words';
import { weekdayOf } from '../scheduling/words';
import {
  canMoveEnd,
  canMoveStart,
  instantsOf,
  isoOf,
  lastDay,
  lengthOf,
  type TimePick,
} from './time';
import type { SetTimeCalendar, SetTimeClock } from './SetTimeScreen';

/**
 * The picker's words and numbers (ADR 0051), apart from the screen and the flow
 * that hold them. Everything here is a pure function of the plan, the stretch
 * picked and the clock, so a test can say what a screen would show.
 */

const minuteWords = (minutes: number) => formatMinutesOfDay(minutes, deviceTimeFormat());

/** "1 hour", "2 hours", "1 and a half hours", "Half an hour". */
export function lengthWords(minutes: number): string {
  if (minutes === 30) return t('setTime', 'length_half_hour');
  const hours = Math.floor(minutes / 60);
  if (minutes % 60 !== 0) return t('setTime', 'length_and_a_half', { count: hours });
  return hours === 1 ? t('setTime', 'length_hour') : t('setTime', 'length_hours', { count: hours });
}

/** The length, and whether it is the one the plan asked for. */
function lengthLine(pick: TimePick, asked: number): string {
  const length = lengthOf(pick);
  return length === asked
    ? t('setTime', 'length_as_asked', { length: lengthWords(length) })
    : t('setTime', 'length_not_asked', { length: lengthWords(length), asked: lengthWords(asked) });
}

export function clockOf(
  pick: TimePick,
  plan: PlanCandidates,
  on: { start: (by: 1 | -1) => void; end: (by: 1 | -1) => void },
): SetTimeClock {
  return {
    label: t('setTime', 'time_on', { date: dateWords(pick.day, 'short') }),
    start: t('setTime', 'starts', { time: minuteWords(pick.startMin) }),
    end: t('setTime', 'ends', { time: minuteWords(pick.endMin) }),
    length: lengthLine(pick, plan.durationMinutes),
    canStartEarlier: canMoveStart(pick, -1),
    canStartLater: canMoveStart(pick, 1),
    canEndEarlier: canMoveEnd(pick, -1),
    canEndLater: canMoveEnd(pick, 1),
    onStart: on.start,
    onEnd: on.end,
  };
}

/** How many of the others could make some of a day: SUS-129's count, from the same read. */
function othersOn(others: OthersSaid | undefined, day: string, zone: string): number | undefined {
  if (others === undefined || !othersShown(others)) return undefined;
  const z = toZone(zone);
  const span = interval(
    fromLocal(localDate(day), 0, z),
    fromLocal(addDays(localDate(day), 1), 0, z),
  );
  const count = freeFor(others, [span]);
  return count > 0 ? count : undefined;
}

/**
 * The month's days, one picked. A day gone is faded and says so; so is a day
 * past the last the plan may be set on. A day the plan never asked about is not
 * faded: it is allowed, and the caution says so (ADR 0051).
 */
export function gridDays(input: {
  month: string;
  pick: TimePick;
  plan: PlanCandidates;
  others: OthersSaid | undefined;
  now: Instant;
}): GridDay[] {
  const { month, pick, plan, others, now } = input;
  const today = toLocal(now, toZone(plan.zone)).date;
  const last = lastDay(plan);
  return monthDays(month, today, [], today).map((day) => {
    const selected = day.date === pick.day;
    const tooFar = day.why === undefined && day.date > last;
    const count = othersOn(others, day.date, plan.zone);
    const words = dateWords(localDate(day.date), 'long');
    const label =
      day.why === 'past'
        ? t('setTime', 'day_gone', { date: words })
        : tooFar
          ? t('setTime', 'day_too_far', { date: words })
          : [
              count === undefined
                ? words
                : count === 1
                  ? t('setTime', 'day_others_one', { date: words })
                  : t('setTime', 'day_others_many', { date: words, count }),
              selected ? t('setTime', 'day_picked') : undefined,
            ]
              .filter((part): part is string => part !== undefined)
              .join(', ');
    return {
      key: day.date,
      number: dayNumber(localDate(day.date)),
      name: dayName(localDate(day.date)),
      label,
      slot: day.slot,
      selected,
      hasTimes: false,
      others: count === undefined ? undefined : String(count),
      disabled: day.why !== undefined || tooFar,
    };
  });
}

export function calendarOf(input: {
  month: string;
  title: string;
  pick: TimePick;
  plan: PlanCandidates;
  others: OthersSaid | undefined;
  now: Instant;
  canEarlier: boolean;
  onDay: (date: string) => void;
  onEarlier: () => void;
  onLater: () => void;
}): SetTimeCalendar {
  const days = gridDays(input);
  return {
    title: input.title,
    weekdays: weekdayHeadings(),
    days,
    canEarlier: input.canEarlier,
    onDay: (index) => {
      const day = days[index];
      if (day !== undefined && day.disabled !== true) input.onDay(day.key);
    },
    onEarlier: input.onEarlier,
    onLater: input.onLater,
  };
}

/** "Review Friday", or from the edit screen "Use Sat 19 Sep, 7–9 pm". */
export function primaryLabelOf(pick: TimePick, plan: PlanCandidates, fromEdit: boolean): string {
  const { startsAt, endsAt } = isoOf(pick, plan.zone);
  return fromEdit
    ? t('setTime', 'use', {
        date: dateOf(startsAt, plan.zone),
        time: timeOf(startsAt, endsAt, plan.zone),
      })
    : t('setTime', 'review', { day: weekdayOf(startsAt, plan.zone) });
}

/** Whether a stretch is exactly one of the engine's options: then it is locked in as one. */
export function optionAt(plan: PlanCandidates, pick: TimePick): string | undefined {
  const { start, end } = instantsOf(pick, plan.zone);
  return plan.view === 'ready'
    ? plan.candidates.find((c) => Date.parse(c.startsAt) === start && Date.parse(c.endsAt) === end)
        ?.id
    : undefined;
}
