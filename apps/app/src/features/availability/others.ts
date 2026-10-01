import {
  cellCounts,
  freeFor,
  interval,
  othersShown,
  peakOf,
  rangeText,
  type Interval,
  type OthersSaid,
  type TimeFormat,
} from '@circles/domain';

import type { CellCount } from '../../components';
import { t } from '../../copy';
import type { BlockTiming } from './blocks';
import type { DayRow } from './days';

/**
 * The editor's words for what the others have said (SUS-129, ADR 00XX): the
 * line above the grid, the figure on a day, the third line on a block and on a
 * line of the answer, and the sentence and figures over an open day's half
 * hours. Every number comes from the domain (`freeFor`); this only says it.
 *
 * `undefined` everywhere means "say nothing": the read failed, is still on its
 * way, or there is no backend. The editor is then exactly as it was.
 */

/** The line above the grid, or nothing when there is nothing to say. */
export function othersLine(others: OthersSaid | undefined): string | undefined {
  if (others === undefined) return undefined;
  if (!othersShown(others)) {
    return others.answered === 0
      ? t('availability', 'others_first')
      : t('availability', 'others_no_times_yet');
  }
  return others.readerAnswered
    ? t('availability', 'others_answered_besides_you', {
        count: others.answered,
        total: Math.max(others.answered, others.asked - 1),
      })
    : t('availability', 'others_answered', {
        count: others.answered,
        total: Math.max(others.answered, others.asked),
      });
}

/** The others to count with, or undefined below the threshold. */
export function counted(others: OthersSaid | undefined): OthersSaid | undefined {
  return others !== undefined && othersShown(others) ? others : undefined;
}

/** How many others could make a day: anyone with any half hour on it. */
export function dayFree(others: OthersSaid, row: DayRow): number {
  return freeFor(others, row.cells);
}

/** "…, 5 others could make it" on a day's spoken label. */
export function dayLabel(label: string, free: number): string {
  if (free === 0) return label;
  return free === 1
    ? t('availability', 'day_others_one', { label })
    : t('availability', 'day_others_other', { label, count: free });
}

/**
 * A block's third line over the days it would paint: "3 free" when they
 * agree, "Up to 5 free" when they differ, "Nobody yet" for none.
 */
export function blockLine(others: OthersSaid, spans: readonly Interval[]): string {
  // One span per day, so each is asked about on its own.
  const free = spans.map((span) => freeFor(others, [span]));
  const most = Math.max(0, ...free);
  const least = Math.min(...free);
  if (most === 0) return t('availability', 'block_nobody_yet');
  return least === most
    ? t('availability', 'block_free', { count: most })
    : t('availability', 'block_up_to_free', { count: most });
}

/** The cells of a day the reader has painted, as spans. */
function paintedSpans(row: DayRow, cells: readonly boolean[]): Interval[] {
  return row.cells.filter((_, index) => cells[index] === true);
}

/** "Overlaps with 3 others", for a line of the answer. */
export function overlapLine(others: OthersSaid, row: DayRow, cells: readonly boolean[]): string {
  const free = freeFor(others, paintedSpans(row, cells));
  if (free === 0) return t('availability', 'overlap_none');
  return free === 1
    ? t('availability', 'overlap_one')
    : t('availability', 'overlap_other', { count: free });
}

export type DayOthers = {
  /** "Others free, by the half hour. The most is 5, 6:30–8:30 pm." */
  sentence: string;
  /** A figure over each cell, or undefined on a day nobody else picked. */
  counts: CellCount[] | undefined;
  /** Each cell's spoken label, with how many are free in it. */
  labels: string[];
};

/** What an open day shows over its half hours. */
export function dayOthers(
  others: OthersSaid,
  row: DayRow,
  timing: BlockTiming,
  format: TimeFormat,
): DayOthers {
  const free = cellCounts(others, row.cells);
  const peak = peakOf(free);
  const labels = row.cellLabels.map((label, index) => {
    const count = free[index] ?? 0;
    if (count === 0) return label;
    return count === 1
      ? t('availability', 'cell_others_one', { label })
      : t('availability', 'cell_others_other', { label, count });
  });
  if (peak.most === 0) {
    return { sentence: t('availability', 'peak_nobody'), counts: undefined, labels };
  }
  const runs = peak.runs.map(({ from, to }) =>
    interval(row.cells[from]!.start, row.cells[to - 1]!.end),
  );
  return {
    sentence: t('availability', 'peak', {
      count: peak.most,
      time: rangeText(runs, timing.zone, format)!,
    }),
    counts: free.map((count) => ({
      text: count === 0 ? t('availability', 'cell_nobody') : String(count),
      top: count === peak.most,
    })),
    labels,
  };
}
