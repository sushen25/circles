import type * as Domain from '@circles/domain';
import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it, vi } from 'vitest';

/**
 * A time of day that exists on some tapped days and not others (ADR 0024, ADR 0068).
 *
 * A plan has one daily band, so with today's blocks this does not happen
 * on real dates: every day of a plan offers the same blocks. The editor still
 * has to be right if it ever does — a band per weekday, or a new block — so the
 * domain's answer for one day is taken away here: no daytime on Tuesday 15.
 */
vi.mock('@circles/domain', async (original) => {
  const domain = await original<typeof Domain>();
  return {
    ...domain,
    applyShortcut: (...args: Parameters<typeof Domain.applyShortcut>) =>
      args[0] === 'daytime' && args[1] === '2026-09-15' ? undefined : domain.applyShortcut(...args),
  };
});

const { offeredBlocks, windowsFor } = await import('./blocks');
const { dayRows } = await import('./days');
const { editorReducer, emptyEditor, windowOn } = await import('./editor');
const { editorView } = await import('./view');

const TIMING: PlanTiming = {
  window: { start: localDate('2026-09-14'), end: localDate('2026-09-20') },
  daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 },
  durationMinutes: 120,
  zone: zone('Australia/Melbourne'),
};
const words = {
  cell: (day: string, from: string, to: string) => `${day}, ${from} to ${to}`,
  repeated: (label: string) => label,
  crossing: (label: string) => label,
  clocksGoBack: 'Clocks go back',
};
const TUE = 1;
const SAT = 5;

describe('a time of day on only some of the tapped days', () => {
  const rows = dayRows(TIMING, { hour12: true }, words, 'en-AU');
  const reduce = editorReducer(rows, TIMING);
  const tapped = [
    { type: 'toggle_day', day: TUE } as const,
    { type: 'toggle_day', day: SAT } as const,
  ].reduce(reduce, emptyEditor(rows, TIMING));

  it('is offered for the days it exists on', () => {
    const offers = offeredBlocks([TUE, SAT], rows, TIMING, windowsFor(TIMING));
    expect(offers.find((offer) => offer.kind === 'daytime')).toEqual({
      kind: 'daytime',
      days: [SAT],
    });
  });

  it('paints only those days, and is on only for tapped days that all have it', () => {
    const daytime = reduce(tapped, { type: 'set_window', kind: 'daytime' });

    expect(daytime.days[SAT]!.slice(0, 16)).toEqual(new Array(16).fill(true));
    // Tuesday keeps what it had: the evening, since it has no daytime.
    expect(daytime.days[TUE]).toEqual(tapped.days[TUE]);
    expect(windowOn('daytime', daytime, rows, TIMING)).toBe(false);
  });

  it('says on the sheet that the choice covers the days it can', () => {
    const view = editorView(tapped, rows, TIMING, { hour12: true }, 'en-AU');

    expect(view.sheet!.choices.map((choice) => choice.label)).toEqual([
      'Evening',
      'Daytime',
      'Any time',
    ]);
  });
});
