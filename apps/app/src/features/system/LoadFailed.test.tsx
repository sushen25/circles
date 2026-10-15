import { CLIENT_ERROR_REFERENCE } from '@circles/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reportClientError, resetClientErrors } from '../../analytics/clientError';
import { ExitsProvider, type Exits } from './exits';
import { LoadFailed, type LoadFailedWhere } from './LoadFailed';
import { showableReference } from './useFailureReference';

const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));

const exits = (): Exits => ({ circles: vi.fn(), start: vi.fn(), reload: vi.fn() });

function show(
  where: LoadFailedWhere,
  extra: { state?: 'error' | 'offline'; reference?: string; exits?: Exits } = {},
) {
  const wired = extra.exits ?? exits();
  const wrap = (children: ReactNode) => <ExitsProvider value={wired}>{children}</ExitsProvider>;
  render(
    wrap(
      <LoadFailed
        state={extra.state ?? 'error'}
        message="We couldn't load this plan."
        where={where}
        reference={extra.reference}
        onRetry={vi.fn()}
      />,
    ),
  );
  return wired;
}

beforeEach(() => {
  track.mockReset();
  resetClientErrors();
});

describe('LoadFailed: the reference (SUS-200)', () => {
  it('makes one on the device and sends it with a client_error report, so the logs carry it', () => {
    show('circles');

    const [name, payload] = track.mock.calls[0]!;
    expect(name).toBe('client_error');
    const { reference, source, route } = payload as Record<string, string>;
    expect(reference).toMatch(CLIENT_ERROR_REFERENCE);
    expect(source).toBe('load_failed');
    expect(route).toBe('/');
    expect(screen.getByText(`Ref ${reference}`)).toBeVisible();
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('shows the request id an Edge Function logged, as it is, and reports nothing', () => {
    const requestId = '3f2c1a9e-7b44-4d0e-9a51-0c6d2f8b1e77';
    show('circles', { reference: requestId });
    expect(screen.getByText(`Ref ${requestId}`)).toBeVisible();
    expect(track).not.toHaveBeenCalled();
  });

  it('keeps the same reference when the same failure happens again in the session', () => {
    const first = reportClientError('load_failed', undefined);
    show('circles');
    expect(screen.getByText(`Ref ${first}`)).toBeVisible();
  });

  it('offline has no reference and reports nothing: the request never reached the server', () => {
    show('circles', { state: 'offline' });
    expect(screen.queryByText(/^Ref /)).not.toBeInTheDocument();
    expect(track).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back to your circles' })).toBeVisible();
  });
});

describe('LoadFailed: a reference never holds a token, a plan code, an address or a name', () => {
  // The sort of thing an error message, an address bar or a fixture holds.
  const SECRETS = [
    'nina@example.com',
    'Nina Alvarez',
    'K7QM2X',
    'eyJhbGciOiJIUzI1NiJ9.e30.sig',
    'a'.repeat(43),
    'https://example.test/p/K7QM2X#key=abc',
    "Cannot read properties of undefined (reading 'nina@example.com')",
  ];

  it.each(SECRETS)('never shows %s as a reference', (secret) => {
    expect(showableReference(secret)).toBeUndefined();
    show('guest', { reference: secret });
    // Falls back to the one made on the device, from a fixed alphabet.
    const shown = screen.getByText(/^Ref /).textContent!;
    expect(shown).toMatch(/^Ref [2-9A-HJ-NP-Z]{8}$/);
    expect(shown).not.toContain(secret);
  });

  it('puts nothing but the reference, a fixed list and the route pattern in the report', () => {
    // The page is at a plan link with the code and a key in it, and a name on screen.
    window.history.replaceState(null, '', '/p/K7QM2X#key=SECRETKEY');
    show('guest');
    const [, payload] = track.mock.calls[0]!;
    const sent = JSON.stringify(payload);
    for (const secret of ['K7QM2X', 'SECRETKEY', 'Nina', '@']) expect(sent).not.toContain(secret);
    expect(Object.keys(payload as object).sort()).toEqual([
      'build',
      'error_class',
      'platform',
      'reference',
      'route',
      'source',
    ]);
    window.history.replaceState(null, '', '/');
  });
});

describe('LoadFailed: the second way out', () => {
  it('goes back to your circles on a signed-in route', () => {
    const wired = show('circles');
    fireEvent.click(screen.getByRole('button', { name: 'Back to your circles' }));
    expect(wired.circles).toHaveBeenCalledOnce();
  });

  it('goes to the start where "your circles" is the screen that failed', () => {
    const wired = show('start');
    expect(screen.queryByRole('button', { name: 'Back to your circles' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go to the start' }));
    expect(wired.start).toHaveBeenCalledOnce();
  });

  it('reloads the page on a guest route and says to open the link from the chat again', () => {
    const wired = show('guest');
    expect(screen.queryByRole('button', { name: 'Back to your circles' })).not.toBeInTheDocument();
    expect(screen.getByText('Still stuck? Open the link from the chat again.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reload this page' }));
    expect(wired.reload).toHaveBeenCalledOnce();
  });
});
