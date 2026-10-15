import {
  cellCounts,
  dayFreeCount,
  freeStretches,
  hoursShown,
  interval,
  othersShown,
  rangeText,
  type OthersSaid,
  type TimeFormat,
} from '@circles/domain';

import { t } from '../../copy';
import type { BlockTiming } from './blocks';
import type { DayRow } from './days';

/**
 * The editor's words for what the others have said (SUS-129, ADR 0045): the
 * figure on a day, and the line about the others under an open day's hours. Every number comes from the domain (`freeFor`); this only says it.
 *
 * `undefined` everywhere means "say nothing": the read failed, is still on its
 * way, or there is no backend. The editor is then exactly as it was.
 */

/** The others to count with, or undefined below the threshold. */
export function counted(others: OthersSaid | undefined): OthersSaid | undefined {
  return others !== undefined && othersShown(others) ? others : undefined;
}

/** How many others could make a day: anyone who gave times on it, from the day counts. */
export function dayFree(others: OthersSaid, row: DayRow): number {
  return dayFreeCount(others, row.date);
}

/**
 * A day's spoken label with who could make it, in words and by number (SUS-206).
 * An untapped day says how many others could; a tapped one says it is the
 * reader and that many others, so the figure on the tile and the words agree.
 */
export function dayLabel(label: string, free: number, selected: boolean): string {
  if (selected) {
    if (free === 0) return t('availability', 'day_you_alone', { label });
    return free === 1
      ? t('availability', 'day_you_and_one', { label })
      : t('availability', 'day_you_and_other', { label, count: free });
  }
  if (free === 0) return label;
  return free === 1
    ? t('availability', 'day_others_one', { label })
    : t('availability', 'day_others_other', { label, count: free });
}

/**
 * One line about the others for an open day (SUS-206): "Most others are free
 * 2–4 pm and 6–8 pm". The stretches are the domain's (`freeStretches`) over the
 * same per-half-hour counts the cells used to show; this only says them, and
 * says nothing at all when nobody else is free that day.
 */
export function othersLine(
  others: OthersSaid,
  row: DayRow,
  timing: BlockTiming,
  format: TimeFormat,
): string | undefined {
  // Two others with times, or no line: with one, the hours are that person's
  // (ADR 0066). The database sends none then; this keeps the screen honest too.
  if (!hoursShown(others)) return undefined;
  const stretches = freeStretches(cellCounts(others, row.cells));
  if (stretches.length === 0) return undefined;
  const times = stretches.map(({ from, to }) =>
    rangeText([interval(row.cells[from]!.start, row.cells[to - 1]!.end)], timing.zone, format)!,
  );
  const when =
    times.length === 1
      ? times[0]!
      : t('availability', 'days_and', {
          rest: times.slice(0, -1).join(', '),
          last: times[times.length - 1]!,
        });
  return t('availability', 'others_free', { when });
}
