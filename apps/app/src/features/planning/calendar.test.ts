import { describe, expect, it } from 'vitest';

import {
  applyStroke,
  monthDays,
  rangeOf,
  runsOf,
  selectionOf,
  shiftMonth,
  toggleDay,
  withinReach,
} from './calendar';

/** Every date from `from` to `to`, inclusive, in September or October 2026. */
function span(from: string, to: string): string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T12:00:00Z`); at <= Date.parse(`${to}T12:00:00Z`); at += 864e5) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

const TODAY = '2026-09-10';
const open = (date: string) => date >= TODAY;

/** The CustomWindow grid picks specific days (spec §5.3, ADR 00ZZ). */
describe('a tap', () => {
  it('toggles one day', () => {
    const one = toggleDay([], '2026-09-16');
    expect(one).toEqual(['2026-09-16']);
    expect(toggleDay(one, '2026-09-14')).toEqual(['2026-09-14', '2026-09-16']);
    expect(toggleDay(['2026-09-14', '2026-09-16'], '2026-09-14')).toEqual(['2026-09-16']);
  });

  it('will not reach more than thirty days from the first day picked', () => {
    expect(withinReach(['2026-09-14'], '2026-10-13')).toBe(true);
    expect(withinReach(['2026-09-14'], '2026-10-14')).toBe(false);
    expect(toggleDay(['2026-09-14'], '2026-10-14')).toEqual(['2026-09-14']);
  });
});

describe('a stroke', () => {
  it('picks the fortnight from Mon 14 to Sun 27 in one go, in calendar order', () => {
    expect(applyStroke([], '2026-09-14', '2026-09-27', true, open)).toEqual(
      span('2026-09-14', '2026-09-27'),
    );
  });

  it('is the acceptance criterion: a fortnight, Wed 16 tapped off, Mon 21 to Wed 23 dragged off', () => {
    let picked = applyStroke([], '2026-09-14', '2026-09-27', true, open);
    picked = toggleDay(picked, '2026-09-16');
    // The stroke starts on a picked day, so it clears.
    picked = applyStroke(picked, '2026-09-21', '2026-09-23', false, open);
    expect(runsOf(picked)).toEqual([
      { start: '2026-09-14', end: '2026-09-15' },
      { start: '2026-09-17', end: '2026-09-20' },
      { start: '2026-09-24', end: '2026-09-27' },
    ]);
  });

  it('shrinks when it is dragged back, because it is measured from where it began', () => {
    const base = ['2026-09-30'];
    const far = applyStroke(base, '2026-09-14', '2026-09-20', true, open);
    expect(applyStroke(base, '2026-09-14', '2026-09-16', true, open)).toEqual([
      ...span('2026-09-14', '2026-09-16'),
      '2026-09-30',
    ]);
    expect(far).toHaveLength(8);
  });

  it('works backwards as well as forwards', () => {
    expect(applyStroke([], '2026-09-20', '2026-09-17', true, open)).toEqual(
      span('2026-09-17', '2026-09-20'),
    );
  });

  it('never picks a day already gone', () => {
    expect(applyStroke([], '2026-09-12', '2026-09-08', true, open)).toEqual(
      span('2026-09-10', '2026-09-12'),
    );
  });

  it('stops at the thirtieth day from the first picked', () => {
    const picked = applyStroke(['2026-09-14'], '2026-10-10', '2026-10-20', true, open);
    expect(picked[picked.length - 1]).toBe('2026-10-13');
  });
});

describe('the window it stands for', () => {
  it('is first to last, with the days only when there are gaps', () => {
    expect(rangeOf(span('2026-09-14', '2026-09-20'))).toEqual({
      start: '2026-09-14',
      end: '2026-09-20',
    });
    expect(rangeOf(['2026-09-14', '2026-09-16'])).toEqual({
      start: '2026-09-14',
      end: '2026-09-16',
      days: ['2026-09-14', '2026-09-16'],
    });
    expect(rangeOf([])).toBeUndefined();
  });

  it('opens on a plan’s own days', () => {
    expect(selectionOf({ start: '2026-09-14', end: '2026-09-16' })).toEqual(
      span('2026-09-14', '2026-09-16'),
    );
    expect(
      selectionOf({ start: '2026-09-14', end: '2026-09-16', days: ['2026-09-16', '2026-09-14'] }),
    ).toEqual(['2026-09-14', '2026-09-16']);
  });
});

describe('the month', () => {
  it('lays September 2026 out Monday first, the 1st on a Tuesday', () => {
    const days = monthDays('2026-09-01', '2026-09-15', []);
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ date: '2026-09-01', slot: 1 });
  });

  it('shows days gone as not pickable, and picked days as picked', () => {
    const days = monthDays('2026-09-01', '2026-09-15', ['2026-09-21', '2026-09-23']);
    expect(days[13]).toMatchObject({ date: '2026-09-14', disabled: true, why: 'past' });
    expect(days[14]).toMatchObject({ date: '2026-09-15', disabled: false });
    expect(days.filter((d) => d.selected).map((d) => d.date)).toEqual(['2026-09-21', '2026-09-23']);
  });

  it('fades the days out of reach once something is picked, and says why', () => {
    // Thirty days from 26 September end on 25 October.
    const days = monthDays('2026-10-01', '2026-09-15', ['2026-09-26']);
    expect(days[24]).toMatchObject({ date: '2026-10-25', why: undefined, disabled: false });
    expect(days[25]).toMatchObject({ date: '2026-10-26', why: 'too_far', disabled: true });
  });

  it('holds back the days up to the one Change the time takes off the table', () => {
    const days = monthDays('2026-09-01', '2026-09-15', [], '2026-09-18');
    expect(days[16]).toMatchObject({ date: '2026-09-17', disabled: true, why: 'off' });
    expect(days[17]).toMatchObject({ date: '2026-09-18', disabled: false, why: undefined });
  });

  it('pages across a year end', () => {
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2027-01-01', -1)).toBe('2026-12-01');
  });
});
