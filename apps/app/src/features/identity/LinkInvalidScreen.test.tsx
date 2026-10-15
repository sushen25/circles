import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LinkInvalidScreen } from './LinkInvalidScreen';

describe('the inactive link screen', () => {
  it('blames a reset only for an invite link', () => {
    render(<LinkInvalidScreen reason="inactive" />);
    expect(screen.getByText(/may have reset it/)).toBeTruthy();
  });

  it('says whom to ask for a plan link, and nothing about a reset (SUS-204)', () => {
    render(<LinkInvalidScreen reason="plan_inactive" />);
    expect(screen.getByText("This link isn't active any more.")).toBeTruthy();
    expect(screen.getByText('Ask whoever shared it for a new one.')).toBeTruthy();
    expect(screen.queryByText(/reset/)).toBeNull();
  });
});
