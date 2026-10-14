import {
  fromISO,
  interval,
  localDate,
  zone,
  type OthersSaid,
  type PlanTiming,
} from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { dayRows, gridSlots, type RowWords } from './days';
import { editorReducer, emptyEditor, type EditorAction, type EditorState } from './editor';
import { editorView } from './view';

/**
 * What the editor says, worked out before anything renders (ADR 0024, ADR
 * 0068): the tiles and their spoken labels, where each day sits in the
 * calendar, the sheet's choices and the exact hours in words.
 */

const WORDS: RowWords = {
  cell: (day, from, to) => `${day}, ${from} to ${to}`,
  repeated: (label) => label,
  crossing: (label) => label,
  clocksGoBack: 'Clocks go back',
};
const TWELVE = { hour12: true };

/** Sunday Crew's fortnight: Monday 14 to Sunday 27 September, evenings. */
const EVENINGS: PlanTiming = {
  window: { start: localDate('2026-09-14'), end: localDate('2026-09-27') },
  daily: { startMin: 17 * 60 + 30, endMin: 22 * 60 + 30 },
  durationMinutes: 120,
  zone: zone('Australia/Melbourne'),
};
const WHOLE_DAYS: PlanTiming = { ...EVENINGS, daily: { startMin: 9 * 60, endMin: 22 * 60 + 30 } };

function setUp(timing: PlanTiming) {
  const rows = dayRows(timing, TWELVE, WORDS, 'en-AU');
  const reduce = editorReducer(rows, timing);
  const run = (...actions: EditorAction[]): EditorState =>
    actions.reduce(reduce, emptyEditor(rows, timing));
  const view = (state: EditorState) => editorView(state, rows, timing, TWELVE, 'en-AU');
  return { rows, run, view };
}

