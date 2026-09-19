import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnswerRow } from './AnswerRow';
import { DayGrid, type GridDay } from './DayGrid';

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

describe('DayGrid', () => {
  it('is a labelled group of toggle buttons that say whether they are ticked', () => {
    const onToggle = vi.fn();
    render(
      <DayGrid
        days={[day(0), day(1, { selected: true })]}
        weekdays={WEEKDAYS}
        label="Days in this plan"
        onToggle={onToggle}
      />,
    );

    expect(screen.getByRole('group', { name: 'Days in this plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Day 14, no times yet' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Day 15, no times yet' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Day 15, no times yet' }));
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it('carries a check on a ticked day and a word on a day with times, never colour alone', () => {
    render(
      <DayGrid
        days={[day(0, { selected: true }), day(1, { hasTimes: true, tag: 'Eve' })]}
        weekdays={WEEKDAYS}
        label="Days"
      />,
    );

    const [ticked, answered] = screen.getAllByRole('button');
    expect(ticked!.querySelector('svg')).not.toBeNull();
    expect(answered!.querySelector('svg')).toBeNull();
    expect(answered).toHaveTextContent('Eve');
  });

  it('does nothing while dimmed', () => {
    const onToggle = vi.fn();
    render(<DayGrid days={[day(0)]} weekdays={WEEKDAYS} label="Days" onToggle={onToggle} dimmed />);

    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('AnswerRow', () => {
  it('names the day, says whether it is open, and shows what is under it only when it is', () => {
    const { rerender } = render(
      <AnswerRow
        date="Tue 15 Sep"
        range="5:30–10:30 pm"
        label="Tuesday, 5:30–10:30 pm"
        open={false}
      >
        <p>the half hours</p>
      </AnswerRow>,
    );

    expect(screen.getByRole('button', { name: 'Tuesday, 5:30–10:30 pm' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('the half hours')).toBeNull();

    rerender(
      <AnswerRow date="Tue 15 Sep" range="5:30–10:30 pm" label="Tuesday, 5:30–10:30 pm" open>
        <p>the half hours</p>
      </AnswerRow>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('the half hours')).toBeInTheDocument();
  });
});
