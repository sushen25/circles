import {
  applyShortcut,
  applyTonightShortcut,
  isWeekend,
  windowsToCells,
  type DayPart,
  type Instant,
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
export type DayBlockKind = 'morning' | 'afternoon' | 'evening' | 'any_time';
/** Tonight's two (S2-06): the day is already whichever part of it it is. */
export type TonightBlockKind = 'from_now' | 'later_tonight';
export type BlockKind = DayBlockKind | TonightBlockKind;

/** The order the chips are offered in: through the day, then the whole of it. */
export const BLOCKS: readonly BlockKind[] = ['morning', 'afternoon', 'evening', 'any_time'];
export const TONIGHT_BLOCKS: readonly BlockKind[] = ['from_now', 'later_tonight'];

/**
 * The plan's timing, and — on a plan about tonight, opened on the day — the
 * moment the editor opened, which is what "From now" is counted from. Set by
 * the container from `isTonightWindow`; absent, the editor is the ordinary one.
 */
export type BlockTiming = PlanTiming & { readonly tonight?: Instant | undefined };

/** The chips this plan offers, in order. */
export function blocksFor(timing: BlockTiming): readonly BlockKind[] {
  return timing.tonight === undefined ? BLOCKS : TONIGHT_BLOCKS;
}

const SHORTCUT: Record<DayBlockKind, ShortcutKind> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'all_evening',
  any_time: 'any_time',
};

const isTonightKind = (kind: BlockKind): kind is TonightBlockKind =>
  kind === 'from_now' || kind === 'later_tonight';

/** The block's span on this day, or `undefined` where it does not exist. */
export function blockSpan(kind: BlockKind, row: DayRow, timing: BlockTiming): Interval | undefined {
  const span = isTonightKind(kind)
    ? timing.tonight === undefined
      ? undefined
      : applyTonightShortcut(kind, row.date, timing, timing.tonight)
    : applyShortcut(SHORTCUT[kind], row.date, timing);
  if (span === undefined) return undefined;
  return windowsToCells(row.date, [span], timing).some(Boolean) ? span : undefined;
}

/** Which of the day's cells the block covers, or `undefined` where it does not exist. */
export function blockMask(
  kind: BlockKind,
  row: DayRow,
  timing: BlockTiming,
): boolean[] | undefined {
  const span = blockSpan(kind, row, timing);
  return span === undefined ? undefined : windowsToCells(row.date, [span], timing);
}

/**
 * "Use my usual times" (ADR 0005, S2-06): the cells somebody's usual dayparts
 * cover on this plan, day by day — weekday parts on weekdays, weekend parts on
 * weekends, each part as the block of the same name, clipped to the plan's
 * hours as every block is. Nothing outside the plan is painted, and a part the
 * plan does not ask about paints nothing.
 */
const PART_BLOCK: Record<'morning' | 'afternoon' | 'evening', DayBlockKind> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
};

export function usualCells(
  rows: readonly DayRow[],
  timing: BlockTiming,
  parts: readonly DayPart[],
): boolean[][] {
  return rows.map((row) => {
    const prefix = isWeekend(row.date) ? 'weekend_' : 'weekday_';
    const cells = row.cells.map(() => false);
    for (const [part, kind] of Object.entries(PART_BLOCK)) {
      if (!parts.includes(`${prefix}${part}` as DayPart)) continue;
      const mask = blockMask(kind, row, timing);
      mask?.forEach((on, i) => {
        if (on) cells[i] = true;
      });
    }
    return cells;
  });
}

/**
 * The short word on a day in the grid: the block the day's cells are exactly,
 * or `some` for anything else, or nothing when the day has no times.
 *
 * Asked in the order the chips are offered, so the tag names the chip that
 * was tapped: where two blocks are the same cells, the one kept by
 * `offeredBlocks` is the first, and so is the one that names the day. On an
 * evenings plan a painted evening reads "Eve" rather than "Any"; on a 9 am to
 * noon plan a painted morning reads "Morn" (review round 1).
 */
export type DayTag = BlockKind | 'some';

export function dayTag(
  cells: readonly boolean[],
  row: DayRow,
  timing: BlockTiming,
): DayTag | undefined {
  if (!cells.some(Boolean)) return undefined;
  for (const kind of blocksFor(timing)) {
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
  timing: BlockTiming,
): BlockOffer[] {
  const seen = new Set<string>();
  const offers: BlockOffer[] = [];
  for (const kind of blocksFor(timing)) {
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
