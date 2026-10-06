import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Button, CompactButton, Tertiary } from './Button';
import { ListRow } from './ListRow';
import { WAIT } from './wait';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('a busy Button', () => {
  it('says the -ing word, sets aria-busy, keeps its colour and ignores taps', () => {
    const onPress = vi.fn();
    render(<Button label="Lock it in" busyLabel="Locking it in" busy onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Locking it in' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).not.toHaveStyle({ opacity: '0.5' });
    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows the spinner after about 150 ms and not before', () => {
    render(<Button label="Lock it in" busyLabel="Locking it in" busy onPress={() => undefined} />);
    tick(WAIT.spinnerAfter - 1);
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    tick(1);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('never shows a spinner for a save that settles inside 150 ms', () => {
    const { rerender } = render(
      <Button label="Lock it in" busyLabel="Locking it in" busy onPress={() => undefined} />,
    );
    tick(100);
    rerender(<Button label="Lock it in" busyLabel="Locking it in" onPress={() => undefined} />);
    tick(WAIT.shownAtLeast);
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lock it in' })).toHaveAttribute(
      'aria-busy',
      'false',
    );
  });

  it('takes the very next tap once it is no longer busy', () => {
    const onPress = vi.fn();
    const { rerender } = render(<Button label="Save" busyLabel="Saving" busy onPress={onPress} />);
    rerender(<Button label="Save" busyLabel="Saving" onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('holds its width at the longer of the two labels', () => {
    const { container } = render(
      <Button label="Lock it in" busyLabel="Locking it in" onPress={() => undefined} />,
    );
    // The longer label is in the layout, hidden from sight and from a screen reader.
    expect(container.textContent).toContain('Locking it in');
    expect(screen.getByText('Locking it in')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says "Still working on it…" at about 8 s, and the button keeps going', () => {
    render(<Button label="Lock it in" busyLabel="Locking it in" busy onPress={() => undefined} />);
    tick(WAIT.slowAfter - 1);
    expect(screen.queryByText('Still working on it…')).not.toBeInTheDocument();
    tick(1);
    expect(screen.getByText('Still working on it…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Locking it in' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('keeps disabled for "you can\'t do this yet": faded, and no spinner', () => {
    render(<Button label="Lock it in" disabled onPress={() => undefined} />);
    const button = screen.getByRole('button', { name: 'Lock it in' });
    expect(button).toBeDisabled();
    expect(button).toHaveStyle({ opacity: '0.5' });
    tick(WAIT.spinnerAfter * 4);
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });
});

describe('a busy CompactButton', () => {
  it("takes the spinner in the icon's place and ignores taps", () => {
    const onPress = vi.fn();
    render(<CompactButton label="Save" busyLabel="Saving" icon="check" busy onPress={onPress} />);
    tick(WAIT.spinnerAfter);
    expect(screen.getAllByTestId('icon')).toHaveLength(1);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Saving' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('a compact button with no icon keeps its width when it turns busy (SUS-157)', () => {
  // jsdom lays nothing out, so the width is pinned the way it is built: the room
  // for the spinner is in the layout before the spinner exists, and is the same
  // size idle and busy. The real widths are measured in the gallery spec.
  it("keeps the spinner's room free while idle, and the same room once busy", () => {
    const { rerender } = render(
      <CompactButton label="Save" busyLabel="Saving" busy={false} onPress={() => undefined} />,
    );
    const idle = screen.getByTestId('spinner-room');
    expect(idle).toHaveStyle({ width: '22px' });
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();

    rerender(<CompactButton label="Save" busyLabel="Saving" busy onPress={() => undefined} />);
    tick(WAIT.spinnerAfter);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.getAllByTestId('spinner-room')).toHaveLength(1);
    expect(screen.getByTestId('spinner-room')).toHaveStyle({ width: '22px' });
  });

  it('holds the room with no busyLabel too, when the button can be busy', () => {
    render(<CompactButton label="Done" busy={false} onPress={() => undefined} />);
    expect(screen.getByTestId('spinner-room')).toBeInTheDocument();
  });

  it("asks for no room where the spinner takes an icon's place, or the button never works", () => {
    const { rerender } = render(
      <CompactButton label="Save" icon="check" busy={false} onPress={() => undefined} />,
    );
    expect(screen.queryByTestId('spinner-room')).not.toBeInTheDocument();
    rerender(<CompactButton label="Change" onPress={() => undefined} />);
    expect(screen.queryByTestId('spinner-room')).not.toBeInTheDocument();
  });
});

describe('a busy Tertiary', () => {
  it('says the -ing word and ignores taps', () => {
    const onPress = vi.fn();
    render(<Tertiary label="Not now" busyLabel="Skipping" busy onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skipping' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('a busy ListRow', () => {
  it('swaps the chevron for the spinner after about 150 ms and ignores taps', () => {
    const onPress = vi.fn();
    render(
      <ListRow
        title="Apple calendar"
        detail="Getting the file"
        label="Apple calendar"
        busy
        onPress={onPress}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    tick(WAIT.spinnerAfter);
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).not.toHaveStyle({ opacity: '0.5' });
  });

  it('says "Still working on it…" in the detail line at about 8 s', () => {
    render(
      <ListRow
        title="Apple calendar"
        detail="Getting the file"
        label="Apple calendar"
        busy
        onPress={() => undefined}
      />,
    );
    expect(screen.getByText('Getting the file')).toBeInTheDocument();
    tick(WAIT.slowAfter);
    expect(screen.queryByText('Getting the file')).not.toBeInTheDocument();
    expect(screen.getByText('Still working on it…')).toBeInTheDocument();
  });
});
