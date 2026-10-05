import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LinkInvalidScreen } from './LinkInvalidScreen';

vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => false }),
}));

/**
 * The "What is …?" link goes to a fixture sheet, so a live flow must not offer it
 * (SUS-140). The screen draws the link only when it is handed somewhere to go;
 * the gallery's route hands it one, the live flows do not.
 */
describe('the "What is …?" link', () => {
  it('is drawn when the screen is given where it goes', () => {
    render(<LinkInvalidScreen reason="inactive" onWhatIsBrand={() => undefined} />);
    expect(screen.getByRole('button', { name: /^What is / })).toBeTruthy();
  });

  it('is not drawn when it is not', () => {
    render(<LinkInvalidScreen reason="inactive" />);
    expect(screen.queryByRole('button', { name: /^What is / })).toBeNull();
  });
});
