import { CONSENT } from '@circles/config';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * After sending, one step (SUS-162): one card, one address, a "Save my place"
 * switch that is on by default. On, a code and then the plan's updates; off,
 * today's verification link. The server's side of it (a confirmed address is its
 * own proof, so no link) is pgTAP's; the round trips are the live suite's.
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
const session = { status: 'guest', userId: 'priya', isAnonymous: true, isLoading: false };
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
const { answerable } = await import('../../data/fixtures');

const PLAN = answerable.plan;
const SWITCH = { name: `Save my place in ${PLAN.circleName}` };
const PRIMARY = { name: 'Email me about this meetup' };

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

async function typeAddress(address = 'priya@example.com') {
  fireEvent.change(await screen.findByLabelText('Your email'), { target: { value: address } });
}

async function reachTheCode() {
  wrap(<SentFlow code={PLAN.code} />);
  await typeAddress();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', PRIMARY));
  });
  await screen.findByText('Enter the code we emailed');
}

async function enterTheCode() {
  fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  });
}

beforeEach(() => {
  Object.assign(session, { status: 'guest', userId: 'priya', isAnonymous: true });
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
  planToAnswer.mockResolvedValue({ plan: PLAN, answer: answerable.answer });
  requestEmailUpdates.mockResolvedValue({ status: 'check_email' });
  requestLinkCode.mockResolvedValue('new_identity');
  // The real one signs in and claims; here it runs the sign-in it is given.
  savePlace.mockImplementation(async (options: { signIn: () => Promise<unknown> }) => {
    await options.signIn();
    return {};
  });
  submitLinkCode.mockResolvedValue({ session: { user: { id: 'priya' } } });
});

describe('the card', () => {
  it('is one card: the sentence before the button, and a real switch that is on', async () => {
    wrap(<SentFlow code={PLAN.code} />);

    const toggle = await screen.findByRole('switch', SWITCH);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Get back from any phone.')).toBeVisible();
    expect(screen.queryByText(/Save access on every device/)).toBeNull();

    const sentence = screen.getByText((_, node) => node?.textContent === CONSENT.text);
    const primary = screen.getByRole('button', PRIMARY);
    expect(
      sentence.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Nothing is saved.')).toBeVisible();
  });

  it('shows no switch to somebody whose place is already saved', async () => {
    Object.assign(session, { status: 'saved', userId: 'priya', isAnonymous: false });
    wrap(<SentFlow code={PLAN.code} />);

    await screen.findByRole('button', PRIMARY);
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('with the switch on', () => {
  it('asks for a code and nothing else: no subscription, no link', async () => {
    await reachTheCode();

    expect(requestLinkCode).toHaveBeenCalledWith('priya@example.com');
    expect(requestEmailUpdates).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('email_submitted', { plan_id: PLAN.id, save_place: true });
    expect(push).not.toHaveBeenCalled();
  });

  it('saves the place, then turns on this plan for that address, and says so', async () => {
    await reachTheCode();
    await enterTheCode();

    expect(await screen.findByText(/^Done\. We'll email priya@example\.com/)).toBeVisible();
    expect(savePlace).toHaveBeenCalledWith(expect.objectContaining({ moment: 'after_answer' }));
    expect(submitLinkCode).toHaveBeenCalledWith('priya@example.com', '123456', 'new_identity');
    const [options] = requestEmailUpdates.mock.calls[0] ?? [];
    expect(options).toMatchObject({ planId: PLAN.id, email: 'priya@example.com' });
    expect(track).toHaveBeenCalledWith('account_claimed', { moment: 'after_answer' });
    // The line is a live region and the card is gone; no check-your-email step.
    expect(screen.getByRole('status')).toHaveTextContent(/your place in .* is saved/);
    expect(screen.queryByText("Hear when it's locked in")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('says the place is saved when the emails could not be turned on, and offers them again', async () => {
    requestEmailUpdates.mockRejectedValueOnce(new Error('down'));
    await reachTheCode();
    await enterTheCode();

    expect(
      await screen.findByText("Your place is saved. We couldn't turn on the emails; try again."),
    ).toBeVisible();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByLabelText('Your email')).toHaveValue('priya@example.com');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', PRIMARY));
    });
    expect(await screen.findByText(/^Done\. We'll email priya@example\.com/)).toBeVisible();
    expect(requestEmailUpdates).toHaveBeenCalledTimes(2);
    expect(requestLinkCode).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps the address and the switch when the code could not be sent', async () => {
    requestLinkCode.mockRejectedValue(new Error('down'));
    wrap(<SentFlow code={PLAN.code} />);
    await typeAddress();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', PRIMARY));
    });

    expect(await screen.findByText(/Something went wrong, so the link didn't go/)).toBeVisible();
    expect(screen.getByLabelText('Your email')).toHaveValue('priya@example.com');
    expect(screen.getByRole('switch', SWITCH)).toHaveAttribute('aria-checked', 'true');
  });

  it('goes back to the card with the address still typed', async () => {
    await reachTheCode();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByLabelText('Your email')).toHaveValue('priya@example.com');
  });
});

describe('with the switch off', () => {
  it('is today: the verification link and Check your email, no code and no account', async () => {
    wrap(<SentFlow code={PLAN.code} />);
    await typeAddress();
    fireEvent.click(await screen.findByRole('switch', SWITCH));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', PRIMARY));
    });

    await waitFor(() => expect(requestEmailUpdates).toHaveBeenCalledTimes(1));
    expect(requestLinkCode).not.toHaveBeenCalled();
    expect(savePlace).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith({
      pathname: '/j/[code]/check-email',
      params: { code: PLAN.code },
    });
    expect(track).toHaveBeenCalledWith('email_submitted', { plan_id: PLAN.id, save_place: false });
  });
});

describe('Not now', () => {
  it('records nothing and takes the card away, switch or not', async () => {
    wrap(<SentFlow code={PLAN.code} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));

    expect(screen.queryByText("Hear when it's locked in")).toBeNull();
    expect(requestLinkCode).not.toHaveBeenCalled();
    expect(requestEmailUpdates).not.toHaveBeenCalled();
  });
});
