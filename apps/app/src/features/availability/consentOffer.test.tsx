import { CONSENT } from '@circles/config';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({}));

const { SentScreen } = await import('./SentScreen');

/**
 * SUS-109 (audit H4). The words beside the box where somebody types their
 * address are the words recorded against the subscription (ADR 0019).
 */
describe('the email offer', () => {
  it('shows CONSENT.text, byte for byte', () => {
    render(<SentScreen offerEmail circleName="Sunday Crew" headline="Thanks." />);

    const shown = screen.getByText((_, node) => node?.textContent === CONSENT.text);
    expect(shown.textContent).toBe(CONSENT.text);
  });

  it("shows it, byte for byte, on the signed-in member's one-button card too", () => {
    render(<SentScreen offerEmail confirmedEmail="nina@example.com" />);

    expect(screen.getByText((_, node) => node?.textContent === CONSENT.text)).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('is not drawn when the offer is dismissed', () => {
    render(<SentScreen offerEmail={false} />);

    expect(screen.queryByText((_, node) => node?.textContent === CONSENT.text)).toBeNull();
  });
});

declare global {
  // Vite's, which Vitest runs on; `vite/client` is not a dependency of the app.
  interface ImportMeta {
    glob(
      patterns: string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}
/** Every non-test source in the app, screens and routes alike, as text. */
const SOURCES = import.meta.glob(
  ['/src/**/*.{ts,tsx}', '/app/**/*.{ts,tsx}', '!/**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
);

/** The code of a file: JSX comments and line comments cannot satisfy the test. */
const withoutComments = (text: string) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('every screen that asks for plan-update email', () => {
  // A file that calls `request-email-updates` is listed with the file that
  // draws what the person agrees to, which must render `CONSENT.text`. A new
  // caller that is not listed fails this test: decide where the sentence goes.
  const SCREEN_OF_CALLER: Record<string, string | null> = {
    '/src/features/availability/SentFlow.tsx': '/src/features/availability/SentCard.tsx',
    // The card's primary, one step (SUS-162): the same card and the same sentence.
    '/src/features/availability/useEmailOffer.ts': '/src/features/availability/SentCard.tsx',
    // Resend: the same agreement, made on the offer that sent the first letter.
    // It collects nothing and offers nothing new; "Use a different one" goes
    // back to the offer, which shows the sentence.
    '/src/features/communication/CheckEmailFlow.tsx': null,
  };

  it('is listed, and renders CONSENT.text', () => {
    const callers = Object.entries(SOURCES)
      .filter(([, text]) => /\brequestEmailUpdates\b|request-email-updates/.test(text))
      // The wrapper itself, in `data/email`, is the one place that names the function.
      .map(([path]) => path)
      .filter((path) => path !== '/src/data/email/index.ts');

    expect(callers.sort()).toEqual(Object.keys(SCREEN_OF_CALLER).sort());
    for (const screenFile of Object.values(SCREEN_OF_CALLER)) {
      if (screenFile === null) continue;
      expect(withoutComments(SOURCES[screenFile] ?? ''), screenFile).toMatch(/\{CONSENT\.text\}/);
    }
  });
});
