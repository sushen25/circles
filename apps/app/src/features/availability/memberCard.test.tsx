import { CONSENT } from '@circles/config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * After sending, a signed-in member with a confirmed address (SUS-164): their
 * address as text, the sentence, and one button, with no field and no switch;
 * one tap turns the plan's emails on and sends nothing. The owner-only
 * `delivery` the server adds decides the line: a suppressed address is never
 * promised email, on this path or the switch-on code path. The server's
 * allow and deny of that signal is pgTAP 350's; the neutral shape for
 * everybody else is `handlers.test.ts`'s.
 */

const push = vi.fn();
const replace = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push, replace, dismissTo: vi.fn(), back: vi.fn(), canGoBack: () => false }),
  useFocusEffect: (effect: () => void) => effect(),
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
}));
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));
const session: Record<string, unknown> = {
  status: 'guest',
  userId: 'priya',
  isAnonymous: true,
  confirmedEmail: undefined,
  isLoading: false,
};
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));

const requestLinkCode = vi.fn();
const submitLinkCode = vi.fn();
const savePlace = vi.fn();
vi.mock('../../data/auth', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  requestLinkCode: (...a: unknown[]) => requestLinkCode(...a),
  submitLinkCode: (...a: unknown[]) => submitLinkCode(...a),
  savePlace: (...a: unknown[]) => savePlace(...a),
}));

const planToAnswer = vi.fn();
vi.mock('../../data/availability', () => ({
  planToAnswer: (...args: unknown[]) => planToAnswer(...args),
}));
vi.mock('../../data/membership', () => ({ ownNameIn: async () => 'Priya' }));

const requestEmailUpdates = vi.fn();
vi.mock('../../data/email', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  requestEmailUpdates: (...args: unknown[]) => requestEmailUpdates(...args),
}));
vi.mock('../../data/growth', () => ({
  askToShow: () => Promise.resolve({ suppressed: false }),
  recordAnswer: () => Promise.resolve(undefined),
}));

const { SentFlow } = await import('./SentFlow');
const { forgetSessionNudges } = await import('../growth/useNudge');
const { forgetOneSteps } = await import('./oneStep');
const { answerable } = await import('../../data/fixtures');

const PLAN = answerable.plan;
const SWITCH = { name: `Save my place in ${PLAN.circleName}` };
const PRIMARY = { name: 'Email me about this meetup' };

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

const ADDRESS = 'priya@example.com';

function signInAs(confirmedEmail: string | undefined) {
  Object.assign(session, { status: 'saved', userId: 'priya', isAnonymous: false, confirmedEmail });
}

async function tap() {
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', PRIMARY));
  });
}

beforeEach(() => {
  Object.assign(session, {
    status: 'guest',
    userId: 'priya',
    isAnonymous: true,
    confirmedEmail: undefined,
  });
  for (const mock of [
    push,
    replace,
    track,
    planToAnswer,
    requestEmailUpdates,
    requestLinkCode,
    submitLinkCode,
    savePlace,
  ]) {
    mock.mockReset();
  }
  globalThis.localStorage.clear();
  forgetSessionNudges();
  forgetOneSteps();
  planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
  requestEmailUpdates.mockResolvedValue({ status: 'check_email', delivery: 'live' });
  requestLinkCode.mockResolvedValue('new_identity');
  savePlace.mockImplementation(async (options: { signIn: () => Promise<unknown> }) => {
    await options.signIn();
    return {};
  });
  submitLinkCode.mockResolvedValue({ session: { user: { id: 'priya' } } });
});

