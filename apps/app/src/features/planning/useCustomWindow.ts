import { localDate, toLocal, zone as toZone, type Instant } from '@circles/domain';
import { useRef, useState } from 'react';

import type { GridDay, GridPaint } from '../../components';
import { t } from '../../copy';
import { dateWords, dayName, dayNumber, weekdayHeadings } from '../availability/days';
import {
  applyStroke,
  monthDays,
  monthOf,
  rangeOf,
  selectionOf,
  shiftMonth,
  toggleDay,
  type MonthDay,
} from './calendar';
import type { DateRange } from './form';
import { pickedWords } from './words';

/**
 * CustomWindow's month grid: which month is showing, the days picked, the
 * stroke in progress and the undo, and the words for all of them. The rules
 * are `calendar.ts`'s; this holds the taps and the strokes (ADR 0047).
 *
 * Months page forward from this one without end: the spec caps how *long* a
 * window is (thirty days from first to last), not how far ahead it may be, so
 * the grid does not invent a horizon. Back stops at this month, whose past
 * days are shown and cannot be picked. Picked days are kept across months; a
 * stroke works within the month showing.
 */

export type CustomWindowView = {
  monthTitle: string;
  weekdays: string[];
  days: GridDay[];
  onDay: (index: number) => void;
  /** The drag: present, so the grid paints by stroke as well as by tap. */
  paint: GridPaint;
  canEarlierMonth: boolean;
  canLaterMonth: boolean;
  onEarlierMonth: () => void;
  onLaterMonth: () => void;
  /** "Thu 17 – Sun 20 Sep, Tue 22 Sep", or what to do first. */
  summary: string;
  detail: string;
  /** Start over: only while something is picked. */
  onStartOver: (() => void) | undefined;
  /** Undo a Start over, until the next change. */
  onUndo: (() => void) | undefined;
  range: DateRange | undefined;
};

export function useCustomWindow(
  now: Instant,
  zone: string,
  initial: DateRange | undefined,
  /** The first day that may be picked, when that is later than today. */
  notBefore?: string | undefined,
): CustomWindowView & { reset: (range: DateRange | undefined) => void } {
  const today = toLocal(now, toZone(zone)).date;
  const floor = notBefore !== undefined && notBefore > today ? notBefore : today;
  const [picked, setPicked] = useState<string[]>(() => selectionOf(initial));
  // What Start over cleared, until anything else changes.
  const [undo, setUndo] = useState<string[] | undefined>();
  const [month, setMonth] = useState(monthOf(initial?.start ?? floor));
  const first = monthOf(today);
  // The stroke in progress: where it began, whether it paints or clears, and
  // the selection it began on, so dragging back gives days back.
  const stroke = useRef<{ anchor: string; paint: boolean; base: string[] } | undefined>(undefined);

  const days = monthDays(month, today, picked, floor);
  const range = rangeOf(picked);
  const title = new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}T12:00:00Z`));

  const spoken = (date: string, why: MonthDay['why'], selected: boolean) => {
    const words = dateWords(localDate(date), 'long');
    if (why === 'past') return t('customWindow', 'day_past', { date: words });
    if (why === 'off') return t('customWindow', 'day_off', { date: words });
    if (why === 'too_far') return t('customWindow', 'day_out_of_reach', { date: words });
    return selected ? t('customWindow', 'day_picked', { date: words }) : words;
  };

  const change = (next: string[]) => {
    setUndo(undefined);
    setPicked(next);
  };
  // Days a stroke may touch: not gone and not off the table. Out of reach is
  // the stroke's own business — it stops there.
  const pickable = (date: string) => date >= floor;

  const count = picked.length;
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
      change(toggleDay(picked, day.date));
    },
    paint: {
      begin: (index) => {
        const day = days[index];
        if (day === undefined || day.disabled) {
          stroke.current = undefined;
          return;
        }
        const paint = !day.selected;
        stroke.current = { anchor: day.date, paint, base: picked };
        change(applyStroke(picked, day.date, day.date, paint, pickable));
      },
      extend: (index) => {
        const day = days[index];
        const current = stroke.current;
        if (day === undefined || current === undefined) return;
        change(applyStroke(current.base, current.anchor, day.date, current.paint, pickable));
      },
      end: () => {
        stroke.current = undefined;
      },
    },
    canEarlierMonth: month > first,
    canLaterMonth: true,
    onEarlierMonth: () => setMonth((m) => (m > first ? shiftMonth(m, -1) : m)),
    onLaterMonth: () => setMonth((m) => shiftMonth(m, 1)),
    summary:
      count === 0
        ? undo === undefined
          ? t('customWindow', 'pick_days')
          : t('customWindow', 'cleared')
        : pickedWords(picked),
    detail:
      count === 0
        ? ''
        : count === 1
          ? t('customWindow', 'one_day')
          : t('customWindow', 'picked_count', { count }),
    onStartOver:
      count === 0
        ? undefined
        : () => {
            setUndo(picked);
            setPicked([]);
          },
    onUndo:
      undo === undefined || count > 0
        ? undefined
        : () => {
            setPicked(undo);
            setUndo(undefined);
          },
    range,
    reset: (next) => {
      setPicked(selectionOf(next));
      setUndo(undefined);
      setMonth(monthOf(next?.start ?? floor));
    },
  };
}
