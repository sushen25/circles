import {
  applyShortcut,
  windowsToCells,
  type Interval,
  type PlanTiming,
  type ShortcutKind,
} from '@circles/domain';

import type { DayRow } from './days';

/**
 * The four times of day the editor offers once days are ticked: Morning,
 * Afternoon, Evening, Any time (ADR 0024, spec §5.5).
 *
 * Each is one of the domain's shortcuts (`applyShortcut`), already clipped to
 * the plan's band, so no hour is written here. Evening is `all_evening` — the
 * whole evening the plan asks about — and `after_work` is not offered: on every
 * band that ends by 10:30 pm the two are the same hours, and on a longer one
 * "Evening" stopping at 10:30 would be the surprise.
 *
 * What a block *is* on a given day is its cells there. A block that covers no
 * whole cell on a day does not exist on that day.
 */
export type BlockKind = 'morning' | 'afternoon' | 'evening' | 'any_time';

/** The order the chips are offered in: through the day, then the whole of it. */
export const BLOCKS: readonly BlockKind[] = ['morning', 'afternoon', 'evening', 'any_time'];

const SHORTCUT: Record<BlockKind, ShortcutKind> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'all_evening',
  any_time: 'any_time',
};

/** The block's span on this day, or `undefined` where it does not exist. */
export function blockSpan(kind: BlockKind, row: DayRow, timing: PlanTiming): Interval | undefined {
  const span = applyShortcut(SHORTCUT[kind], row.date, timing);
  if (span === undefined) return undefined;
  return windowsToCells(row.date, [span], timing).some(Boolean) ? span : undefined;
}

/** Which of the day's cells the block covers, or `undefined` where it does not exist. */
export function blockMask(kind: BlockKind, row: DayRow, timing: PlanTiming): boolean[] | undefined {
  const span = blockSpan(kind, row, timing);
  return span === undefined ? undefined : windowsToCells(row.date, [span], timing);
}

/**
 * The short word on a day in the grid: the block the day's cells are exactly,
 * or `some` for anything else, or nothing when the day has no times.
 *
 * Evening is asked before Any time, so on an evenings plan — where the two are
 * the same hours — a painted evening reads "Eve" rather than "Any".
 */
export type DayTag = BlockKind | 'some';

const TAG_ORDER: readonly BlockKind[] = ['evening', 'any_time', 'morning', 'afternoon'];

export function dayTag(
  cells: readonly boolean[],
  row: DayRow,
  timing: PlanTiming,
): DayTag | undefined {
  if (!cells.some(Boolean)) return undefined;
  for (const kind of TAG_ORDER) {
    const mask = blockMask(kind, row, timing);
    if (
      mask !== undefined &&
      mask.length === cells.length &&
      mask.every((m, i) => m === cells[i])
    ) {
      return kind;
    }
  }
  return 'some';
}

/** A chip offered for the ticked days, and the days it would paint. */
export type BlockOffer = {
  kind: BlockKind;
  /** The ticked days the block exists on, as row indices. Never empty. */
  days: number[];
};

/**
 * The blocks worth offering for the ticked days, in `BLOCKS` order.
 *
 * A block that exists on none of them is not offered. Two that would paint
 * identical cells on every ticked day are one choice, so only the first is
 * kept: on an evenings plan Evening and Any time are the same hours and only
 * Evening is shown. This is S1-25's `planShortcuts` rule, asked of the ticked
 * days rather than of the first row.
 */
export function offeredBlocks(
  ticked: readonly number[],
  rows: readonly DayRow[],
  timing: PlanTiming,
): BlockOffer[] {
  const seen = new Set<string>();
  const offers: BlockOffer[] = [];
  for (const kind of BLOCKS) {
    const masks = ticked.map((day) => {
      const row = rows[day];
      return row === undefined ? undefined : blockMask(kind, row, timing);
    });
    const days = ticked.filter((_, i) => masks[i] !== undefined);
    if (days.length === 0) continue;
    const key = masks
      .map((mask) => (mask === undefined ? '-' : mask.map(Number).join('')))
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    offers.push({ kind, days });
  }
  return offers;
}
