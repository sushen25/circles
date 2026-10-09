import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { color, hit, size } from '@circles/tokens';

import { Button, ButtonRow, CompactButton, Tertiary } from './Button';
import { InvertProvider } from './theme';

describe('Button', () => {
  it('is a button to a screen reader and calls back when pressed', () => {
    const onPress = vi.fn();
    render(<Button label="Choose my times" onPress={onPress} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose my times' }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onPress = vi.fn();
    render(<Button label="Confirm" disabled onPress={onPress} />);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('clears the 44pt minimum, primary and tertiary alike', () => {
    // The quiet action is a compact button now, so its height is the thing that
    // has to be big enough, not its type (manifesto §6).
    expect(size.button).toBeGreaterThanOrEqual(hit);

    const { container } = render(<Tertiary label="Not this week" onPress={() => undefined} />);
    const element = container.firstElementChild as HTMLElement;
    expect(element).toHaveStyle({ 'min-height': `${hit}px` });
  });

  it('keeps the compact button a 44pt target, with a name that can say more than its label', () => {
    const onPress = vi.fn();
    const { container } = render(
      <CompactButton
        label="Remove day"
        aria-label="Remove Tuesday 15 September"
        icon="x"
        onPress={onPress}
      />,
    );

    const element = container.firstElementChild as HTMLElement;
    expect(element).toHaveStyle({ 'min-height': `${hit}px` });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tuesday 15 September' }));
    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe('the pill\'s side padding (SUS-176)', () => {
  it('is 10, so three typical pills fit one line at 390pt, and stays a 44pt target both ways', () => {
    const { container } = render(<CompactButton label="Done" onPress={() => undefined} />);
    const element = container.firstElementChild as HTMLElement;
    expect(element).toHaveStyle({
      'padding-left': '10px',
      'padding-right': '10px',
      'min-width': `${hit}px`,
      'min-height': `${hit}px`,
    });
  });

  it('is the same for a Tertiary, which is the compact button centred', () => {
    const { container } = render(<Tertiary label="Not now" />);
    expect(container.firstElementChild as HTMLElement).toHaveStyle({
      'padding-left': '10px',
      'padding-right': '10px',
      'min-width': `${hit}px`,
    });
  });
});

describe('Tertiary, the quiet action (SUS-168)', () => {
  const view = (node: React.ReactNode, inverted = false) => {
    const { container } = render(<InvertProvider value={inverted}>{node}</InvertProvider>);
    return container.firstElementChild as HTMLElement;
  };

  it('is the soft accent button by default, with no underline', () => {
    const element = view(<Tertiary label="Not now" onPress={() => undefined} />);
    expect(element).toHaveStyle({ 'background-color': color.accentSoft, 'min-height': `${hit}px` });
    expect(screen.getByText('Not now')).toHaveStyle({ color: color.accentDark });
    expect(screen.getByText('Not now')).not.toHaveStyle({ 'text-decoration-line': 'underline' });
  });

  it('has a hairline plain tone for the action that lets go', () => {
    const element = view(<Tertiary tone="plain" label="Cancel this plan" />);
    expect(element).toHaveStyle({
      'background-color': color.surface,
      'border-color': color.line,
      'min-height': `${hit}px`,
    });
    expect(screen.getByText('Cancel this plan')).toHaveStyle({ color: color.ink2 });
  });

  it('takes the inverted values on the confirmed screen', () => {
    const accent = view(<Tertiary label="Edit this plan" />, true);
    expect(accent).toHaveStyle({ 'background-color': `${color.invertAccent}29` });
    expect(screen.getByText('Edit this plan')).toHaveStyle({ color: color.invertAccent });
  });

  it('takes the inverted hairline and ink for the plain tone', () => {
    const plain = view(<Tertiary tone="plain" label="Cancel this plan" />, true);
    expect(plain).toHaveStyle({
      'background-color': 'rgba(0, 0, 0, 0)',
      'border-color': color.invertLineStrong,
    });
    expect(screen.getByText('Cancel this plan')).toHaveStyle({ color: color.invertInk2 });
  });

  it('stays a button named by its label, and does not press when disabled', () => {
    const onPress = vi.fn();
    render(<Tertiary label="Not now" disabled onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('ButtonRow', () => {
  it('sits its buttons side by side and wraps them rather than overflowing the card', () => {
    // jsdom does no layout, so this pins the style that decides it: a row that
    // cannot wrap pushes its last button through a 390-wide card's edge
    // (SUS-132, found in a screenshot).
    const { container } = render(
      <ButtonRow>
        <Button label="See how it's looking" variant="secondary" onPress={() => undefined} />
        <Button label="Share the link" variant="secondary" onPress={() => undefined} />
      </ButtonRow>,
    );

    expect(container.firstElementChild).toHaveStyle({
      'flex-direction': 'row',
      'flex-wrap': 'wrap',
    });
  });
});
