import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnswerRow } from './AnswerRow';
import { Chip } from './Chip';
import { DayGrid, type GridDay } from './DayGrid';
import { Track } from './Track';

/**
 * The one optional prop each of these took for SUS-129: what the others have
 * said, as a figure or a line. Absent, each renders as it did, which is what
 * keeps plan setup's calendar and the overlay screen as they were.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function day(slot: number, overrides: Partial<GridDay> = {}): GridDay {
  const date = 14 + slot;
  return {
    key: String(date),
    number: String(date),
    name: `${WEEKDAYS[slot % 7]} ${date}`,
    label: `Day ${date}, no times yet`,
    slot,
    selected: false,
    hasTimes: false,
    ...overrides,
  };
}

describe('DayGrid with counts', () => {
  it('shows the figure on the day, hidden from a reader, whose label says it in words', () => {
    render(
      <DayGrid
        days={[
          day(0),
          day(3, { others: '5', label: 'Day 17, no times yet, 5 others could make it' }),
        ]}
        weekdays={WEEKDAYS}
        label="Days in this plan"
      />,
    );
    const thursday = screen.getByRole('button', {
      name: 'Day 17, no times yet, 5 others could make it',
    });
    const figure = screen.getByText('5');
    expect(thursday).toContainElement(figure);
    expect(figure.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('draws no figure anywhere without one', () => {
    render(<DayGrid days={[day(0), day(3)]} weekdays={WEEKDAYS} label="Days in this plan" />);
    expect(screen.queryByText('5')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});

describe('Chip with a third line', () => {
  it('shows it and says it after the hours', () => {
    render(<Chip label="Evening" detail="5:30–10:30 pm" others="3 free" />);
    expect(screen.getByRole('checkbox', { name: 'Evening, 5:30–10:30 pm, 3 free' })).toBeVisible();
    expect(screen.getByText('3 free')).toBeInTheDocument();
  });

  it('is named as before without one', () => {
    render(<Chip label="Evening" detail="5:30–10:30 pm" />);
    expect(screen.getByRole('checkbox', { name: 'Evening, 5:30–10:30 pm' })).toBeVisible();
  });
});

describe('AnswerRow with a third line', () => {
  it('shows the overlap under the hours, and leaves the spoken name to the caller', () => {
    render(
      <AnswerRow
        date="Thu 17 Sep"
        range="5:30–10:30 pm"
        others="Overlaps with 5 others"
        label="Thursday 17 September, 5:30–10:30 pm. Overlaps with 5 others. Adjust by the half hour"
        open={false}
      />,
    );
    expect(screen.getByText('Overlaps with 5 others')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Overlaps with 5 others\. Adjust by the half hour$/ }),
    ).toBeVisible();
  });
});

describe('Track with counts', () => {
  const cells = new Array(10).fill(false) as boolean[];

  it('puts a figure over each cell, hidden from a reader', () => {
    render(
      <Track
        day="Thursday 17 September"
        cells={cells}
        onChange={() => undefined}
        startMinutes={17 * 60 + 30}
        counts={cells.map((_, index) => ({ text: String(index), top: index === 9 }))}
      />,
    );
    const nine = screen.getByText('9');
    expect(nine.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(10);
  });

  it('gives a long row fixed-width cells, not cells shrunk to their borders', () => {
    const long = new Array(27).fill(false) as boolean[];
    render(
      <Track
        day="Saturday 19 September"
        cells={long}
        onChange={() => undefined}
        startMinutes={9 * 60}
      />,
    );
    // react-native-web writes `flex: 0` as `0 1 0%`, a basis that beat the
    // width and left every cell of a scrolling row two pixels wide.
    for (const cell of screen.getAllByRole('checkbox')) {
      expect(cell.style.flex).not.toBe('0 1 0%');
      expect(cell.style.width).not.toBe('');
    }
  });
});
