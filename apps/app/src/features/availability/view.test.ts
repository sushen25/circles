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
 * What the editor says, worked out before anything renders (ADR 0024): the
 * day tags, the spoken labels, where each day sits in the calendar, the panel
 * and the answer in words.
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
    actions.reduce(reduce, emptyEditor(rows));
  const view = (state: EditorState) => editorView(state, rows, timing, TWELVE, 'en-AU');
  return { rows, run, view };
}

describe('the day grid', () => {
  it('tags a day by the block its times are exactly, and "Some" for anything else', () => {
    const { run, view } = setUp(EVENINGS);
    const cells = [false, true, true, true, true, true, true, true, true, true];

    const grid = view(
      run(
        { type: 'whole_day', day: 1 },
        { type: 'paint', day: 3, cells },
        { type: 'tick', day: 5 },
      ),
    ).grid;

    expect(grid[0]).toMatchObject({ number: '14', tag: undefined, hasTimes: false });
    // On an evenings plan the whole band is the evening, so "Eve", not "Any".
    expect(grid[1]).toMatchObject({ tag: 'Eve', hasTimes: true, selected: false });
    expect(grid[3]).toMatchObject({ tag: 'Some', hasTimes: true });
    expect(grid[5]).toMatchObject({ tag: undefined, selected: true });
  });

  it('says the full date and the times, or that there are none, to a screen reader', () => {
    const { run, view } = setUp(EVENINGS);
    const grid = view(run({ type: 'whole_day', day: 1 })).grid;

    expect(grid[0]!.label).toBe('Monday 14 September, no times yet');
    expect(grid[1]!.label).toBe('Tuesday 15 September, 5:30–10:30 pm');
  });

  it('tags the blocks of a whole-day plan: morning, afternoon, and the whole day as Any', () => {
    const { run, view } = setUp(WHOLE_DAYS);
    const state = run(
      { type: 'tick', day: 0 },
      { type: 'block', kind: 'morning' },
      { type: 'done' },
      { type: 'tick', day: 1 },
      { type: 'block', kind: 'afternoon' },
      { type: 'done' },
      { type: 'whole_day', day: 2 },
      { type: 'tick', day: 3 },
      { type: 'block', kind: 'evening' },
    );

    expect(
      view(state)
        .grid.slice(0, 4)
        .map((day) => day.tag),
    ).toEqual(['Morn', 'Aft', 'Any', 'Eve']);
  });

  it('names the day after the chip that was tapped where two blocks are the same hours (round 1)', () => {
    // A custom morning plan: Morning and Any time are both 9 am to noon, and
    // only Morning is offered, so the day it paints must read "Morn".
    const { run, view } = setUp({ ...EVENINGS, daily: { startMin: 9 * 60, endMin: 12 * 60 } });
    const state = run({ type: 'tick', day: 0 }, { type: 'block', kind: 'morning' });

    expect(view(state).panel!.blocks.map((b) => b.kind)).toEqual(['morning']);
    expect(view(state).grid[0]!.tag).toBe('Morn');
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

describe('the time panel', () => {
  it('is not there until a day is ticked', () => {
    const { run, view } = setUp(EVENINGS);

    expect(view(run()).panel).toBeUndefined();
  });

  it('names up to three ticked days, then counts them', () => {
    const { run, view } = setUp(EVENINGS);
    const three = run({ type: 'tick', day: 1 }, { type: 'tick', day: 3 }, { type: 'tick', day: 5 });

    expect(view(three).panel!.title).toBe('Tue 15, Thu 17, Sat 19');
    const four = run(
      { type: 'tick', day: 1 },
      { type: 'tick', day: 3 },
      { type: 'tick', day: 5 },
      { type: 'tick', day: 8 },
    );
    expect(view(four).panel!.title).toBe('4 days selected');
  });

  it('offers the blocks with their hours, on when every ticked day has them', () => {
    const { run, view } = setUp(EVENINGS);

    const ticked = run({ type: 'tick', day: 1 }, { type: 'tick', day: 3 });
    expect(view(ticked).panel!.blocks).toEqual([
      { kind: 'evening', label: 'Evening', detail: '5:30–10:30 pm', on: false },
    ]);
    expect(view(ticked).panel!.canClear).toBe(false);

    const evening = run(
      { type: 'tick', day: 1 },
      { type: 'tick', day: 3 },
      { type: 'block', kind: 'evening' },
    );
    expect(view(evening).panel!.blocks[0]!.on).toBe(true);
    expect(view(evening).panel!.canClear).toBe(true);
  });

  it('gives each block of a whole-day plan its own hours', () => {
    const { run, view } = setUp(WHOLE_DAYS);

    expect(view(run({ type: 'tick', day: 5 })).panel!.blocks.map((b) => b.detail)).toEqual([
      '9 am–12 pm',
      '12–5 pm',
      '5:30–10:30 pm',
      '9 am–10:30 pm',
    ]);
  });
});

describe('my answer', () => {
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

describe('what the others have said (SUS-129)', () => {
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

  it('says nothing at all when the others could not be read: the editor as it was', () => {
    const { run, view } = withOthers(EVENINGS, undefined);
    const shown = view(
      run({ type: 'tick', day: 3 }, { type: 'whole_day', day: 3 }, { type: 'open', day: 3 }),
    );
    expect(shown.othersLine).toBeUndefined();
    expect(shown.grid.every((day) => day.others === undefined)).toBe(true);
    expect(shown.panel?.blocks.every((block) => block.others === undefined)).toBe(true);
    expect(shown.answers[0]).toMatchObject({
      others: undefined,
      peak: undefined,
      counts: undefined,
    });
  });

  it('puts the legend above the grid and a figure on each day somebody could make', () => {
    const { run, view } = withOthers(EVENINGS, FIVE);
    const shown = view(run());
    expect(shown.othersLine).toBe(
      '5 of 6 have answered. The number on each day is how many of them could make it.',
    );
    expect(shown.grid[0]!.others).toBeUndefined();
    expect(shown.grid[1]!.others).toBe('2');
    expect(shown.grid[3]!.others).toBe('5');
    expect(shown.grid[5]!.others).toBe('1');
    // In words for a screen reader; nothing added to a day nobody picked.
    expect(shown.grid[3]!.label).toMatch(
      /^Thursday 17 September, no times yet, 5 others could make it$/,
    );
    expect(shown.grid[5]!.label).toMatch(/, 1 other could make it$/);
    expect(shown.grid[0]!.label).toMatch(/^Monday 14 September, no times yet$/);
  });

  it('gives each block a third line: agreed, up to, or nobody yet', () => {
    const { run, view } = withOthers(EVENINGS, FIVE);
    const one = view(run({ type: 'tick', day: 3 })).panel!.blocks;
    expect(one.map((block) => block.others)).toEqual(['5 free']);
    const three = view(
      run({ type: 'tick', day: 1 }, { type: 'tick', day: 3 }, { type: 'tick', day: 5 }),
    ).panel!.blocks;
    expect(three.map((block) => block.others)).toEqual(['Up to 5 free']);
    const none = view(run({ type: 'tick', day: 0 })).panel!.blocks;
    expect(none.map((block) => block.others)).toEqual(['Nobody yet']);
  });

  it('counts a block by anyone with any half hour inside it, not the most at once', () => {
    const timing = WHOLE_DAYS;
    const { run, view } = withOthers(timing, {
      ...FIVE,
      withTimes: 2,
      // Saturday 19th: one free in the morning, another late in the morning.
      days: [[evening(19, '09:00', '09:30')], [evening(19, '11:30', '12:00')]],
    });
    const blocks = view(run({ type: 'tick', day: 5 })).panel!.blocks;
    expect(blocks.find((block) => block.kind === 'morning')?.others).toBe('2 free');
    expect(blocks.find((block) => block.kind === 'evening')?.others).toBe('Nobody yet');
  });

  it('says how many others each line of the answer overlaps', () => {
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

  it('teaches, below the threshold, and shows no counts anywhere', () => {
    const { run, view } = withOthers(EVENINGS, NOBODY);
    const shown = view(
      run({ type: 'tick', day: 3 }, { type: 'whole_day', day: 3 }, { type: 'open', day: 3 }),
    );
    expect(shown.othersLine).toBe(
      "You're the first to answer. As replies come in, each day will show how many could make it.",
    );
    expect(shown.grid.every((day) => day.others === undefined)).toBe(true);
    expect(shown.panel!.blocks[0]!.others).toBeUndefined();
    expect(shown.answers[0]).toMatchObject({
      others: undefined,
      peak: undefined,
      counts: undefined,
    });
  });

  it('does not call it the first answer when others have said no or "I\'m easy"', () => {
    const { run, view } = withOthers(EVENINGS, { ...NOBODY, answered: 2, flexible: 1 });
    expect(view(run()).othersLine).toBe(
      'Nobody else has given times yet. As they do, each day will show how many could make it.',
    );
  });

  it('adds "I\'m easy" to every count, and counts the others besides a reader who has answered', () => {
    const { run, view } = withOthers(EVENINGS, {
      ...FIVE,
      answered: 4,
      withTimes: 3,
      flexible: 1,
      readerAnswered: true,
    });
    const shown = view(run({ type: 'tick', day: 0 }));
    expect(shown.othersLine).toBe(
      '4 of the other 5 have answered. The number on each day is how many of them could make it.',
    );
    expect(shown.grid[0]!.others).toBe('1');
    expect(shown.grid[3]!.others).toBe('6');
    expect(shown.panel!.blocks[0]!.others).toBe('1 free');
  });
});
