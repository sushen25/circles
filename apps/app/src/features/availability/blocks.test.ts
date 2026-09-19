import type * as Domain from '@circles/domain';
import { localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it, vi } from 'vitest';

/**
 * A block that exists on some ticked days and not others (ADR 0024).
 *
 * A plan has one daily band, so with today's four blocks this does not happen
 * on real dates: every day of a plan offers the same blocks. The editor still
 * has to be right if it ever does — a band per weekday, or a new block — so the
 * domain's answer for one day is taken away here: no morning on Tuesday 15.
 */
vi.mock('@circles/domain', async (original) => {
  const domain = await original<typeof Domain>();
  return {
    ...domain,
    applyShortcut: (...args: Parameters<typeof Domain.applyShortcut>) =>
      args[0] === 'morning' && args[1] === '2026-09-15' ? undefined : domain.applyShortcut(...args),
  };
});

const { offeredBlocks } = await import('./blocks');
const { dayRows } = await import('./days');
const { editorReducer, emptyEditor, blockOn } = await import('./editor');
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

describe('a block on only some of the ticked days', () => {
  const rows = dayRows(TIMING, { hour12: true }, words, 'en-AU');
  const reduce = editorReducer(rows, TIMING);
  const ticked = [{ type: 'tick', day: TUE } as const, { type: 'tick', day: SAT } as const].reduce(
    reduce,
    emptyEditor(rows),
  );

  it('is offered for the days it exists on', () => {
    expect(offeredBlocks([TUE, SAT], rows, TIMING)[0]).toEqual({ kind: 'morning', days: [SAT] });
  });

  it('paints only those days, and is on once they have it', () => {
    const morning = reduce(ticked, { type: 'block', kind: 'morning' });

    expect(morning.days[SAT]!.slice(0, 6)).toEqual(new Array(6).fill(true));
    expect(morning.days[TUE]!.some(Boolean)).toBe(false);
    expect(blockOn('morning', morning, rows, TIMING)).toBe(true);
  });

  it('says so on the chip', () => {
    const chip = editorView(ticked, rows, TIMING, { hour12: true }, 'en-AU').panel!.blocks[0]!;

    expect(chip).toMatchObject({ label: 'Morning', detail: '9 am–12 pm · 1 of these 2 days' });
  });
});
