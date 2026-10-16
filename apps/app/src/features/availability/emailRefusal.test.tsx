import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({}));

const { SentCard } = await import('./SentCard');
const { CheckEmailScreen } = await import('../communication/CheckEmailScreen');

/**
 * SUS-219. `request-email-updates` answers 429 `too_many_requests` once a person
 * has asked three times in a day for one address (ADR 0071;
 * `rateLimits.integration.test.ts` reaches it). `useEmailOffer` and
 * `CheckEmailFlow` turn that refusal into `too_many_tries`, and these are the
 * two screens that show it.
 */
const WORDS = "That's as many links as we send to one address in a day. Try again tomorrow.";

describe('request-email-updates refused for volume', () => {
  it('says so on the Sent card, beside the address that was typed', () => {
    render(<SentCard circleName="Sunday Crew" email="nina@example.com" problem="too_many_tries" />);

    expect(screen.getByText(WORDS)).toBeInTheDocument();
    expect(screen.getByDisplayValue('nina@example.com')).toBeInTheDocument();
  });

  it('says so on Check your email, where the resend lives', () => {
    render(<CheckEmailScreen address="nina@example.com" problem="too_many_tries" />);

    expect(screen.getByText(WORDS)).toBeInTheDocument();
  });
});
