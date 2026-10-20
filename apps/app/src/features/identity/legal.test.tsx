import { brand } from '@circles/config';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LegalScreen } from './LegalScreen';
import { PrivacyScreen } from './PrivacyScreen';

/**
 * SUS-102, restored by S4-05: the privacy words say only what the product does
 * today. Delete my account, leave a circle and download my data now exist, so
 * the pages may say so, and must not say there is no way to; what they must
 * still not promise is what the product does not do (selling or sharing is a
 * claim about processors, which the full policy covers).
 */
const NOT_YET = /no delete button|not in the app yet|sell or share|never sell or share/i;

describe('what the privacy pages promise', () => {
  it('/privacy names the controls that exist, and the support address', () => {
    const { container } = render(<LegalScreen kind="privacy" />);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(NOT_YET);
    expect(screen.getByText('Who else handles it')).toBeVisible();
    expect(screen.getByText('What email you get')).toBeVisible();
    expect(text).toContain(`Write to ${brand.supportEmail}`);
    expect(text).toContain('delete your account from Account');
    expect(text).toContain('thirty days later');
  });

  it('/terms makes no promise the product does not keep', () => {
    const { container } = render(<LegalScreen kind="terms" />);
    expect(container.textContent ?? '').not.toMatch(NOT_YET);
  });

  it('/settings/privacy names the same controls', () => {
    const { container } = render(<PrivacyScreen />);
    const text = container.textContent ?? '';

    expect(text).not.toMatch(NOT_YET);
    expect(text).toContain('delete your account any time from Account');
    expect(text).toContain(`Write to ${brand.supportEmail}`);
  });
});
