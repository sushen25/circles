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
 * The four times of day a tapped day can have: Morning,
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
export type DayBlockKind = 'morning' | 'afternoon' | 'daytime' | 'evening' | 'any_time';
/** Tonight's two (S2-06): the day is already whichever part of it it is. */
export type TonightBlockKind = 'from_now' | 'later_tonight';
export type BlockKind = DayBlockKind | TonightBlockKind;

/** The order the blocks are asked in: through the day, then the whole of it. */
export const BLOCKS: readonly BlockKind[] = ['morning', 'afternoon', 'evening', 'any_time'];
export const TONIGHT_BLOCKS: readonly BlockKind[] = ['from_now', 'later_tonight'];

/**
 * The plan's timing, and — on a plan about tonight, opened on the day — the
 * moment the editor opened, which is what "From now" is counted from. Set by
 * the container from `isTonightWindow`; absent, the editor is the ordinary one.
 */
export type BlockTiming = PlanTiming & { readonly tonight?: Instant | undefined };

/** The blocks this plan has, in order. */
export function blocksFor(timing: BlockTiming): readonly BlockKind[] {
  return timing.tonight === undefined ? BLOCKS : TONIGHT_BLOCKS;
}

/**
 * The times of day the "Change time" sheet offers (SUS-206): Evening,
 * Daytime (9 am to 5 pm, the domain's `daytime`), Any time that day; and on tonight's plan, From now and Later
 * tonight. Morning is still a block (a day somebody's usual times painted can
 * be one, and the answer line names it), but it is not one of the three
 * choices: it is reached through the half hours.
 */
export const WINDOWS: readonly BlockKind[] = ['evening', 'daytime', 'any_time'];

export function windowsFor(timing: BlockTiming): readonly BlockKind[] {
  return timing.tonight === undefined ? WINDOWS : TONIGHT_BLOCKS;
}

/**
 * Whether a time of day is said by where it starts ("from 5:30 pm") rather than
 * by its hours ("12–5 pm"): the ones that run to the end of the plan's band.
 * One rule for the sheet, the cards and the answer line.
 */
export const readsFromStart = (kind: BlockKind): boolean =>
  kind === 'evening' || kind === 'from_now' || kind === 'later_tonight';

/**
 * Which of the plan's times of day a day's cells are exactly, or `undefined`
 * where they are anything else (a day set by the half hour, or a morning that
 * previous times painted). The first of `windowsFor` that matches, so where two
 * are the same hours on this plan, the one the sheet offers is the one named.
 */
export function windowOfCells(
  cells: readonly boolean[],
  row: DayRow,
  timing: BlockTiming,
): BlockKind | undefined {
  if (!cells.some(Boolean)) return undefined;
  return windowsFor(timing).find((kind) => {
    const mask = blockMask(kind, row, timing);
    return (
      mask !== undefined && mask.length === cells.length && mask.every((on, i) => on === cells[i])
    );
  });
}

/**
 * The time of day a day gets when it is tapped, until the person picks
 * another: the first of the plan's windows that exists on some day. Evening on
 * every ordinary plan with an evening in it.
 */
export function defaultWindow(rows: readonly DayRow[], timing: BlockTiming): BlockKind {
  const kinds = windowsFor(timing);
  return (
    kinds.find((kind) => rows.some((row) => blockMask(kind, row, timing) !== undefined)) ??
    kinds[0]!
  );
}

const SHORTCUT: Record<DayBlockKind, ShortcutKind> = {
  morning: 'morning',
  afternoon: 'afternoon',
  daytime: 'daytime',
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
 * Previous times (ADR 0005, S2-06, SUS-159, ADR 0068): the cells the day-parts
 * somebody has offered cover on this plan, day by day — weekday parts on weekdays, weekend parts on
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
    // Tonight, the part of the evening already gone is not on offer (review
    // round 1): what was offered is clipped to From now, as the blocks are.
    const ahead = timing.tonight === undefined ? undefined : blockMask('from_now', row, timing);
    const cells = row.cells.map(() => false);
    for (const [part, kind] of Object.entries(PART_BLOCK)) {
      if (!parts.includes(`${prefix}${part}` as DayPart)) continue;
      const mask = blockMask(kind, row, timing);
      mask?.forEach((on, i) => {
        if (on && (timing.tonight === undefined || ahead?.[i] === true)) cells[i] = true;
      });
    }
    return cells;
  });
}

