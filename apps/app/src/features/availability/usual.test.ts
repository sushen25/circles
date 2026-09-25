import { fromISO, localDate, zone, type PlanTiming } from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { offeredBlocks, type BlockTiming } from './blocks';
import { dayRows, type RowWords } from './days';
import {
  editorReducer,
  emptyEditor,
  windowsOf,
  type EditorAction,
  type EditorState,
} from './editor';
import { editorView } from './view';

/**
 * "Use my usual times" (ADR 0005) and tonight's editor (S2-06), as the reducer
 * and the view see them: what the pre-fill paints, that it paints nothing
 * else and sends nothing, and which chips a tonight plan offers.
 */
const WORDS: RowWords = {
  cell: (day, from, to) => `${day}, ${from} to ${to}`,
  repeated: (label) => label,
  crossing: (label) => label,
  clocksGoBack: 'Clocks go back',
};
const MELBOURNE = zone('Australia/Melbourne');

/** Monday 14 to Sunday 20 September, 9 am to 10:30 pm every day. */
const WEEK: PlanTiming = {
  window: { start: localDate('2026-09-14'), end: localDate('2026-09-20') },
  daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 },
  durationMinutes: 120,
  zone: MELBOURNE,
};
const MON = 0;
const SAT = 5;
const SUN = 6;

function setUp(timing: BlockTiming) {
  const rows = dayRows(timing, { hour12: true }, WORDS, 'en-AU');
  const reduce = editorReducer(rows, timing);
  const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(reduce, state);
  return { rows, run, start: emptyEditor(rows) };
}

const view = (
  state: EditorState,
  timing: BlockTiming,
  usual?: Parameters<typeof editorView>[5],
) => {
  const rows = dayRows(timing, { hour12: true }, WORDS, 'en-AU');
  return editorView(state, rows, timing, { hour12: true }, 'en-AU', usual);
};

describe('use my usual times', () => {
  it('paints weekday evenings on the weekdays and nothing on the weekend', () => {
    const { rows, run, start } = setUp(WEEK);
    const filled = run(start, { type: 'usual', parts: ['weekday_evening'] });

    // Evening is the block: 5:30 pm to the end of the plan's hours, every weekday.
    const windows = windowsOf(filled, rows, WEEK);
    expect(windows).toHaveLength(5);
    expect(windows[0]).toEqual({
      start: '2026-09-14T07:30:00.000Z',
      end: '2026-09-14T12:30:00.000Z',
    });
    expect(filled.days[SAT]!.some(Boolean)).toBe(false);
    expect(filled.days[SUN]!.some(Boolean)).toBe(false);
  });

  it('paints weekend mornings only on the weekend, and only inside the plan', () => {
    const { run, start, rows } = setUp(WEEK);
    const filled = run(start, { type: 'usual', parts: ['weekend_morning'] });
    expect(filled.days[MON]!.some(Boolean)).toBe(false);
    // 9 am to noon: the first six half hours of a 9 am band.
    expect(filled.days[SAT]!.flatMap((c, i) => (c ? [i] : []))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(windowsOf(filled, rows, WEEK)).toHaveLength(2);
  });

  it('leaves the answer free to change: it is an ordinary answer afterwards', () => {
    const { run, start } = setUp(WEEK);
    const changed = run(
      start,
      { type: 'usual', parts: ['weekday_evening'] },
      { type: 'remove_day', day: MON },
    );
    expect(changed.days[MON]!.some(Boolean)).toBe(false);
    expect(changed.days[1]!.some(Boolean)).toBe(true);
    expect(changed.flexible).toBe(false);
  });

  it('is offered only to start an answer, and only when it would paint something', () => {
    const { run, start } = setUp(WEEK);
    expect(view(start, WEEK, ['weekday_evening']).canUseUsual).toBe(true);
    expect(view(start, WEEK, undefined).canUseUsual).toBe(false);
    const painted = run(start, { type: 'whole_day', day: MON });
    expect(view(painted, WEEK, ['weekday_evening']).canUseUsual).toBe(false);
    const easy = run(start, { type: 'flexible', on: true });
    expect(view(easy, WEEK, ['weekday_evening']).canUseUsual).toBe(false);

    // A weekday-evening habit paints nothing on a weekend-mornings plan.
    const mornings: PlanTiming = {
      ...WEEK,
      window: { start: localDate('2026-09-19'), end: localDate('2026-09-20') },
      daily: { startMin: 9 * 60, endMin: 12 * 60 },
    };
    expect(view(emptyEditor(setUp(mornings).rows), mornings, ['weekday_evening']).canUseUsual).toBe(
      false,
    );
  });
});

describe('tonight', () => {
  /** Tuesday 15 September, made at 5 pm: 5 to 11:30 pm; opened at 7:40 pm. */
  const TONIGHT: BlockTiming = {
    window: { start: localDate('2026-09-15'), end: localDate('2026-09-15') },
    daily: { startMin: 17 * 60, endMin: 23 * 60 + 30 },
    durationMinutes: 120,
    zone: MELBOURNE,
    tonight: fromISO('2026-09-15T09:40:00.000Z'),
  };

  it('offers From now and Later tonight instead of the parts of the day', () => {
    const { rows } = setUp(TONIGHT);
    expect(offeredBlocks([0], rows, TONIGHT).map((o) => o.kind)).toEqual([
      'from_now',
      'later_tonight',
    ]);
    const ordinary = { ...TONIGHT, tonight: undefined };
    // Evening is 5:30 onward, so the 5 pm half hour makes Any time a different choice.
    expect(offeredBlocks([0], rows, ordinary).map((o) => o.kind)).toEqual(['evening', 'any_time']);
  });

  it('From now paints from the next half hour; Later tonight from 9 pm', () => {
    const { rows, run, start } = setUp(TONIGHT);
    const ticked = run(start, { type: 'tick', day: 0 });
    expect(windowsOf(run(ticked, { type: 'block', kind: 'from_now' }), rows, TONIGHT)).toEqual([
      { start: '2026-09-15T10:00:00.000Z', end: '2026-09-15T13:30:00.000Z' },
    ]);
    expect(windowsOf(run(ticked, { type: 'block', kind: 'later_tonight' }), rows, TONIGHT)).toEqual(
      [{ start: '2026-09-15T11:00:00.000Z', end: '2026-09-15T13:30:00.000Z' }],
    );
  });
});
