import { localDate, toLocal, windowDays, zone as toZone, type Instant } from '@circles/domain';
import { useState } from 'react';

import type { GridDay } from '../../components';
import { t } from '../../copy';
import { dateWords, dayName, dayNumber, weekdayHeadings } from '../availability/days';
import { lastEnd, monthDays, monthOf, rangeOf, shiftMonth, tapDay, type Pick } from './calendar';
import type { DateRange } from './form';
import { datesWords } from './words';

/**
 * CustomWindow's month grid: which month is showing, the range being picked,
 * and the words for both. The rules are `calendar.ts`'s; this holds the taps.
 *
 * Months page forward from this one without end: the spec caps how *long* a
 * window is (fourteen days), not how far ahead it may be, so the grid does not
 * invent a horizon. Back stops at this month, whose past days are shown and
 * cannot be picked.
 */

export type CustomWindowView = {
  monthTitle: string;
  weekdays: string[];
  days: GridDay[];
  onDay: (index: number) => void;
  canEarlierMonth: boolean;
  canLaterMonth: boolean;
  onEarlierMonth: () => void;
  onLaterMonth: () => void;
  /** "Mon 14 – Sun 27 Sep", or the next thing to tap. */
  summary: string;
  detail: string;
  range: DateRange | undefined;
};

export function useCustomWindow(
  now: Instant,
  zone: string,
  initial: DateRange | undefined,
): CustomWindowView & { reset: (range: DateRange | undefined) => void } {
  const today = toLocal(now, toZone(zone)).date;
  const [pick, setPick] = useState<Pick>({ start: initial?.start, end: initial?.end });
  const [month, setMonth] = useState(monthOf(initial?.start ?? today));
  const first = monthOf(today);

  const days = monthDays(month, today, pick);
  const range = rangeOf(pick);
  const title = new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}T12:00:00Z`));

  const spoken = (date: string, why: 'past' | 'too_far' | undefined, selected: boolean) => {
    const words = dateWords(localDate(date), 'long');
    if (why === 'past') return t('customWindow', 'day_past', { date: words });
    if (why === 'too_far') return t('customWindow', 'day_too_far', { date: words });
    return selected ? t('customWindow', 'day_picked', { date: words }) : words;
  };

  return {
    monthTitle: title,
    weekdays: weekdayHeadings(),
    days: days.map((day) => ({
      key: day.date,
      number: dayNumber(localDate(day.date)),
      name: dayName(localDate(day.date)),
      label: spoken(day.date, day.why, day.selected),
      slot: day.slot,
      selected: day.selected,
      hasTimes: false,
      disabled: day.disabled,
    })),
    onDay: (index) => {
      const day = days[index];
      if (day === undefined || day.disabled) return;
      setPick((current) => tapDay(current, day.date));
    },
    canEarlierMonth: month > first,
    canLaterMonth: true,
    onEarlierMonth: () => setMonth((m) => (m > first ? shiftMonth(m, -1) : m)),
    onLaterMonth: () => setMonth((m) => shiftMonth(m, 1)),
    summary: range === undefined ? t('customWindow', 'pick_start') : datesWords(range),
    detail:
      range === undefined
        ? ''
        : pick.end === undefined
          ? t('customWindow', 'pick_end', { date: dateWords(localDate(lastEnd(pick)!), 'short') })
          : windowDays({ start: localDate(range.start), end: localDate(range.end) }) === 1
            ? t('customWindow', 'one_day')
            : t('customWindow', 'days_count', {
                count: windowDays({ start: localDate(range.start), end: localDate(range.end) }),
              }),
    range,
    reset: (next) => {
      setPick({ start: next?.start, end: next?.end });
      setMonth(monthOf(next?.start ?? today));
    },
  };
}
