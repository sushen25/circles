import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Track } from './Track';

const START = 17 * 60 + 30;
const clock = (m: number) => `${Math.floor(m / 60) % 24}:${String(m % 60).padStart(2, '0')}`;

function Editable({ busy }: { busy?: number[] } = {}) {
  const [cells, setCells] = useState<boolean[]>(new Array(10).fill(false));
  return (
    <Track
      day="Thursday 17 September"
      cells={cells}
      onChange={setCells}
      startMinutes={START}
      formatTime={clock}
      {...(busy ? { busy } : {})}
    />
  );
}

describe('Track', () => {
  it('offers every half hour as its own control, named by time', () => {
    render(<Editable />);
    const cells = screen.getAllByRole('checkbox');

    expect(cells).toHaveLength(10);
    expect(cells[0]).toHaveAttribute('aria-label', 'Thursday 17 September, 17:30 to 18:00');
    expect(cells[9]).toHaveAttribute('aria-label', 'Thursday 17 September, 22:00 to 22:30');
  });

  it('paints by tap and updates the range in words', () => {
    render(<Editable />);
    expect(screen.getByText('Not this day')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('checkbox')[2]!);

    expect(screen.getByText('18:30–19:00')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')[2]).toHaveAttribute('aria-checked', 'true');
  });

  it('paints from the keyboard with Space, as a checkbox should (WCAG 2.1.1)', () => {
    render(<Editable />);
    const cell = () => screen.getAllByRole('checkbox')[3]!;

    fireEvent.keyDown(cell(), { key: ' ' });
    expect(cell()).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(cell(), { key: ' ' });
    expect(cell()).toHaveAttribute('aria-checked', 'false');
  });

  it('un-paints a cell that was already selected', () => {
    render(<Editable />);
    const cell = () => screen.getAllByRole('checkbox')[4]!;

    fireEvent.click(cell());
    expect(cell()).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(cell());
    expect(cell()).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Not this day')).toBeInTheDocument();
  });

  it('says in the label when the calendar overlay greyed a cell, and still lets it be painted', () => {
    render(<Editable busy={[0]} />);
    const first = screen.getAllByRole('checkbox')[0]!;

    expect(first).toHaveAttribute(
      'aria-label',
      'Thursday 17 September, 17:30 to 18:00. Your calendar shows something here',
    );

    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-checked', 'true');
  });
});
