import {
  fromISO,
  interval,
  localDate,
  zone,
  type OthersSaid,
  type PlanTiming,
} from '@circles/domain';
import { describe, expect, it } from 'vitest';

import { dayRows, gridSlots } from './days';
import { editorReducer, emptyEditor, type EditorAction, type EditorState } from './editor';
import { editorView } from './view';

/**
 * What the editor says, worked out before anything renders (ADR 0024, ADR
 * 0068): the tiles and their spoken labels, where each day sits in the
 * calendar, the sheet's choices and the exact hours in words.
 */

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
  const rows = dayRows(timing, 'en-AU');
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
    const { run, view } = setUp(WHOLE_DAYS);
    const three = run(
      { type: 'toggle_day', day: 1 },
      { type: 'toggle_day', day: 3 },
      { type: 'toggle_day', day: 5 },
    );

    expect(view(three).answerLine).toEqual({
      days: 'Tue 15, Thu 17, Sat 19',
      time: 'Evenings, from 5:30 pm',
      shared: true,
    });
    expect(view(three).sheet!.covers).toBe('One answer covers Tue 15, Thu 17 and Sat 19.');
  });

  it('offers the choices with their hours, the picked one on', () => {
    const { run, view } = setUp(WHOLE_DAYS);
    const tapped = run({ type: 'toggle_day', day: 5 });

    expect(view(tapped).sheet!.choices).toEqual([
      { kind: 'evening', label: 'Evening', detail: 'from 5:30 pm', on: true },
      { kind: 'daytime', label: 'Daytime', detail: '9 am–5 pm', on: false },
      { kind: 'any_time', label: 'Any time', detail: undefined, on: false },
    ]);
    const daytime = run({ type: 'toggle_day', day: 5 }, { type: 'set_window', kind: 'daytime' });
    expect(view(daytime).sheet!.choices.map((c) => c.on)).toEqual([false, true, false]);
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
      '9 am–5 pm',
      undefined,
    ]);
  });

  it('has no sheet and no choices on an evenings plan: Any time is the same hours', () => {
    const { run, view } = setUp(EVENINGS);
    const shown = view(run({ type: 'toggle_day', day: 1 }));

    expect(shown.sheet).toBeUndefined();
    expect(shown.single).toBe(true);
    expect(shown.band).toBe('evenings');
    expect(shown.singleTime).toBe('from 5:30 pm');
    expect(shown.cards[0]!.choices).toEqual([]);
    expect(shown.answerLine).toMatchObject({ time: 'Evenings, from 5:30 pm', shared: true });
  });

  it('turns none of the choices on once a day is adjusted by the half hour', () => {
    const { run, view } = setUp(WHOLE_DAYS);
    const cells = new Array(27).fill(false).map((_, i) => i > 20 && i < 24);
    const adjusted = run({ type: 'toggle_day', day: 5 }, { type: 'paint', day: 5, cells });

    expect(view(adjusted).sheet!.choices.every((choice) => !choice.on)).toBe(true);
  });
});

describe('what the plan leaves to choose (SUS-206)', () => {
  /** A plan with this daily band, on the fortnight the other tests use. */
  const bandOf = (startMin: number, endMin: number) =>
    setUp({ ...WHOLE_DAYS, daily: { startMin, endMin } });
  const shown = (startMin: number, endMin: number) => {
    const { run, view } = bandOf(startMin, endMin);
    return view(run({ type: 'toggle_day', day: 1 }));
  };

  it('keeps all three choices on the daytime preset, 9 am to 10:30 pm', () => {
    const v = shown(9 * 60, 22 * 60 + 30);
    expect(v.single).toBe(false);
    expect(v.band).toBe('days');
    expect(v.sheet!.choices.map((c) => c.kind)).toEqual(['evening', 'daytime', 'any_time']);
  });

  it('has one window on the evenings preset, 5:30 to 10:30 pm, and calls it evenings', () => {
    const v = shown(17 * 60 + 30, 22 * 60 + 30);
    expect([v.single, v.band, v.sheet]).toEqual([true, 'evenings', undefined]);
    expect(v.answerLine!.time).toBe('Evenings, from 5:30 pm');
  });

  it('has one window on 9 am to noon, mornings', () => {
    const v = shown(9 * 60, 12 * 60);
    expect([v.single, v.band, v.sheet]).toEqual([true, 'mornings', undefined]);
    expect(v.singleTime).toBe('9 am–12 pm');
    expect(v.answerLine).toMatchObject({ time: 'Mornings, 9 am–12 pm', shared: true });
  });

  it('has one window on noon to 5 pm, afternoons', () => {
    const v = shown(12 * 60, 17 * 60);
    expect([v.single, v.band, v.sheet]).toEqual([true, 'afternoons', undefined]);
    expect(v.answerLine).toMatchObject({ time: 'Afternoons, 12–5 pm', shared: true });
  });

  it('keeps the choices that still differ on 3 to 9 pm: Evening, Daytime (3 to 5 pm), Any time', () => {
    const v = shown(15 * 60, 21 * 60);
    expect([v.single, v.band]).toEqual([false, 'days']);
    expect(v.sheet!.choices.map((c) => [c.kind, c.detail])).toEqual([
      ['evening', 'from 5:30 pm'],
      ['daytime', '3–5 pm'],
      ['any_time', undefined],
    ]);
  });

  it('calls a band that is none of those days: 9 am to 5 pm has one window, daytime', () => {
    const v = shown(9 * 60, 17 * 60);
    expect([v.single, v.band]).toEqual([true, 'days']);
    expect(v.answerLine!.time).toBe('Daytime, 9 am–5 pm');
  });
});

