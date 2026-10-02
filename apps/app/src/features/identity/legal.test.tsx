import { brand } from '@circles/config';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LegalScreen } from './LegalScreen';
import { PrivacyScreen } from './PrivacyScreen';

/**
 * SUS-102: the privacy words say only what the product does today. There is no
 * delete-account, leave-circle or export yet (S4-05 builds them), so no
 * sentence may promise one, and removal goes through the support address.
 */
const PROMISE =
  /delete (your|my) (account|data)|leave a circle|export|sell or share|never sell or share/i;

describe('what the privacy pages promise', () => {
  it('/privacy describes no control that does not exist, and names the support address', () => {
    const { container } = render(<LegalScreen kind="privacy" />);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(PROMISE);
    expect(screen.getByText('Who else handles it')).toBeVisible();
    expect(screen.getByText('What email you get')).toBeVisible();
    expect(text).toContain(`write to ${brand.supportEmail}`);
    expect(text).toContain('There is no delete button in the app yet');
  });

  it('/terms promises nothing about deletion either', () => {
    const { container } = render(<LegalScreen kind="terms" />);
    expect(container.textContent ?? '').not.toMatch(PROMISE);
  });

  it('/settings/privacy describes no control that does not exist', () => {
    const { container } = render(<PrivacyScreen />);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(PROMISE);
    expect(text).toContain(`write to ${brand.supportEmail}`);
  });
});
