import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LinkInvalidScreen } from './LinkInvalidScreen';

describe('the inactive link screen', () => {
  it('says whom to ask for a link that is not active, and nothing about an invite or a reset (SUS-248)', () => {
    render(<LinkInvalidScreen reason="inactive" />);
    expect(screen.getByText("This link isn't active any more.")).toBeTruthy();
    expect(screen.getByText('Ask whoever shared it for a new one.')).toBeTruthy();
    expect(screen.queryByText(/reset|invite/i)).toBeNull();
  });

  it('tells a visitor to a plan that is not taking answers to ask someone in the circle', () => {
    render(<LinkInvalidScreen reason="not_admitting" circleName="Sunday Crew" />);
    expect(screen.getByText("This plan isn't taking new answers.")).toBeTruthy();
    expect(screen.getByText('Ask someone in Sunday Crew to add you.')).toBeTruthy();
    expect(screen.queryByText(/invite|link/i)).toBeNull();
  });

  it('says the same, without the name, when the circle is not known', () => {
    render(<LinkInvalidScreen reason="not_admitting" />);
    expect(screen.getByText('Ask someone in the circle to add you.')).toBeTruthy();
  });

  it("tells somebody on a circle's own page they are not in it, and whom to ask", () => {
    render(<LinkInvalidScreen reason="not_in_circle" />);
    expect(screen.getByText("You're not in this circle.")).toBeTruthy();
    expect(screen.getByText(/Ask someone there to add you/)).toBeTruthy();
    expect(screen.queryByText(/invite/i)).toBeNull();
  });

  it('says whom to ask for a plan link, and nothing about a reset (SUS-204)', () => {
    render(<LinkInvalidScreen reason="plan_inactive" />);
    expect(screen.getByText("This link isn't active any more.")).toBeTruthy();
    expect(screen.getByText('Ask whoever shared it for a new one.')).toBeTruthy();
    expect(screen.queryByText(/reset/)).toBeNull();
  });
});