describe("an open day's hours: From – to pairs (SUS-206)", () => {
  const open = (timing: PlanTiming, ...actions: EditorAction[]) => {
    const { rows, run } = setUp(timing);
    const state = run(...actions, { type: 'open', day: 3 });
    return editorView(state, rows, timing, TWELVE, 'en-AU').cards.find((c) => c.day === 3)!.hours!;
  };

  it('is only there while the day is open', () => {
    const { run, view } = setUp(WHOLE_DAYS);

    expect(view(run({ type: 'toggle_day', day: 3 })).cards[0]!.hours).toBeUndefined();
  });

  it('says each pair with full minutes, and offers the times that edge may take', () => {
    const hours = open(WHOLE_DAYS, { type: 'toggle_day', day: 3 });

    expect(hours.ranges).toHaveLength(1);
    expect(hours.ranges[0]).toMatchObject({
      from: 17,
      to: 27,
      fromLabel: '5:30 pm',
      toLabel: '10:30 pm',
    });
    // From: any time from the band's start to a half hour before its own To.
    expect(hours.ranges[0]!.fromOptions.map((o) => o.label).slice(0, 3)).toEqual([
      '9:00 am',
      '9:30 am',
      '10:00 am',
    ]);
    expect(hours.ranges[0]!.fromOptions.at(-1)!.label).toBe('10:00 pm');
    // To: from a half hour after its own From to the band's end.
    expect(hours.ranges[0]!.toOptions[0]!.label).toBe('6:00 pm');
    expect(hours.ranges[0]!.toOptions.at(-1)!.label).toBe('10:30 pm');
  });

  it('reads two pairs, with room for none more once the day is full, and a bar with both filled', () => {
    const cells = new Array(27)
      .fill(false)
      .map((_, i) => (i >= 6 && i < 14) || (i >= 19 && i < 24));
    const hours = open(
      WHOLE_DAYS,
      { type: 'toggle_day', day: 3 },
      { type: 'paint', day: 3, cells },
    );

    expect(hours.ranges.map((r) => [r.fromLabel, r.toLabel])).toEqual([
      ['12:00 pm', '4:00 pm'],
      ['6:30 pm', '9:00 pm'],
    ]);
    expect(hours.canRemove).toBe(true);
    expect(hours.canAdd).toBe(true);
    expect(hours.bar).toEqual([
      { start: 6 / 27, end: 14 / 27 },
      { start: 19 / 27, end: 24 / 27 },
    ]);
    expect(hours.ticks).toEqual(['9 am', '4 pm', '10:30 pm']);
    const full = open(
      WHOLE_DAYS,
      { type: 'toggle_day', day: 3 },
      { type: 'set_window', kind: 'any_time' },
    );
    expect(full.canAdd).toBe(false);
    expect(full.canRemove).toBe(false);
  });

  it('keeps a clock change from making two buttons read alike', () => {
    // Midnight to 6 am over the clocks going back: 2 am happens twice.
    const band: PlanTiming = {
      ...WHOLE_DAYS,
      window: { start: localDate('2027-04-04'), end: localDate('2027-04-04') },
      daily: { startMin: 0, endMin: 6 * 60 },
    };
    const { rows, run } = setUp(band);
    const state = run({ type: 'toggle_day', day: 0 }, { type: 'open', day: 0 });
    const hours = editorView(state, rows, band, TWELVE, 'en-AU').cards[0]!.hours!;
    const labels = hours.ranges[0]!.toOptions.map((o) => o.label);

    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.some((label) => /after the clocks go back/.test(label))).toBe(true);
  });
});