describe('the day grid', () => {
  it('shows a tapped day as selected and an untapped one as not, with no tag on either', () => {
    const { run, view } = setUp(EVENINGS);
    const cells = [false, true, true, true, true, true, true, true, true, true];

    const grid = view(run({ type: 'toggle_day', day: 1 }, { type: 'paint', day: 3, cells })).grid;

    expect(grid[0]).toMatchObject({ number: '14', selected: false });
    expect(grid[1]).toMatchObject({ selected: true, hasTimes: false });
    expect(grid.every((day) => day.tag === undefined)).toBe(true);
    // A day adjusted by the half hour is still a tapped day.
    expect(grid[3]).toMatchObject({ selected: true });
  });

  it('says the full date, and the times once it is tapped, to a screen reader', () => {
    const { run, view } = setUp(EVENINGS);
    const grid = view(run({ type: 'toggle_day', day: 1 })).grid;

    expect(grid[0]!.label).toBe('Monday 14 September');
    expect(grid[1]!.label).toBe('Tuesday 15 September, 5:30–10:30 pm');
  });

  it('puts each day under its weekday, Monday first, whatever day the plan starts on', () => {
    const { rows } = setUp({
      ...EVENINGS,
      // A Wednesday.
      window: { start: localDate('2026-09-16'), end: localDate('2026-09-22') },
    });

    // Wednesday is the third column; the next Monday starts the second week.
    expect(gridSlots(rows)).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('heads the columns with the weekdays, Monday first', () => {
    const { run, view } = setUp(EVENINGS);

    expect(view(run()).weekdays).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});

describe('the answer line and the sheet', () => {
  it('has neither until a day is tapped', () => {
    const { run, view } = setUp(EVENINGS);

    expect(view(run()).answerLine).toBeUndefined();
    expect(view(run()).sheet).toBeUndefined();
  });

  it('says the tapped days and their time in one line', () => {
    const { run, view } = setUp(EVENINGS);
    const three = run(
      { type: 'toggle_day', day: 1 },
      { type: 'toggle_day', day: 3 },
      { type: 'toggle_day', day: 5 },
    );

    expect(view(three).answerLine).toEqual({
      days: 'Tue 15, Thu 17, Sat 19',
      time: 'Evenings, from 5:30 pm',
    });
    expect(view(three).sheet!.covers).toBe('One answer covers Tue 15, Thu 17 and Sat 19.');
  });

  it('offers the choices with their hours, the picked one on', () => {
    const { run, view } = setUp(WHOLE_DAYS);
    const tapped = run({ type: 'toggle_day', day: 5 });

    expect(view(tapped).sheet!.choices).toEqual([
      { kind: 'evening', label: 'Evening', detail: 'from 5:30 pm', on: true },
      { kind: 'afternoon', label: 'Afternoon', detail: '12–5 pm', on: false },
      { kind: 'any_time', label: 'Any time', detail: undefined, on: false },
    ]);
    const afternoon = run(
      { type: 'toggle_day', day: 5 },
      { type: 'set_window', kind: 'afternoon' },
    );
    expect(view(afternoon).sheet!.choices.map((c) => c.on)).toEqual([false, true, false]);
  });

  it('gives the same hours for the same time of day on several days, and says when they vary', () => {
    const { run, view } = setUp(WHOLE_DAYS);
    const several = run(
      { type: 'toggle_day', day: 1 },
      { type: 'toggle_day', day: 3 },
      { type: 'toggle_day', day: 5 },
    );

    // Three different dates, one clock time: not "Times vary by day".
    expect(view(several).sheet!.choices.map((c) => c.detail)).toEqual([
      'from 5:30 pm',
      '12–5 pm',
      undefined,
    ]);
  });

  it('offers only Evening on an evenings plan, because Any time is the same hours', () => {
    const { run, view } = setUp(EVENINGS);

    expect(view(run({ type: 'toggle_day', day: 1 })).sheet!.choices).toEqual([
      { kind: 'evening', label: 'Evening', detail: 'from 5:30 pm', on: true },
    ]);
  });

  it('turns none of the choices on once a day is adjusted by the half hour', () => {
    const { run, view } = setUp(WHOLE_DAYS);
    const cells = new Array(27).fill(false).map((_, i) => i > 20 && i < 24);
    const adjusted = run({ type: 'toggle_day', day: 5 }, { type: 'paint', day: 5, cells });

    expect(view(adjusted).sheet!.choices.every((choice) => !choice.on)).toBe(true);
  });
});

describe('the exact hours', () => {
  it('lists the days with times, in words, and nothing else', () => {
    const { run, view } = setUp(EVENINGS);
    const cells = [false, false, true, true, true, true, false, false, true, true];

    const answers = view(
      run({ type: 'whole_day', day: 1 }, { type: 'paint', day: 3, cells }),
    ).answers;

    expect(answers.map((a) => [a.day, a.range])).toEqual([
      [1, '5:30–10:30 pm'],
      [3, '6:30–8:30 pm, 9:30–10:30 pm'],
    ]);
    expect(answers.every((a) => !a.open)).toBe(true);
  });

  it('keeps the open day listed after its last half hour is taken off, so it does not vanish mid-edit', () => {
    const { run, view } = setUp(EVENINGS);

    const emptied = run(
      { type: 'whole_day', day: 1 },
      { type: 'open', day: 1 },
      { type: 'whole_day', day: 1 },
    );
    expect(view(emptied).answers).toMatchObject([{ day: 1, open: true, range: 'Not this day' }]);
    expect(view(emptied).painted).toBe(0);
  });

  it('offers Undo after Start over', () => {
    const { run, view } = setUp(EVENINGS);

    const cleared = run({ type: 'whole_day', day: 1 }, { type: 'start_over' });
    expect(view(cleared).canUndo).toBe(true);
    expect(view(cleared).answers).toEqual([]);
  });
});

describe('what the others have said (SUS-129, SUS-206)', () => {
  /** One person's evening on a day of September 2026, Melbourne (UTC+10). */
  const evening = (day: number, from: string, to: string) =>
    interval(fromISO(`2026-09-${day}T${from}:00+10:00`), fromISO(`2026-09-${day}T${to}:00+10:00`));
  // Five of six in: all five meet on Thursday 17th from 6:30 to 8:30; two on
  // Tuesday 15th; one on Saturday 19th; nobody on Monday 14th.
  const FIVE: OthersSaid = {
    asked: 6,
    answered: 5,
    withTimes: 5,
    flexible: 0,
    readerAnswered: false,
    days: [
      [evening(15, '17:30', '22:30')],
      [evening(15, '18:30', '21:30')],
      [evening(17, '17:30', '20:30')],
      [evening(17, '17:30', '21:00')],
      [evening(17, '18:00', '22:30')],
      [evening(17, '18:30', '20:30')],
      [evening(17, '18:30', '22:30')],
      [evening(19, '17:30', '19:00')],
    ],
  };
  const NOBODY: OthersSaid = { ...FIVE, answered: 0, withTimes: 0, days: [] };

  function withOthers(timing: PlanTiming, others: OthersSaid | undefined) {
    const { rows, run } = setUp(timing);
    const view = (state: EditorState) =>
      editorView(state, rows, timing, TWELVE, 'en-AU', undefined, others);
    return { rows, run, view };
  }

  it('says nothing at all when the others could not be read: no figure on any tile', () => {
    const { run, view } = withOthers(EVENINGS, undefined);
    const shown = view(run({ type: 'toggle_day', day: 3 }, { type: 'open', day: 3 }));
    expect(shown.counted).toBe(false);
    expect(shown.grid.every((day) => day.others === undefined)).toBe(true);
    expect(shown.answers[0]).toMatchObject({
      others: undefined,
      peak: undefined,
      counts: undefined,
    });
  });

  it('puts the others on an untapped day, a muted zero where nobody could make it', () => {
    const { run, view } = withOthers(EVENINGS, FIVE);
    const shown = view(run());
    expect(shown.counted).toBe(true);
    expect(shown.grid[0]).toMatchObject({ others: '0', othersMuted: true });
    expect(shown.grid[1]).toMatchObject({ others: '2', othersMuted: false });
    expect(shown.grid[3]!.others).toBe('5');
    expect(shown.grid[5]!.others).toBe('1');
    // In words for a screen reader; nothing added to a day nobody picked.
    expect(shown.grid[3]!.label).toBe('Thursday 17 September, 5 others could make it');
    expect(shown.grid[5]!.label).toBe('Saturday 19 September, 1 other could make it');
    expect(shown.grid[0]!.label).toBe('Monday 14 September');
  });

  it('counts the reader once they tap: 5 others become 6, and untapping gives 5 back', () => {
    const { run, view } = withOthers(EVENINGS, FIVE);
    const tapped = run({ type: 'toggle_day', day: 3 });
    expect(view(tapped).grid[3]).toMatchObject({ others: '6', selected: true, othersMuted: false });
    expect(view(tapped).grid[3]!.label).toBe(
      'Thursday 17 September, 5:30–10:30 pm, you and 5 others can make it',
    );
    const untapped = run({ type: 'toggle_day', day: 3 }, { type: 'toggle_day', day: 3 });
    expect(view(untapped).grid[3]).toMatchObject({ others: '5', selected: false });
  });

  it('shows 1 for the reader alone on a day nobody else could make, and says so', () => {
    const { run, view } = withOthers(EVENINGS, FIVE);
    const alone = view(run({ type: 'toggle_day', day: 0 })).grid[0]!;
    expect(alone).toMatchObject({ others: '1', othersMuted: false });
    expect(alone.label).toBe('Monday 14 September, 5:30–10:30 pm, only you so far');
  });

  it('says how many others each line of the exact hours overlaps', () => {
    const { run, view } = withOthers(EVENINGS, FIVE);
    const early = [true, false, false, false, false, false, false, false, false, false];
    const answers = view(
      run(
        { type: 'whole_day', day: 0 },
        { type: 'paint', day: 3, cells: early },
        { type: 'whole_day', day: 1 },
      ),
    ).answers;
    expect(answers.map((answer) => answer.others)).toEqual([
      'No overlap with anyone yet',
      'Overlaps with 2 others',
      // 5:30–6 pm on Thursday: two of the five are free then.
      'Overlaps with 2 others',
    ]);
  });

  it('opens a day with the sentence and a figure over each half hour', () => {
    const { run, view } = withOthers(EVENINGS, FIVE);
    const [thursday] = view(run({ type: 'whole_day', day: 3 }, { type: 'open', day: 3 })).answers;
    expect(thursday!.peak).toBe('Others free, by the half hour. The most is 5, 6:30–8:30 pm.');
    expect(thursday!.counts?.map((count) => count.text)).toEqual([
      '2',
      '3',
      '5',
      '5',
      '5',
      '5',
      '3',
      '2',
      '2',
      '2',
    ]);
    expect(thursday!.counts?.filter((count) => count.top)).toHaveLength(4);
    // Each cell says it in words, so the figures can be hidden from a reader.
    expect(thursday!.labels[2]).toMatch(/6:30 to 7 pm\. 5 others free$/);
  });

  it('says a day nobody picked has nobody, with no figures', () => {
    const { run, view } = withOthers(EVENINGS, FIVE);
    const [monday] = view(run({ type: 'whole_day', day: 0 }, { type: 'open', day: 0 })).answers;
    expect(monday!.peak).toBe('Nobody else has picked this day yet.');
    expect(monday!.counts).toBeUndefined();
  });

  it('shows no counts anywhere below the threshold: the first to answer, or others with no times', () => {
    for (const said of [NOBODY, { ...NOBODY, answered: 2, flexible: 1 }]) {
      const { run, view } = withOthers(EVENINGS, said);
      const shown = view(run({ type: 'toggle_day', day: 3 }, { type: 'open', day: 3 }));
      expect(shown.counted).toBe(false);
      expect(shown.grid.every((day) => day.others === undefined)).toBe(true);
      expect(shown.answers[0]).toMatchObject({
        others: undefined,
        peak: undefined,
        counts: undefined,
      });
    }
  });

  it('adds "I\'m easy" to every count', () => {
    const { run, view } = withOthers(EVENINGS, {
      ...FIVE,
      answered: 4,
      withTimes: 3,
      flexible: 1,
      readerAnswered: true,
    });
    const shown = view(run({ type: 'toggle_day', day: 0 }));
    expect(shown.grid[0]!.others).toBe('2');
    expect(shown.grid[3]!.others).toBe('6');
  });
});
