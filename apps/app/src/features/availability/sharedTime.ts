import {
  cellsToWindows,
  formatMinutesOfDay,
  rangeText,
  toLocal,
  zone as toZone,
  type TimeFormat,
} from '@circles/domain';

import { t } from '../../copy';
import { blockSpan, dayTag, readsFromStart, type BlockKind, type BlockTiming } from './blocks';
import type { DayRow } from './days';
import { tappedDays, type EditorState } from './editor';

/**
 * Whether the tapped days share one time, and what it is in words (SUS-236,
 * ADR 0079): the line under the first screen's pills, and the test of whether
 * the screen opens on "A time for each day". Pure, so the cases can be tested
 * without rendering.
 */
export type SharedTime =
  /** Every tapped day has the same hours. `hours` is the line: "From 5:30 pm". */
  { same: true; hours: string } | { same: false };

/** What a block says of itself on a day: "From 5:30 pm", "9 am–5 pm", "Any time". */
export function blockHours(
  kind: BlockKind,
  row: DayRow,
  timing: BlockTiming,
  format: TimeFormat,
): string {
  if (kind === 'any_time') return t('availability', 'any_time');
  const span = blockSpan(kind, row, timing)!;
  return readsFromStart(kind)
    ? t('availability', 'hours_from', {
        time: formatMinutesOfDay(toLocal(span.start, toZone(timing.zone)).minutesOfDay, format),
      })
    : rangeText([span], timing.zone, format)!;
}

export function sharedTime(
  state: Pick<EditorState, 'days'>,
  rows: readonly DayRow[],
  timing: BlockTiming,
  format: TimeFormat,
): SharedTime | undefined {
  const tapped = tappedDays(state);
  if (tapped.length === 0) return undefined;

  const tags = tapped.map((day) => dayTag(state.days[day] ?? [], rows[day]!, timing));
  const first = tags[0];
  if (first !== undefined && first !== 'some' && tags.every((tag) => tag === first)) {
    return { same: true, hours: blockHours(first, rows[tapped[0]!]!, timing, format) };
  }

  // Hours that are no block, the same on every tapped day. Compared as local
  // hours, not cells: across a clock change the same hours sit at different
  // cell indices in rows of different lengths.
  const hours = tapped.map(
    (day) =>
      rangeText(
        cellsToWindows(rows[day]!.date, state.days[day] ?? [], timing),
        timing.zone,
        format,
      ) ?? '',
  );
  const lone = tags.every((tag) => tag === 'some');
  if (lone && hours[0] !== '' && hours.every((h) => h === hours[0])) {
    return { same: true, hours: hours[0]! };
  }
  return { same: false };
}