describe('a time for each day', () => {
  it("is a card for each tapped day with the day, its time and the plan's choices", () => {
    const { run, view } = setUp(WHOLE_DAYS);
    const cards = view(
      run(
        { type: 'toggle_day', day: 3 },
        { type: 'toggle_day', day: 1 },
        { type: 'set_day_window', day: 1, kind: 'daytime' },
      ),
    ).cards;

    expect(cards.map((c) => [c.day, c.name, c.time, c.own])).toEqual([
      [1, 'Tue 15', '9 am–5 pm', false],
      [3, 'Thu 17', 'from 5:30 pm', false],
    ]);
    expect(cards[0]!.choices).toEqual([
      { kind: 'evening', label: 'Evening', on: false },
      { kind: 'daytime', label: 'Daytime', on: true },
      { kind: 'any_time', label: 'Any time', on: false },
    ]);
    expect(cards[1]!.choices.map((c) => c.on)).toEqual([true, false, false]);
    expect(cards.every((c) => !c.open)).toBe(true);
  });

  it("selects none, and says the hours are the guest's own, when they match no choice", () => {
    const { run, view } = setUp(WHOLE_DAYS);
    const cells = new Array(27).fill(false).map((_, i) => i >= 18 && i < 25);
    const [card] = view(
      run({ type: 'toggle_day', day: 3 }, { type: 'paint', day: 3, cells }),
    ).cards;

    expect(card).toMatchObject({ time: '6–9:30 pm, your own hours', own: true });
    expect(card!.choices.every((choice) => !choice.on)).toBe(true);
  });

  it("opens one day's half hours, and lists every tapped day whether open or not", () => {
    const { run, view } = setUp(EVENINGS);
    const shown = view(
      run({ type: 'toggle_day', day: 1 }, { type: 'toggle_day', day: 3 }, { type: 'open', day: 3 }),
    );

    expect(shown.cards.map((c) => [c.day, c.open])).toEqual([
      [1, false],
      [3, true],
    ]);
    expect(shown.cards[1]!.range).toBe('5:30–10:30 pm');
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
    expect(shown.cards[0]!.hours!.others).toBeUndefined();
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

  it('says when most others are free on an open day, in one line with no names or counts', () => {
    const { run, view } = withOthers(EVENINGS, FIVE);
    const [thursday] = view(run({ type: 'toggle_day', day: 3 }, { type: 'open', day: 3 })).cards;

    // Thursday: all five from 6:30 to 8:30 pm, and the most is 5.
    expect(thursday!.hours!.others).toBe('Most others are free 6:30–8:30 pm.');
  });

  it('says two stretches with "and"', () => {
    const { run, view } = withOthers(WHOLE_DAYS, {
      ...FIVE,
      days: [
        [evening(17, '09:00', '11:00'), evening(17, '18:00', '20:00')],
        [evening(17, '09:00', '11:00')],
        [evening(17, '18:00', '20:00')],
      ],
    });
    const [thursday] = view(run({ type: 'toggle_day', day: 3 }, { type: 'open', day: 3 })).cards;

    expect(thursday!.hours!.others).toMatch(/^Most others are free .*9–11 am and 6–8 pm\.$/);
  });

  it('says nothing about the others on a day nobody else picked', () => {
    const { run, view } = withOthers(EVENINGS, FIVE);
    const [monday] = view(run({ type: 'toggle_day', day: 0 }, { type: 'open', day: 0 })).cards;

    expect(monday!.hours!.others).toBeUndefined();
  });

  it('shows no counts anywhere below the threshold: the first to answer, or others with no times', () => {
    for (const said of [NOBODY, { ...NOBODY, answered: 2, flexible: 1 }]) {
      const { run, view } = withOthers(EVENINGS, said);
      const shown = view(run({ type: 'toggle_day', day: 3 }, { type: 'open', day: 3 }));
      expect(shown.counted).toBe(false);
      expect(shown.grid.every((day) => day.others === undefined)).toBe(true);
      expect(shown.cards[0]!.hours!.others).toBeUndefined();
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