describe('a signed-in member with a confirmed address', () => {
  beforeEach(() => signInAs(ADDRESS));

  it('sees their address, the sentence and one button: no field, no switch', async () => {
    wrap(<SentFlow code={PLAN.code} />);

    expect(await screen.findByText(`We'll email you at ${ADDRESS}.`)).toBeVisible();
    expect(screen.queryByLabelText('Your email')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText(/different address/i)).toBeNull();
    const sentence = screen.getByText((_, node) => node?.textContent === CONSENT.text);
    expect(
      sentence.compareDocumentPosition(screen.getByRole('button', PRIMARY)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('turns the emails on with one tap, asks for no link or code, and says so in a live region', async () => {
    wrap(<SentFlow code={PLAN.code} />);
    await tap();

    expect(
      await screen.findByText(`Done. We'll email ${ADDRESS} about this meetup.`),
    ).toBeVisible();
    expect(requestEmailUpdates).toHaveBeenCalledTimes(1);
    expect(requestEmailUpdates.mock.calls[0]?.[0]).toMatchObject({
      planId: PLAN.id,
      email: ADDRESS,
    });
    expect(requestLinkCode).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(`We'll email ${ADDRESS}`);
    expect(screen.queryByText("Hear when it's locked in")).toBeNull();
    expect(screen.queryByText(/Check your email/i)).toBeNull();
  });

  it('is never promised email when the address is suppressed', async () => {
    requestEmailUpdates.mockResolvedValue({ status: 'check_email', delivery: 'suppressed' });
    wrap(<SentFlow code={PLAN.code} />);
    await tap();

    const line = `We can't send email to ${ADDRESS} right now, so check the plan here.`;
    expect(await screen.findByText(line)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(line);
    expect(screen.queryByText(/We'll email/)).toBeNull();
    expect(screen.queryByText(/^Done\./)).toBeNull();
  });

  it('reads the neutral answer, with no delivery, as done', async () => {
    requestEmailUpdates.mockResolvedValue({ status: 'check_email' });
    wrap(<SentFlow code={PLAN.code} />);
    await tap();

    expect(
      await screen.findByText(`Done. We'll email ${ADDRESS} about this meetup.`),
    ).toBeVisible();
  });

  it('sends once when tapped twice before the first answer', async () => {
    requestEmailUpdates.mockReturnValue(new Promise(() => undefined));
    wrap(<SentFlow code={PLAN.code} />);
    const button = await screen.findByRole('button', PRIMARY);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(requestEmailUpdates).toHaveBeenCalled());
    expect(requestEmailUpdates).toHaveBeenCalledTimes(1);
  });

  it('keeps the card and says so when it could not be sent', async () => {
    requestEmailUpdates.mockRejectedValue(new Error('down'));
    wrap(<SentFlow code={PLAN.code} />);
    await tap();

    expect(
      await screen.findByText("Something went wrong, so the link didn't go. Please try again."),
    ).toBeVisible();
    expect(screen.getByRole('button', PRIMARY)).toBeEnabled();
    expect(screen.getByText(`We'll email you at ${ADDRESS}.`)).toBeVisible();
  });

  it('records nothing for Not now', async () => {
    wrap(<SentFlow code={PLAN.code} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(screen.queryByText("Hear when it's locked in")).toBeNull();
    expect(requestEmailUpdates).not.toHaveBeenCalled();
  });
});

describe('the other two sessions are unchanged', () => {
  it('an anonymous guest still has the field and the switch', async () => {
    wrap(<SentFlow code={PLAN.code} />);

    expect(await screen.findByLabelText('Your email')).toBeVisible();
    expect(screen.getByRole('switch', SWITCH)).toBeVisible();
    expect(screen.queryByText(/We'll email you at/)).toBeNull();
  });

  it('a signed-in account with no confirmed address keeps the field and the link path', async () => {
    signInAs(undefined);
    wrap(<SentFlow code={PLAN.code} />);
    fireEvent.change(await screen.findByLabelText('Your email'), { target: { value: ADDRESS } });
    await tap();

    expect(screen.queryByRole('switch')).toBeNull();
    expect(requestEmailUpdates).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith({
        pathname: '/j/[code]/check-email',
        params: { code: PLAN.code },
      }),
    );
  });
});

describe('the switch-on path, for an address that turns out to be suppressed', () => {
  async function reachTheCodeAndEnterIt() {
    wrap(<SentFlow code={PLAN.code} />);
    fireEvent.change(await screen.findByLabelText('Your email'), { target: { value: ADDRESS } });
    await tap();
    await screen.findByText('Enter the code we emailed');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
  }

  it('says the place is saved and promises no email', async () => {
    requestEmailUpdates.mockResolvedValue({ status: 'check_email', delivery: 'suppressed' });
    await reachTheCodeAndEnterIt();

    const line = `Your place is saved. We can't send email to ${ADDRESS} right now, so check the plan here.`;
    expect(await screen.findByText(line)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(line);
    expect(screen.queryByText(/We'll email/)).toBeNull();
  });

  it('still says the emails are on when the owner is told they are', async () => {
    await reachTheCodeAndEnterIt();

    expect(await screen.findByText(/^Done\. We'll email priya@example\.com/)).toBeVisible();
  });

  it('after a failed attempt, the confirmed member retries with one button and gets the saved line', async () => {
    requestEmailUpdates.mockRejectedValueOnce(new Error('down'));
    savePlace.mockImplementation(async (options: { signIn: () => Promise<unknown> }) => {
      await options.signIn();
      // Signed in now: the address is confirmed, so the retry is the one button.
      signInAs(ADDRESS);
      return {};
    });
    await reachTheCodeAndEnterIt();
    await screen.findByText("Your place is saved. We couldn't turn on the emails; try again.");
    expect(screen.queryByLabelText('Your email')).toBeNull();
    expect(screen.getByText(`We'll email you at ${ADDRESS}.`)).toBeVisible();

    await tap();

    expect(await screen.findByText(/^Done\. We'll email priya@example\.com/)).toBeVisible();
    expect(requestEmailUpdates).toHaveBeenCalledTimes(2);
    expect(requestLinkCode).toHaveBeenCalledTimes(1);
  });
});
