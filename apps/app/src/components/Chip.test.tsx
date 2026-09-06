import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { hit, size } from '@circles/tokens';

import { Chip } from './Chip';

function Toggleable() {
  const [selected, setSelected] = useState(false);
  return <Chip label="Friday evening" selected={selected} onPress={() => setSelected((v) => !v)} />;
}

describe('Chip', () => {
  it('toggles when pressed', () => {
    render(<Toggleable />);
    const chip = screen.getByRole('checkbox', { name: 'Friday evening' });

    expect(chip).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-checked', 'false');
  });

  it('carries a check glyph when selected, so selection is never colour alone', () => {
    const { container, rerender } = render(
      <Chip label="Friday evening" selected={false} onPress={() => undefined} />,
    );
    expect(container.querySelector('svg')).toBeNull();

    rerender(<Chip label="Friday evening" selected onPress={() => undefined} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('is at least a 44pt tap target', () => {
    expect(size.chip).toBeGreaterThanOrEqual(hit);
  });
});
