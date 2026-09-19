import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { hit, size } from '@circles/tokens';

import { Button, CompactButton, Tertiary } from './Button';

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
    // Tertiary is underlined text; its tap area is the thing that has to be big
    // enough, not its type (manifesto §6).
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