/**
 * The block a day's cells are exactly, or `some` for anything else, or nothing
 * when the day has no times.
 *
 * Asked in the order the blocks are listed, so the tag names the one that was
 * picked: where two blocks are the same cells, the one kept by `offeredBlocks`
 * is the first, and so is the one that names the day. On an evenings plan a
 * painted evening is Evening rather than Any time; on a 9 am to noon plan a
 * painted morning is Morning (review round 1).
 */
export type DayTag = BlockKind | 'some';

export function dayTag(
  cells: readonly boolean[],
  row: DayRow,
  timing: BlockTiming,
): DayTag | undefined {
  if (!cells.some(Boolean)) return undefined;
  // The plan's choices first, so a day is named as the sheet names it where
  // a day-part is the same hours (Daytime on a plan from 3 pm, not Afternoon).
  for (const kind of [...windowsFor(timing), ...blocksFor(timing)]) {
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

/** A choice offered for the tapped days, and the days it would paint. */
export type BlockOffer = {
  kind: BlockKind;
  /** The tapped days the block exists on, as row indices. Never empty. */
  days: number[];
};

/**
 * The blocks worth offering for the tapped days, in `BLOCKS` order.
 *
 * A block that exists on none of them is not offered. Two that would paint
 * identical cells on every tapped day are one choice, so only the first is
 * kept: on an evenings plan Evening and Any time are the same hours and only
 * Evening is shown. This is S1-25's `planShortcuts` rule, asked of the tapped
 * days rather than of the first row.
 */
export function offeredBlocks(
  ticked: readonly number[],
  rows: readonly DayRow[],
  timing: BlockTiming,
  kinds: readonly BlockKind[] = blocksFor(timing),
): BlockOffer[] {
  const seen = new Set<string>();
  const offers: BlockOffer[] = [];
  for (const kind of kinds) {
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

/**
 * What a plan's band is, by where it sits (SUS-206): wholly before noon is
 * mornings, wholly between noon and 5 pm afternoons, wholly from 5 pm evenings,
 * and anything else days.
 */
export type BandName = 'mornings' | 'afternoons' | 'evenings' | 'days';

export function bandName(timing: PlanTiming): BandName {
  const { startMin, endMin } = timing.daily;
  if (endMin <= 12 * 60) return 'mornings';
  if (startMin >= 12 * 60 && endMin <= 17 * 60) return 'afternoons';
  if (startMin >= 17 * 60) return 'evenings';
  return 'days';
}

/**
 * The choices the plan's hours leave, clipped to the band with the empty and
 * the duplicate ones dropped: on an evenings plan, Evening alone (Any time is
 * the same hours); on 9 am to noon or noon to 5 pm, Daytime alone; on a plan
 * from 3 to 9 pm, Evening, Daytime (3 to 5 pm) and Any time, which still differ.
 * Tonight's plan keeps its two.
 */
export function planChoices(rows: readonly DayRow[], timing: BlockTiming): BlockKind[] {
  return offeredBlocks(
    rows.map((_, day) => day),
    rows,
    timing,
    windowsFor(timing),
  ).map((offer) => offer.kind);
}

/**
 * The one window a plan leaves, or `undefined` when there is a real choice: no
 * sheet and no choice buttons then, and the words name the band.
 */
export function onlyChoice(rows: readonly DayRow[], timing: BlockTiming): BlockKind | undefined {
  if (timing.tonight !== undefined) return undefined;
  const choices = planChoices(rows, timing);
  return choices.length === 1 ? choices[0] : undefined;
}
