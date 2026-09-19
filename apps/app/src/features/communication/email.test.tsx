import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EmailData from '../../data/email';

/**
 * After an answer (S1-30): what each screen sends, and what it does not. The
 * functions' own rules are S1-18's; the round trips are in the live suite.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => false }),
  useFocusEffect: (effect: () => void) => effect(),
  Redirect: ({ href }: { href: unknown }) => {
    replace(href);
    return null;
  },
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session = { status: 'guest', userId: 'priya', isAnonymous: true, isLoading: false };
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));

const planToAnswer = vi.fn();
vi.mock('../../data/availability', () => ({
  planToAnswer: (...args: unknown[]) => planToAnswer(...args),
}));
vi.mock('../../data/membership', () => ({ ownNameIn: async () => 'Priya' }));

const requestEmailUpdates = vi.fn();
const verifyEmail = vi.fn();
const managePreferences = vi.fn();
vi.mock('../../data/email', async (original) => ({
  ...(await original<typeof EmailData>()),
  requestEmailUpdates: (...args: unknown[]) => requestEmailUpdates(...args),
  verifyEmail: (...args: unknown[]) => verifyEmail(...args),
  managePreferences: (...args: unknown[]) => managePreferences(...args),
}));

const { SentFlow } = await import('../availability/SentFlow');
const { EmailVerifyFlow } = await import('./EmailVerifyFlow');
const { EmailPrefsFlow } = await import('./EmailPrefsFlow');
const { holdTokenForTests, releaseToken } = await import('../../data/links/tokens');
const { FunctionError } = await import('../../data/functions');
const { answerable } = await import('../../data/fixtures');

const PLAN = answerable.plan;
// Made at run time: a fixed token-shaped literal is what a secret scanner looks for.
const TOKEN = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(
  /-/g,
  '',
) as never;

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

function refusal(reason: string) {
  return new FunctionError({ error: 'gone', reason, message: 'x', reference: 'R1' } as never, 'x');
}

beforeEach(() => {
  for (const mock of [
    push,
    replace,
    track,
    planToAnswer,
    requestEmailUpdates,
    verifyEmail,
    managePreferences,
  ]) {
    mock.mockReset();
  }
  releaseToken('verify');
  releaseToken('preferences');
  globalThis.localStorage.clear();
  planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
  requestEmailUpdates.mockResolvedValue({ status: 'check_email' });
});

describe('Sent', () => {
  it('"Not now" sends nothing and records nothing but the offer', async () => {
    wrap(<SentFlow code={PLAN.code} />);
    await screen.findByText('Thanks, Priya. Your times are in.');

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(screen.queryByText('Get updates about this meetup by email')).toBeNull();
    expect(requestEmailUpdates).not.toHaveBeenCalled();
    expect(track.mock.calls.map(([name]) => name)).toEqual(['email_updates_offered']);
  });

  it('refuses what is not an address before asking the server', async () => {
    wrap(<SentFlow code={PLAN.code} />);
    fireEvent.change(await screen.findByLabelText('Your email'), { target: { value: 'priya@' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send verification email' }));

    await screen.findByText("That doesn't look like an email address.");
    expect(requestEmailUpdates).not.toHaveBeenCalled();
  });

  it('asks with the address as the server reads it, a fresh key each time, then Check your email', async () => {
    requestEmailUpdates.mockRejectedValueOnce(refusal('unknown')).mockResolvedValue({
      status: 'check_email',
    });
    wrap(<SentFlow code={PLAN.code} />);
    fireEvent.change(await screen.findByLabelText('Your email'), {
      target: { value: '  PRIYA@example.com ' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send verification email' }));
    });
    await screen.findByText('Ref R1');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send verification email' }));
    });

    const [first, second] = requestEmailUpdates.mock.calls.map(([options]) => options);
    expect(second.email).toBe('priya@example.com');
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(push).toHaveBeenCalledWith({
      pathname: '/j/[code]/check-email',
      params: { code: PLAN.code },
    });
    expect(track).toHaveBeenCalledWith('email_submitted', { plan_id: PLAN.id });
  });
});

describe('round 1', () => {
  it('keeps the email card after a send, so "Use a different one" comes back to it', async () => {
    wrap(<SentFlow code={PLAN.code} />);
    fireEvent.change(await screen.findByLabelText('Your email'), {
      target: { value: 'priya@example.com' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send verification email' }));
    });

    expect(push).toHaveBeenCalled();
    expect(screen.getByLabelText('Your email')).toHaveValue('priya@example.com');
  });

  it('says it could not load, with a way to try again, rather than loading for ever', async () => {
    planToAnswer.mockRejectedValue(new Error('plan lookup failed'));
    wrap(<SentFlow code={PLAN.code} />);

    await screen.findByRole('button', { name: 'Try again' });
  });
});

describe('round 2', () => {
  it('never says "your times are in" to somebody with no answer: it sends them to answer', async () => {
    planToAnswer.mockResolvedValue({ plan: PLAN, answer: null });
    wrap(<SentFlow code={PLAN.code} />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ pathname: '/j/[code]', params: { code: PLAN.code } }),
    );
    expect(screen.queryByText(/Your times are in/)).toBeNull();
  });

  it('offers email updates at most once per plan: a second visit after "Not now" does not ask again', async () => {
    const first = wrap(<SentFlow code={PLAN.code} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    first.unmount();

    wrap(<SentFlow code={PLAN.code} />);
    await screen.findByText('Thanks, Priya. Your times are in.');

    await waitFor(() =>
      expect(screen.queryByText('Get updates about this meetup by email')).toBeNull(),
    );
    expect(track.mock.calls.filter(([name]) => name === 'email_updates_offered')).toHaveLength(1);
  });
});

describe('the verification link', () => {
  it('posts the token once and names what was turned on', async () => {
    holdTokenForTests('verify', TOKEN);
    verifyEmail.mockResolvedValue({
      active_plans: [
        {
          plan_id: PLAN.id,
          short_code: PLAN.code,
          plan_title: 'Catch up',
          circle_name: 'Sunday Crew',
        },
      ],
      already_confirmed: false,
    });
    wrap(<EmailVerifyFlow />);

    await screen.findByText("You'll hear about this meetup by email.");
    expect(screen.getByText('Sunday Crew · Catch up')).toBeInTheDocument();
    expect(verifyEmail).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('email_verified', {});
  });

  it('says a spent or expired link has expired, and nothing more', async () => {
    holdTokenForTests('verify', TOKEN);
    verifyEmail.mockRejectedValue(refusal('link_expired'));
    wrap(<EmailVerifyFlow />);

    await screen.findByText('This link has expired.');
  });

  it('asks for the link again when the page was reloaded after it was read', async () => {
    wrap(<EmailVerifyFlow />);

    await screen.findByText('Open the link from your email again.');
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});

describe('email preferences', () => {
  const view = {
    removed: false,
    subscriptions: [
      { plan_id: PLAN.id, plan_title: 'Catch up', circle_name: 'Sunday Crew', active: true },
    ],
  };

  it('stops one meetup and shows what the server says after', async () => {
    holdTokenForTests('preferences', TOKEN);
    managePreferences.mockResolvedValueOnce(view).mockResolvedValueOnce({
      ...view,
      subscriptions: [{ ...view.subscriptions[0], active: false }],
    });
    wrap(<EmailPrefsFlow />);

    const toggle = await screen.findByRole('switch', { name: 'Sunday Crew · Catch up' });
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(managePreferences).toHaveBeenLastCalledWith(TOKEN, {
      action: 'stop_plan',
      planId: PLAN.id,
    });
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Sunday Crew · Catch up' })).toHaveAttribute(
        'aria-checked',
        'false',
      ),
    );
    expect(track).toHaveBeenCalledWith('email_subscription_changed', { enabled: false });
  });

  it('removes the address after one confirmation, and never reads again', async () => {
    holdTokenForTests('preferences', TOKEN);
    managePreferences
      .mockResolvedValueOnce(view)
      .mockResolvedValueOnce({ removed: true, subscriptions: [] });
    wrap(<EmailPrefsFlow />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove this email address entirely' }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove my email address' }));
    });

    await screen.findByText('Your email address is gone.');
    expect(managePreferences).toHaveBeenCalledTimes(2);
    expect(managePreferences).toHaveBeenLastCalledWith(TOKEN, { action: 'remove_contact' });
  });
});
