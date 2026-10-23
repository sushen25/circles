import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { tap } from '../../test/tap';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The organiser's way in (S1-22): the front door, the email, the code, Your name.
 * The auth server's own behaviour is the live suite's (`organiser.spec.ts`);
 * these pin what each screen sends and where it goes next.
 */

const push = vi.fn();
const replace = vi.fn();
const where = { pathname: '/' };
/** Whether the screen under test is the one in front. */
const focus = { focused: true, epoch: 0 };
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useRouter: () => ({ push, replace, back: vi.fn(), canGoBack: () => false }),
    usePathname: () => where.pathname,
    useFocusEffect: (effect: () => void) => {
      const epoch = focus.epoch;
      useEffect(() => {
        if (focus.focused) return effect();
      }, [effect, epoch]);
    },
  };
});
const track = vi.fn();
vi.mock('../../analytics/track', () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock('../../data/auth/client', () => ({ hasBackend: () => true }));

const session = { status: 'none', userId: undefined as string | undefined, isLoading: false };
const auth = {
  requestSignInCode: vi.fn(),
  submitSignInCode: vi.fn(),
  requestLinkCode: vi.fn(),
  submitLinkCode: vi.fn(),
  savePlace: vi.fn(),
  bootstrapProfile: vi.fn(),
  ownProfile: vi.fn(),
  saveProfile: vi.fn(),
};
vi.mock('../../data/auth', async () => {
  const { safeReturnPath } = await import('../../data/auth/returnPath');
  const { guard } = await import('../../data/auth/guards');
  return {
    ...Object.fromEntries(
      Object.entries(auth).map(([name, fn]) => [name, (...a: unknown[]) => fn(...a)]),
    ),
    SavePlaceError: class extends Error {},
    deviceTimeZone: () => 'Australia/Melbourne',
    safeReturnPath,
    guard,
    useSession: () => session,
  };
});
vi.mock('../../data/auth/session', () => ({ useSession: () => session }));
const belongsToAnyCircle = vi.fn();
const newestCircleId = vi.fn();
vi.mock('../../data/circles', () => ({
  belongsToAnyCircle: () => belongsToAnyCircle(),
  newestCircleId: () => newestCircleId(),
}));

const askToShow = vi.fn();
const recordAnswer = vi.fn();
vi.mock('../../data/growth', () => ({
  askToShow: (...a: unknown[]) => askToShow(...a),
  recordAnswer: (...a: unknown[]) => recordAnswer(...a),
}));

const { brand } = await import('@circles/config');
const { resetClientErrors } = await import('../../analytics/clientError');
const { SignInFlow } = await import('./SignInFlow');
const { forgetSessionNudges } = await import('../growth/useNudge');
const { WelcomeFlow } = await import('./WelcomeFlow');
const { YourNameFlow } = await import('./YourNameFlow');

const ADDRESS = 'maya@example.com';
const QUESTION = `How did you hear about ${brand.name}?`;

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

async function sendCodeTo(address: string) {
  fireEvent.change(await screen.findByLabelText('Your email'), { target: { value: address } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
  });
}

/** The sixth digit sends the code: there is no Continue (SUS-247). */
async function enter(code: string) {
  const field = await screen.findByLabelText('Code');
  await act(async () => {
    fireEvent.change(field, { target: { value: code } });
  });
}

beforeEach(() => {
  resetClientErrors();
  focus.focused = true;
  focus.epoch = 0;
  where.pathname = '/';
  Object.assign(session, { status: 'none', userId: undefined, isLoading: false });
  for (const mock of [
    push,
    replace,
    track,
    belongsToAnyCircle,
    newestCircleId,
    askToShow,
    recordAnswer,
    ...Object.values(auth),
  ]) {
    mock.mockReset();
  }
  auth.requestSignInCode.mockResolvedValue(undefined);
  auth.submitSignInCode.mockResolvedValue({ session: {} });
  auth.bootstrapProfile.mockResolvedValue(undefined);
  auth.ownProfile.mockResolvedValue({ name: null, zone: null });
  belongsToAnyCircle.mockResolvedValue(false);
  newestCircleId.mockResolvedValue(undefined);
  askToShow.mockResolvedValue({ suppressed: false });
  recordAnswer.mockResolvedValue(undefined);
  forgetSessionNudges();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the front door', () => {
  it('is the first circle with a quiet Sign in, and no sign-in before it (ADR 0053)', async () => {
    wrap(<WelcomeFlow />);
    expect(await screen.findByLabelText('Who do you keep meaning to see?')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Continue with email' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(push).toHaveBeenCalledWith('/sign-in');
  });

  it('sends a returning account with a name and circles straight to them', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    wrap(<WelcomeFlow />);
    // Their circles list, which is live since S1-23.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
  });

  it("sends a signed-in organiser from the website's Start a plan to a new circle, with no gate", async () => {
    where.pathname = '/start';
    Object.assign(session, { status: 'saved', userId: 'maya' });
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    wrap(<WelcomeFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
  });

  it('asks again each time it comes back into view, rather than reusing an old answer (review round 4)', async () => {
    // Signed in, sent to Your name, named, on to FirstCircle — then Back to
    // Welcome. The answer "/name" from before the name was saved must not be
    // the one it acts on.
    Object.assign(session, { status: 'saved', userId: 'maya' });
    auth.ownProfile.mockResolvedValue({ name: null, zone: null });
    const view = wrap(<WelcomeFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));

    replace.mockReset();
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    focus.epoch += 1;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <WelcomeFlow />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
    expect(replace).not.toHaveBeenCalledWith('/name');
  });

  it('does not navigate from underneath the sign-in it sent somebody to', async () => {
    // Welcome stays mounted under `/sign-in`. When the sign-in there makes the
    // session a saved one, Welcome must not also send them somewhere: it
    // replaced the Your name screen the sign-in had just opened (found walking
    // the organiser flow on the live stack).
    focus.focused = false;
    Object.assign(session, { status: 'saved', userId: 'maya' });
    auth.ownProfile.mockResolvedValue({ name: null, zone: null });
    wrap(<WelcomeFlow />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("Who's asking and the code, the gate of the first run (ADR 0053, ADR 0090)", () => {
  const WENT = { kind: 'go' as const, to: '/circles/c1/plan/p1/shared' };

  function gateWith(onPassed: () => Promise<unknown> = async () => WENT) {
    return {
      circle: 'Sunday Crew',
      onPassed: onPassed as never,
      onBackToPlan: vi.fn(),
    };
  }

  async function fillTheGate(name = 'Maya', address = ADDRESS) {
    fireEvent.change(await screen.findByLabelText('First name'), { target: { value: name } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: address } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    });
  }

  it('asks a first name and an email, and nothing else, and links the terms', async () => {
    wrap(<SignInFlow gate={gateWith()} />);
    expect(await screen.findByText("Who's asking?")).toBeVisible();
    expect(screen.getByLabelText('First name')).toBeVisible();
    expect(screen.getByLabelText('Email')).toBeVisible();
    // No summary of the plan, no paragraph about why, no time zone (ADR 0090).
    expect(screen.queryByText(/Save your place/)).toBeNull();
    expect(screen.queryByText(/Catch up/)).toBeNull();
    expect(screen.queryByText(/zone/i)).toBeNull();
    // One progress count, "3 of 3", beside the circle's name.
    expect(screen.getByText('3 of 3')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'terms' }));
    fireEvent.click(screen.getByRole('link', { name: 'privacy' }));
    expect(push.mock.calls).toEqual([['/terms'], ['/privacy']]);
  });

  it('says what is wrong under each field, together, and sends nothing', async () => {
    wrap(<SignInFlow gate={gateWith()} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Email me a code' }));
    });
    expect(screen.getByText('Add your first name, up to 40 characters.')).toBeVisible();
    expect(screen.getByText('Add your email, so we can send the code.')).toBeVisible();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Maya' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'maya' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
    });
    expect(screen.queryByText('Add your first name, up to 40 characters.')).toBeNull();
    expect(screen.getByText("That doesn't look like an email address.")).toBeVisible();
    expect(auth.requestSignInCode).not.toHaveBeenCalled();
  });

  it('names the profile once the code is accepted, then makes what was drafted, in that order', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    const order: string[] = [];
    auth.bootstrapProfile.mockImplementation(async () => void order.push('name'));
    const onPassed = vi.fn(async () => {
      order.push('made');
      return WENT;
    });
    wrap(<SignInFlow gate={gateWith(onPassed)} />);
    await fillTheGate('  Maya  ');
    await enter('123456');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/c1/plan/p1/shared'));
    expect(order).toEqual(['name', 'made']);
    // The name the gate asked for, tidied, and nothing else: Your name is skipped.
    expect(auth.bootstrapProfile).toHaveBeenCalledWith({ name: 'Maya' });
    expect(replace).not.toHaveBeenCalledWith('/name');
    expect(track).toHaveBeenCalledWith('account_completed', { provider: 'email' });
    expect(auth.requestSignInCode).toHaveBeenCalledWith(ADDRESS);
  });

  it("leaves a returning account's own name alone", async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    auth.ownProfile.mockResolvedValue({ name: 'Maya Q', zone: 'Australia/Melbourne' });
    const onPassed = vi.fn(async () => WENT);
    wrap(<SignInFlow gate={gateWith(onPassed)} />);
    await fillTheGate('Someone Else');
    await enter('123456');

    await waitFor(() => expect(onPassed).toHaveBeenCalledTimes(1));
    expect(auth.bootstrapProfile).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalledWith('account_completed', expect.anything());
  });

  it('says Checking, then Setting up the circle, while it works, and goes on the moment the code is in', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    let finish: (value: unknown) => void = () => undefined;
    const onPassed = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    wrap(<SignInFlow gate={gateWith(onPassed)} />);
    await fillTheGate();
    await enter('123456');

    expect(await screen.findByText('Setting up Sunday Crew')).toBeVisible();
    // No Continue to press, before or after.
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    await act(async () => finish(WENT));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/c1/plan/p1/shared'));
  });

  it('keeps what was chosen when the set-up fails, with a reference, Try again and a way back to the plan', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    const gate = gateWith(
      vi
        .fn()
        .mockResolvedValueOnce({
          kind: 'problem',
          problem: 'couldnt_set_up',
          reference: 'K7M2Q9XA',
        })
        .mockResolvedValueOnce(WENT),
    );
    wrap(<SignInFlow gate={gate} />);
    await fillTheGate();
    await enter('123456');

    expect(
      await screen.findByText(/^Something went wrong, so Sunday Crew wasn't set up/),
    ).toBeVisible();
    expect(screen.getByText('Ref K7M2Q9XA')).toBeVisible();
    expect(replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the plan' }));
    expect(gate.onBackToPlan).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/c1/plan/p1/shared'));
    // The code was used once: trying again is the set-up, not another sign-in.
    expect(auth.submitSignInCode).toHaveBeenCalledTimes(1);
  });

  it('offers Change the time when the time went by while they signed in', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    const gate = gateWith(async () => ({ kind: 'problem', problem: 'time_passed' }));
    wrap(<SignInFlow gate={gate} />);
    await fillTheGate();
    await enter('123456');

    expect(await screen.findByText(/^The time you chose has gone by/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Change the time' }));
    expect(gate.onBackToPlan).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('reads a connection that dropped during the set-up as offline, and offers Try again', async () => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
    wrap(
      <SignInFlow
        gate={gateWith(async () => {
          throw Object.assign(new Error('x'), { name: 'AuthRetryableFetchError', status: 0 });
        })}
      />,
    );
    await fillTheGate();
    await enter('123456');
    expect(await screen.findByText("You're offline. Connect, then try again.")).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('empties the boxes after a wrong code and keeps the circle for the next try', async () => {
    const onPassed = vi.fn(async () => WENT);
    wrap(<SignInFlow gate={gateWith(onPassed)} />);
    await fillTheGate();
    auth.submitSignInCode.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'AuthApiError', status: 400, code: 'otp_expired' }),
    );
    await enter('123456');
    expect(await screen.findByText(/^That code didn't work|^That code has expired/)).toBeVisible();
    expect(screen.getByLabelText('Code')).toHaveValue('');
    expect(onPassed).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  describe('"How did you hear about {brand}?" is not here (SUS-171)', () => {
    it('is not asked at the gate: it comes after the share', async () => {
      Object.assign(session, { status: 'saved', userId: 'maya' });
      wrap(<SignInFlow gate={gateWith()} />);
      await fillTheGate();
      await enter('123456');
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/c1/plan/p1/shared'));
      expect(screen.queryByText(QUESTION)).toBeNull();
      expect(askToShow).not.toHaveBeenCalled();
      expect(track.mock.calls.filter(([name]) => name === 'organiser_source')).toEqual([]);
    });

    it('is not asked at the ordinary sign-in, where there is no gate', async () => {
      Object.assign(session, { status: 'saved', userId: 'maya' });
      auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
      newestCircleId.mockResolvedValue('c1');
      wrap(<SignInFlow />);
      await sendCodeTo(ADDRESS);
      await enter('123456');
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
      expect(askToShow).not.toHaveBeenCalled();
    });
  });

  it('is never what an ordinary sign-in does: a returning organiser is not handed a draft', async () => {
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
    expect(replace).not.toHaveBeenCalledWith('/circles/new/finish');
  });
});

/** auth-js's class for both a dropped connection (status 0) and a 5xx answer (its status). */
const authError = (status: number) =>
  Object.assign(new Error('x'), { name: 'AuthRetryableFetchError', status });

describe('"offline" only when the request never reached the server (SUS-200)', () => {
  it('says the code could not be sent, with a reference, and keeps the address, when the server answered 500', async () => {
    // The dev bug: POST /auth/v1/otp returned 500 and the screen blamed the connection.
    auth.requestSignInCode.mockRejectedValueOnce(authError(500));
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);

    expect(
      await screen.findByText("We couldn't send the code. Try again in a moment."),
    ).toBeVisible();
    expect(screen.queryByText(/offline/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your email')).toHaveValue(ADDRESS);
    const [, payload] = track.mock.calls.find(([name]) => name === 'client_error')!;
    expect(payload).toMatchObject({ source: 'request_failed', route: '/' });
    expect(screen.getByText(`Ref ${(payload as { reference: string }).reference}`)).toBeVisible();
  });

  it('says "You\'re offline", with no reference and nothing reported, when the request never left', async () => {
    auth.requestSignInCode.mockRejectedValueOnce(authError(0));
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);

    expect(await screen.findByText("You're offline. Connect, then try again.")).toBeVisible();
    expect(screen.queryByText(/^Ref /)).not.toBeInTheDocument();
    expect(track.mock.calls.some(([name]) => name === 'client_error')).toBe(false);
    expect(screen.getByLabelText('Your email')).toHaveValue(ADDRESS);
  });

  it('puts the reference under a code that could not be checked, too', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    auth.submitSignInCode.mockRejectedValueOnce(authError(503));
    await enter('123456');

    expect(await screen.findByText(/^Ref [2-9A-HJ-NP-Z]{8}$/)).toBeVisible();
    expect(screen.queryByText(/offline/)).not.toBeInTheDocument();
  });
});

describe('signing in by email', () => {
  it('refuses something that is not an address, and sends nothing', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo('maya');
    expect(screen.getByText("That doesn't look like an email address.")).toBeVisible();
    expect(auth.requestSignInCode).not.toHaveBeenCalled();
  });

  it('asks for a code, and keeps the address out of every navigation', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);

    expect(auth.requestSignInCode).toHaveBeenCalledWith(ADDRESS);
    expect(track).toHaveBeenCalledWith('account_started', {});
    expect(await screen.findByText(`Sent to ${ADDRESS}.`)).toBeVisible();
    expect(JSON.stringify([push.mock.calls, replace.mock.calls])).not.toContain(ADDRESS);
  });

  it('draws six boxes, keeps only digits, and takes a pasted code whole', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);

    const field = await screen.findByLabelText('Code');
    fireEvent.change(field, { target: { value: '4 8-2 9x17 55' } });
    expect(field).toHaveValue('482917');
    // The sixth digit sent it: there is no Continue to press (SUS-247).
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    await waitFor(() => expect(auth.submitSignInCode).toHaveBeenCalledWith(ADDRESS, '482917'));
  });

  it('sends the code once, on the sixth digit, and not before it', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    const field = await screen.findByLabelText('Code');

    fireEvent.change(field, { target: { value: '48291' } });
    expect(auth.submitSignInCode).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.change(field, { target: { value: '482917' } });
    });
    expect(auth.submitSignInCode).toHaveBeenCalledTimes(1);
  });

  it('waits thirty seconds before another code can be sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);

    const wait = await screen.findByRole('button', { name: /Send another in \d+s/ });
    fireEvent.click(wait);
    expect(auth.requestSignInCode).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send another' }));
    });
    expect(auth.requestSignInCode).toHaveBeenCalledTimes(2);
  });

  it('says a code has expired after ten minutes, rather than that it is wrong', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    auth.submitSignInCode.mockRejectedValue({ code: 'otp_expired', status: 403 });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000 + 1);
    });
    await enter('123456');

    expect(await screen.findByText(/^That code has expired\. Send a new one\./)).toBeVisible();
  });

  it('reads a deleted account as a wrong code, with the same words for any address', async () => {
    // Auth answers a banned user 403 `user_banned` for any code, so a message of
    // its own would tell anybody who knows an address that it was deleted. The
    // one screen says both, and names the reason for the person it is true of.
    auth.submitSignInCode.mockRejectedValue({ code: 'user_banned', status: 403 });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    expect(
      await screen.findByText(
        "That code didn't work. Check it, or send a new one. If you deleted your account, that address can't sign in again for 30 days.",
      ),
    ).toBeVisible();
  });

  it('empties the boxes after a wrong code and puts the cursor back in the first (SUS-204)', async () => {
    auth.submitSignInCode.mockRejectedValue({ code: 'otp_expired', status: 403 });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    expect(await screen.findByText(/That code didn't work/)).toBeVisible();
    const field = screen.getByLabelText('Code');
    await waitFor(() => expect(field).toHaveValue(''));
    expect(field).toHaveFocus();

    // And a second wrong code does it again.
    await enter('654321');
    await waitFor(() => expect(auth.submitSignInCode).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByLabelText('Code')).toHaveValue(''));
  });

  it('sends a new account to Your name, counted as completed', async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    expect(auth.submitSignInCode).toHaveBeenCalledWith(ADDRESS, '123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));
    expect(track).toHaveBeenCalledWith('account_completed', { provider: 'email' });
  });

  it('skips Your name for a returning account with a name', async () => {
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: 'Australia/Melbourne' });
    newestCircleId.mockResolvedValue('c1');
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
    expect(track).not.toHaveBeenCalledWith('account_completed', expect.anything());
  });

  it("leaves a returning account's zone alone, UTC included (review round 1)", async () => {
    // `ownProfile` reads a stored `UTC` as "not chosen"; the bootstrap would
    // have replaced it with this device's zone on every sign-in.
    auth.ownProfile.mockResolvedValue({ name: 'Maya', zone: null });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(auth.bootstrapProfile).not.toHaveBeenCalled();
  });

  it("gives a new account the device's zone", async () => {
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));
    expect(auth.bootstrapProfile).toHaveBeenCalledTimes(1);
  });

  it('sends one new code however often Send a new code is tapped (review round 2)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    auth.requestSignInCode.mockImplementation(() => new Promise(() => undefined));
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    const resend = screen.getByRole('button', { name: 'Send another' });
    await act(async () => {
      fireEvent.click(resend);
      fireEvent.click(resend);
    });
    expect(auth.requestSignInCode).toHaveBeenCalledTimes(2);
  });

  it('sends one code however often Enter is pressed while it is on its way (review round 1)', async () => {
    auth.requestSignInCode.mockImplementation(() => new Promise(() => undefined));
    wrap(<SignInFlow />);
    const field = await screen.findByLabelText('Your email');
    fireEvent.change(field, { target: { value: ADDRESS } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', keyCode: 13 });
      fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', keyCode: 13 });
      fireEvent.click(screen.getByRole('button', { name: /Send me a code|Sending/ }));
    });
    expect(auth.requestSignInCode).toHaveBeenCalledTimes(1);
  });

  it('goes back to the plan link it was sent from', async () => {
    wrap(<SignInFlow returnTo="/p/abcdefgh" />);
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/p/abcdefgh'));
  });

  it('lands an organiser from an email footer on notification settings, and says so (ADR 0029)', async () => {
    wrap(<SignInFlow returnTo="/settings/notifications" />);
    expect(
      screen.getByText("We'll bring you straight to your notification settings."),
    ).toBeVisible();
    expect(screen.queryByText(/back to the plan/)).toBeNull();
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/settings/notifications'));
  });

  it('ignores a return path that would leave the site', async () => {
    wrap(<SignInFlow returnTo="https://elsewhere.example/j/abcdefgh" />);
    await sendCodeTo(ADDRESS);
    await enter('123456');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/name'));
    expect(JSON.stringify(replace.mock.calls)).not.toContain('elsewhere');
  });

  it('does not ask a guest who saved their place for a name, or count a new account (review round 4)', async () => {
    Object.assign(session, { status: 'guest', userId: 'nina' });
    belongsToAnyCircle.mockResolvedValue(true);
    newestCircleId.mockResolvedValue('c1');
    auth.requestLinkCode.mockResolvedValue('new_identity');
    auth.savePlace.mockResolvedValue({});
    wrap(<SignInFlow />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles'));
    expect(track).not.toHaveBeenCalledWith('account_completed', expect.anything());
    expect(track).toHaveBeenCalledWith('account_claimed', { moment: 'settings' });
  });

  it("saves a guest's place rather than stranding their circles", async () => {
    Object.assign(session, { status: 'guest', userId: 'nina' });
    belongsToAnyCircle.mockResolvedValue(true);
    auth.requestLinkCode.mockResolvedValue('existing_account');
    auth.savePlace.mockResolvedValue({});
    wrap(<SignInFlow returnTo="/j/abcdefgh" />);
    await sendCodeTo(ADDRESS);
    await enter('123456');

    expect(auth.requestSignInCode).not.toHaveBeenCalled();
    expect(auth.requestLinkCode).toHaveBeenCalledWith(ADDRESS);
    expect(auth.savePlace).toHaveBeenCalledWith(expect.objectContaining({ moment: 'settings' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/j/abcdefgh'));
  });
});

describe('Your name', () => {
  beforeEach(() => {
    Object.assign(session, { status: 'saved', userId: 'maya' });
  });

  it("saves the name with the device's zone, then goes to make a first circle", async () => {
    auth.saveProfile.mockResolvedValue(undefined);
    wrap(<YourNameFlow />);

    expect(await screen.findByText(/Melbourne.*from your phone/)).toBeVisible();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: '  Maya ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });

    expect(auth.saveProfile).toHaveBeenCalledWith({ name: 'Maya', zone: 'Australia/Melbourne' });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/circles/new'));
  });

  it('lets the zone be changed to another, by city', async () => {
    auth.saveProfile.mockResolvedValue(undefined);
    wrap(<YourNameFlow />);

    await tap(screen.findByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByLabelText('Search time zones'), { target: { value: 'london' } });
    fireEvent.click(screen.getByRole('radio', { name: 'London' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Maya' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });

    expect(auth.saveProfile).toHaveBeenCalledWith({ name: 'Maya', zone: 'Europe/London' });
  });

  it('refuses an empty name before sending anything', async () => {
    wrap(<YourNameFlow />);
    await act(async () => {
      await tap(screen.findByRole('button', { name: 'Continue' }));
    });
    expect(screen.getByText('Add a name of up to 40 characters.')).toBeVisible();
    expect(auth.saveProfile).not.toHaveBeenCalled();
  });

  it('sends somebody without a saved place back to Welcome', async () => {
    Object.assign(session, { status: 'guest', userId: 'nina' });
    wrap(<YourNameFlow />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });
});
